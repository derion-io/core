// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@uniswap/lib/contracts/libraries/TransferHelper.sol";
import "@uniswap/v3-core/contracts/libraries/FullMath.sol";
import "@derion/utr/contracts/interfaces/IUniversalTokenRouter.sol";
import "solidity-bytes-utils/contracts/BytesLib.sol";
import "../interfaces/IToken.sol";
import "../interfaces/IPositioner.sol";
import "../subs/Constants.sol";
import "../Fetcher.sol";
import "../subs/Storage.sol";

contract PositionerForMaturity is IPositioner, Storage, Constants, Fetcher {
    address public immutable TOKEN;
    uint256 public immutable MATURITY;
    uint256 public immutable MATURITY_VEST;
    uint256 public immutable MATURITY_RATE; // x128
    uint256 public immutable OPEN_RATE;

    constructor(
        address token,
        uint256 maturity,
        uint256 maturityVest,
        uint256 maturityRate,
        uint256 openRate
    ) {
        TOKEN = token;
        MATURITY = maturity;
        MATURITY_VEST = maturityVest;
        MATURITY_RATE = maturityRate;
        OPEN_RATE = openRate;
    }

    /// Position event for each postion mint/burn
    event Position(
        address indexed payer,
        address indexed recipient,
        address indexed index,
        uint256 id,
        uint256 amount,
        uint256 maturity,
        uint256 price,
        uint256 valueR
    );

    function initialize(Config memory config, State memory state, Payment memory payment) external {
        require(s_lastInterestTime == 0, "ALREADY_INITIALIZED");
        uint256 R = state.R;
        uint256 a = state.a;
        uint256 b = state.b;
        require(R > 0 && a > 0 && b > 0, "ZERO_PARAM");

        s_lastInterestTime = uint32(block.timestamp);
        s_a = uint224(a);
        s_lastPremiumTime = uint32(block.timestamp);
        s_b = uint224(b);

        address payer;

        if (payment.payer.length > 0) {
            uint256 expected = R + IERC20(config.TOKEN_R).balanceOf(address(this));
            payer = BytesLib.toAddress(payment.payer, 0);
            if (payment.payer.length == 20) {
                payment.payer = abi.encode(payer, address(this), 20, config.TOKEN_R, 0);
            }
            IUniversalTokenRouter(payment.utr).pay(payment.payer, R);
            require(expected <= IERC20(config.TOKEN_R).balanceOf(address(this)), "INSUFFICIENT_PAYMENT");
        } else {
            TransferHelper.safeTransferFrom(config.TOKEN_R, msg.sender, address(this), R);
            payer = msg.sender;
        }

        uint256 idA = _packID(address(this), SIDE_A);
        uint256 idB = _packID(address(this), SIDE_B);
        uint256 idC = _packID(address(this), SIDE_C);

        (uint256 price,) = fetch(uint256(config.ORACLE));
        (uint256 rA, uint256 rB) = _evaluate(_xk(config, price), state);
        require(rA >= MINIMUM_RESERVE, 'MINIMUM_RESERVE_A');
        require(rB >= MINIMUM_RESERVE, 'MINIMUM_RESERVE_B');
        uint256 rC = R - rA - rB;
        require(rC >= MINIMUM_RESERVE, 'MINIMUM_RESERVE_C');

        // mint tokens to recipient
        uint32 maturity = uint32(block.timestamp + MATURITY);
        IToken(TOKEN).mint(payment.recipient, idA, rA, maturity, "");
        IToken(TOKEN).mint(payment.recipient, idB, rB, maturity, "");
        IToken(TOKEN).mint(payment.recipient, idC, rC, maturity, "");
        address index = address(uint160(uint256(config.ORACLE)));
        emit Position(payer, payment.recipient, index, idA, rA, maturity, price, rA);
        emit Position(payer, payment.recipient, index, idB, rB, maturity, price, rB);
        emit Position(payer, payment.recipient, index, idC, rC, maturity, price, rC);
    }

    function handleTransition(
        Config calldata config,
        bytes calldata payload,
        Payment memory payment,
        Receipt calldata receipt
    ) external virtual override returns (Result memory result) {
        (
            uint256 sideIn,
            uint256 sideOut,
        ) = abi.decode(payload, (uint256, uint256, uint256));

        {
            (uint256 rA, uint256 rA1, uint256 rB, uint256 rB1) = 
                (receipt.rA, receipt.rA1, receipt.rB, receipt.rB1);

            if (sideIn == SIDE_R) {
                require(rA1 >= rA && rB1 >= rB, "INVALID_STATE1_R");
                result.amountIn = receipt.R1 - receipt.R;
            } else {
                require(receipt.R >= receipt.R1, "INVALID_STATE1_NR");
                uint256 s = _supply(sideIn);
                if (sideIn == SIDE_A) {
                    require(rB1 >= rB, "INVALID_STATE1_A");
                    result.amountIn = FullMath.mulDivRoundingUp(s, rA - rA1, rA);
                } else {
                    require(rA1 >= rA, "INVALID_STATE1_NA");
                    if (sideIn == SIDE_B) {
                        result.amountIn = FullMath.mulDivRoundingUp(s, rB - rB1, rB);
                    } else {
                        require(rB1 >= rB, "INVALID_STATE1_NB");
                        uint256 rC = receipt.R - rA - rB;
                        uint256 rC1 = receipt.R1 - rA1 - rB1;
                        result.amountIn = FullMath.mulDivRoundingUp(s, rC - rC1, rC);
                    }
                }
                unchecked {
                    // rX >= rX - rX1, so s >= amountIn
                    require(MINIMUM_SUPPLY <= s - result.amountIn, 'MINIMUM_SUPPLY');
                }
            }

            if (sideOut == SIDE_R) {
                result.amountOut = receipt.R - receipt.R1;
            } else {
                if (sideOut == SIDE_C) {
                    uint256 rC = receipt.R - rA - rB;
                    uint256 rC1 = receipt.R1 - rA1 - rB1;
                    require(rC1 >= MINIMUM_RESERVE, 'MINIMUM_RESERVE_C');
                    result.amountOut = FullMath.mulDiv(_supply(sideOut), rC1 - rC, rC);
                } else {
                    if (sideOut == SIDE_A) {
                        require(rA1 >= MINIMUM_RESERVE, 'MINIMUM_RESERVE_A');
                        result.amountOut = FullMath.mulDiv(_supply(sideOut), rA1 - rA, rA);
                    } else {
                        require(rB1 >= MINIMUM_RESERVE, 'MINIMUM_RESERVE_B');
                        result.amountOut = FullMath.mulDiv(_supply(sideOut), rB1 - rB, rB);
                    }
                    if (OPEN_RATE != Q128) {
                        result.amountIn = FullMath.mulDivRoundingUp(result.amountIn, Q128, OPEN_RATE);
                    }
                }
            }
        }

        address payer;
        if (sideIn == SIDE_R) {
            if (payment.payer.length > 0) {
                payer = BytesLib.toAddress(payment.payer, 0);
                // prepare the utr payload
                if (payment.payer.length == 20) {
                    payment.payer = abi.encode(payer, address(this), 20, config.TOKEN_R, 0);
                }
                uint256 expected = result.amountIn + IERC20(config.TOKEN_R).balanceOf(address(this));
                // pull payment
                IUniversalTokenRouter(payment.utr).pay(payment.payer, result.amountIn);
                require(expected <= IERC20(config.TOKEN_R).balanceOf(address(this)), "PoolBase: INSUFFICIENT_PAYMENT");
            } else {
                TransferHelper.safeTransferFrom(config.TOKEN_R, msg.sender, address(this), result.amountIn);
                payer = msg.sender;
            }
        } else {
            uint256 idIn = _packID(address(this), sideIn);
            uint256 inputMaturity;
            if (payment.payer.length > 0) {
                // clear the pool first to prevent maturity griefing attacks
                uint256 balance = IERC1155Supply(TOKEN).balanceOf(address(this), idIn);
                if (balance > 0) {
                    IToken(TOKEN).burn(address(this), idIn, balance);
                }
                payer = BytesLib.toAddress(payment.payer, 0);
                // prepare the utr payload
                if (payment.payer.length == 20) {
                    payment.payer = abi.encode(payer, address(this), 1155, TOKEN, idIn);
                }
                // pull payment
                IUniversalTokenRouter(payment.utr).pay(payment.payer, result.amountIn);
                balance = IERC1155Supply(TOKEN).balanceOf(address(this), idIn);
                require(result.amountIn <= balance, "PoolBase: INSUFFICIENT_PAYMENT");
                // query the maturity first before burning
                inputMaturity = IToken(TOKEN).maturityOf(address(this), idIn);
                // burn the 1155 token
                IToken(TOKEN).burn(address(this), idIn, balance);
            } else {
                // query the maturity first before burning
                inputMaturity = IToken(TOKEN).maturityOf(msg.sender, idIn);
                // burn the 1155 token directly from msg.sender
                IToken(TOKEN).burn(msg.sender, idIn, result.amountIn);
                payer = msg.sender;
            }
            uint256 valueR = sideOut == SIDE_R ? result.amountOut : 0;
            emit Position(
                payer,
                address(0),  // burn from payer
                address(uint160(uint256(config.ORACLE))),
                idIn,
                result.amountIn,
                inputMaturity,
                receipt.price,
                valueR
            );
            result.amountOut = maturityPayoff(inputMaturity, result.amountOut);
        }

        uint256 maturity;
        if (sideOut == SIDE_R) {
            TransferHelper.safeTransfer(config.TOKEN_R, payment.recipient, result.amountOut);
        } else {
            uint256 idOut = _packID(address(this), sideOut);
            maturity = uint32(block.timestamp) + MATURITY;
            IToken(TOKEN).mint(payment.recipient, idOut, result.amountOut, uint32(maturity), "");
            uint256 valueR = sideIn == SIDE_R ? result.amountIn : 0;
            emit Position(
                payer,
                payment.recipient,
                address(uint160(uint256(config.ORACLE))),
                idOut,
                result.amountOut,
                maturity,
                receipt.price,
                valueR
            );
        }
    }

    function fetchPrices(
        uint256 ORACLE,
        bytes calldata payload
    ) external view virtual override returns (uint256 twap, uint256 spot) {
        (
            uint256 sideIn,
            uint256 sideOut,
        ) = abi.decode(payload, (uint256, uint256, uint256));
        require(sideIn != sideOut, 'SAME_SIDE');
        require(
            sideIn == SIDE_R ||
            sideIn == SIDE_A ||
            sideIn == SIDE_B ||
            sideIn == SIDE_C,
            'INVALID_SIDE_IN'
        );
        require(
            sideOut == SIDE_R ||
            sideOut == SIDE_A ||
            sideOut == SIDE_B ||
            sideOut == SIDE_C,
            'INVALID_SIDE_OUT'
        );
        (twap, spot) = fetch(ORACLE);
        if (sideOut == SIDE_A || sideIn == SIDE_B) {
            // +long and -short use higher price
            if (twap < spot) {
                twap = spot;
            } else if (spot < twap) {
                spot = twap;
            }
        } else if (sideOut == SIDE_B || sideIn == SIDE_A) {
            // -long and +short use lower price
            if (twap > spot) {
                twap = spot;
            } else if (spot > twap) {
                spot = twap;
            }
        }
        // otherwise, let PoolLogic decide
    }

    function maturityPayoff(
        uint256 maturity,
        uint256 amountOut
    ) public view returns (uint256) {
        unchecked {
            if (maturity <= block.timestamp) {
                return amountOut;
            }
            uint256 remain = maturity - block.timestamp;
            if (MATURITY <= remain) {
                return 0;
            }
            uint256 elapsed = MATURITY - remain;
            if (elapsed < MATURITY_VEST) {
                amountOut = amountOut * elapsed / MATURITY_VEST;
            }
            return FullMath.mulDiv(amountOut, MATURITY_RATE, Q128);
        }
    }

    function sideSupply(address pool, uint256 side) public view returns (uint256) {
        return IERC1155Supply(TOKEN).totalSupply(_packID(pool, side));
    }

    function _supply(uint256 side) internal view returns (uint256 s) {
        return sideSupply(address(this), side);
    }

    function _packID(address pool, uint256 side) internal pure returns (uint256 id) {
        id = (side << 160) | uint160(pool);
    }

    function _xk(Config memory config, uint256 price) internal pure returns (uint256 xk) {
        xk = _powu(FullMath.mulDiv(Q128, price, config.MARK), config.K);
    }

    function _powu(uint256 x, uint256 y) internal pure returns (uint256 z) {
        // Calculate the first iteration of the loop in advance.
        z = y & 1 > 0 ? x : Q128;
        // Equivalent to "for(y /= 2; y > 0; y /= 2)" but faster.
        for (y >>= 1; y > 0; y >>= 1) {
            x = FullMath.mulDiv(x, x, Q128);
            // Equivalent to "y % 2 == 1" but faster.
            if (y & 1 > 0) {
                z = FullMath.mulDiv(z, x, Q128);
            }
        }
    }

    function _evaluate(uint256 xk, State memory state) internal pure returns (uint256 rA, uint256 rB) {
        rA = _r(xk, state.a, state.R);
        rB = _r(Q256M/xk, state.b, state.R);
    }

    function _r(uint256 xk, uint256 v, uint256 R) internal pure returns (uint256 r) {
        r = FullMath.mulDiv(v, xk, Q128);
        if (r > R >> 1) {
            uint256 denominator = FullMath.mulDiv(v, xk, Q126);
            uint256 minuend = FullMath.mulDivRoundingUp(R, R, denominator);
            r = R - minuend;
        }
    }
}

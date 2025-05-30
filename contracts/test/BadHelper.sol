// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@uniswap/v3-core/contracts/libraries/FullMath.sol";
import "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";
import "@uniswap/lib/contracts/libraries/TransferHelper.sol";
import "solidity-bytes-utils/contracts/BytesLib.sol";

import "@derion/erc1155-maturity/contracts/token/ERC1155/IERC1155Supply.sol";
import "@derion/utr/contracts/NotToken.sol";

import "../subs/Constants.sol";
import "../interfaces/IHelper.sol";
import "../interfaces/IPool.sol";
import "../PoolFactory.sol";
import "../interfaces/IWeth.sol";

import "../interfaces/IPoolForMaturity.sol";

contract BadHelper is NotToken, Constants, IHelper {
    struct SwapParams {
        uint256 sideIn;
        address poolIn;
        uint256 sideOut;
        address poolOut;
        uint256 amountIn;
        uint32 maturity;
        bytes payer;
        address recipient;
    }

    uint256 internal constant SIDE_NATIVE = 0x01;
    uint256 constant MAX_IN = 0;
    address internal immutable TOKEN;
    address internal immutable WETH;

    event Swap(
        address indexed payer,
        address indexed poolIn,
        address indexed poolOut,
        address recipient,
        uint256 sideIn,
        uint256 sideOut,
        uint256 amountIn,
        uint256 amountOut
    );

    constructor(address token, address weth) {
        TOKEN = token;
        WETH = weth;
    }

    // accepting ETH for WETH.withdraw
    receive() external payable {}

    function createPool(
        Config memory config,
        State memory state,
        address factory
    ) external payable returns (address pool) {
        pool = PoolFactory(factory).createPool(config);
        IWeth(WETH).deposit{value: msg.value}();
        uint256 amount = IWeth(WETH).balanceOf(address(this));
        IERC20(WETH).approve(pool, amount);
        IPool(pool).initialize(state, Payment(address(0), "", msg.sender));
    }

    function swap(
        SwapParams memory params
    ) external payable returns (uint256 amountOut) {
        SwapParams memory _params = SwapParams(
            params.sideIn,
            params.poolIn,
            params.sideOut,
            params.poolOut,
            params.amountIn,
            params.maturity,
            params.payer,
            params.recipient
        );

        address TOKEN_R = IPool(params.poolIn).loadConfig().TOKEN_R;
        if (params.poolIn != params.poolOut) {
            amountOut = _swapMultiPool(params, TOKEN_R);
            return amountOut;
        }

        if (params.sideIn == SIDE_NATIVE) {
            require(TOKEN_R == WETH, "Reserve token is not Wrapped");
            require(msg.value != 0, "Value need > 0");
            IWeth(WETH).deposit{value: msg.value}();
            uint256 amount = IWeth(WETH).balanceOf(address(this));
            IERC20(WETH).approve(params.poolIn, amount);
            params.payer = "";
            params.sideIn = SIDE_R;
        }

        if (params.sideOut == SIDE_NATIVE) {
            require(TOKEN_R == WETH, "Reserve token is not Wrapped");
            params.sideOut = SIDE_R;
            params.recipient = address(this);
        }

        bytes memory payload = abi.encode(
            params.sideIn,
            params.sideOut,
            params.amountIn
        );

        Result memory result = IPoolForMaturity(params.poolIn).transition(
            Param(address(this), payload),
            Payment(
                msg.sender, // UTR
                params.payer,
                params.recipient
            )
        );
        amountOut = result.amountOut;

        if (_params.sideOut == SIDE_NATIVE) {
            require(TOKEN_R == WETH, "Reserve token is not Wrapped");
            amountOut = IERC20(WETH).balanceOf(address(this));
            require(amountOut > 0, "Do not have ETH to transfer");
            IWeth(WETH).withdraw(amountOut);
            payable(_params.recipient).transfer(amountOut);
        }

        emit Swap(
            BytesLib.toAddress(_params.payer, 0),
            _params.poolIn,
            _params.poolOut,
            _params.recipient,
            _params.sideIn,
            _params.sideOut,
            _params.amountIn,
            amountOut
        );
    }

    function updateState(
        Slippable calldata __,
        bytes calldata payload
    ) external view override returns (State memory state1) {
        (
            uint256 sideIn,
            uint256 sideOut,
            uint256 amount
        ) = abi.decode(payload, (uint256, uint256, uint256));

        state1.R = __.R;
        (uint256 rA1, uint256 rB1) = (__.rA, __.rB);
        if (sideIn == SIDE_R) {
            uint256 s = _supply(SIDE_C);
            if (sideOut == SIDE_B) {
                amount = FullMath.mulDiv(amount, __.rA, s);
                rA1 -= amount;
            } else if (sideOut == SIDE_A) {
                amount = FullMath.mulDiv(amount, __.rB, s);
                rB1 -= amount;
            } else if (sideOut == SIDE_C) {
                uint256 rC = __.R - __.rA - __.rB;
                if (rC < amount && 1 < rC) {
                    --rC;
                } else {
                    --amount;
                }
                amount = FullMath.mulDiv(amount, rC, s);
            }
            state1.R -= amount;
        } else {
            state1.R += amount;
            if (sideIn == SIDE_A) {
                rA1 += amount;
            } else if (sideIn == SIDE_B) {
                rB1 += amount;
            }
        }
        state1.a = _v(__.xk, rA1, state1.R);
        state1.b = _v(Q256M / __.xk, rB1, state1.R);
    }

    function unpackId(uint256 id) public pure returns (uint256, address) {
        uint256 k = id >> 160;
        address p = address(uint160(uint256(id - k)));
        return (k, p);
    }

    function _swapMultiPool(
        SwapParams memory params,
        address TOKEN_R
    ) internal returns (uint256 amountOut) {
        // swap poolIn/sideIn to poolIn/R
        bytes memory payload = abi.encode(
            params.sideIn,
            SIDE_R,
            params.amountIn
        );

        amountOut = IPoolForMaturity(params.poolIn).transition(
            Param(address(this), payload),
            Payment(
                msg.sender, // UTR
                params.payer,
                address(this)
            )
        ).amountOut;

        // TOKEN_R approve poolOut
        IERC20(TOKEN_R).approve(params.poolOut, amountOut);

        // swap (poolIn|PoolOut)/R to poolOut/SideOut
        payload = abi.encode(SIDE_R, params.sideOut, amountOut);
        amountOut = IPoolForMaturity(params.poolOut).transition(
            Param(address(this), payload),
            Payment(
                msg.sender, // UTR
                "",
                params.recipient
            )
        ).amountOut;

        address payer = BytesLib.toAddress(params.payer, 0);

        // check leftOver
        uint256 leftOver = IERC20(TOKEN_R).balanceOf(address(this));
        if (leftOver > 0) {
            TransferHelper.safeTransfer(TOKEN_R, payer, leftOver);
        }

        emit Swap(
            payer, // topic2: poolIn
            params.poolIn,
            params.poolOut,
            params.recipient, // topic3: poolOut
            params.sideIn,
            params.sideOut,
            params.amountIn,
            amountOut
        );
    }

    function _supply(uint256 side) internal view returns (uint256 s) {
        return IERC1155Supply(TOKEN).totalSupply(_packID(msg.sender, side));
    }

    function _packID(
        address pool,
        uint256 side
    ) internal pure returns (uint256 id) {
        id = (side << 160) + uint160(pool);
    }

    // v(r)
    function _v(uint256 xk, uint256 r, uint256 R) internal pure returns (uint256 v) {
        if (r <= R >> 1) {
            return FullMath.mulDivRoundingUp(r, Q128, xk);
        }
        uint256 denominator = FullMath.mulDiv(R - r, xk, Q126);
        return FullMath.mulDivRoundingUp(R, R, denominator);
    }
}

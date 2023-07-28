// SPDX-License-Identifier: BSL-1.1
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";
import "@uniswap/lib/contracts/libraries/TransferHelper.sol";
import "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";

import "@derivable/erc1155-maturity/contracts/token/ERC1155/IERC1155Supply.sol";

import "../libs/FullMath.sol";
import "../subs/Constants.sol";
import "../interfaces/IHelper.sol";
import "../interfaces/IPool.sol";
import "../interfaces/IPoolFactory.sol";
import "../interfaces/IWeth.sol";


contract Helper is Constants, IHelper, ERC1155Holder {
    uint internal constant Q254 = 1 << 254;
    uint internal constant Q254M = Q254 - 1;
    uint internal constant SIDE_NATIVE = 0x01;
    uint constant MAX_IN = 0;
    address internal immutable TOKEN;
    address internal immutable WETH;

    constructor(address token, address weth) {
        TOKEN = token;
        WETH = weth;
    }

    // INDEX_R == 0: priceR = 0
    // INDEX_R == Q254 | uint253(p): priceR = p
    // otherwise: priceR = _fetch(INDEX_R)
    struct SwapParams {
        uint sideIn;
        address poolIn;
        uint sideOut;
        address poolOut;
        uint amountIn;
        uint32 maturity;
        address payer;
        address recipient;
        uint INDEX_R;
    }

    struct ChangableSwapParams {
        uint sideIn;
        uint sideOut;
        address payer;
        address recipient;
    }

    event Swap(
        address indexed payer,
        address indexed poolIn,
        address indexed poolOut,
        address recipient,
        uint sideIn,
        uint sideOut,
        uint amountIn,
        uint amountOut,
        uint price,
        uint priceR
    );

    // accepting ETH for WETH.withdraw
    receive() external payable {}

    function _packID(address pool, uint side) internal pure returns (uint id) {
        id = (side << 160) | uint160(pool);
    }

    // v(r)
    function _v(uint xk, uint r, uint R) internal pure returns (uint v) {
        if (r <= R >> 1) {
            return FullMath.mulDivRoundingUp(r, Q128, xk);
        }
        uint denominator = FullMath.mulDivRoundingUp(R - r, xk << 2, Q128);
        return FullMath.mulDivRoundingUp(R, R, denominator);
    }

    function _supply(uint side) internal view returns (uint s) {
        return IERC1155Supply(TOKEN).totalSupply(_packID(msg.sender, side));
    }

    function createPool(Config memory config, State memory state, address factory) external payable returns (address pool) {
        pool = IPoolFactory(factory).createPool(config);
        IWeth(WETH).deposit{value : msg.value}();
        uint amount = IWeth(WETH).balanceOf(address(this));
        IERC20(WETH).approve(pool, amount);
        IPool(pool).init(state, Payment(address(0), address(0), msg.sender));
    }

    function _getPrice(uint INDEX) internal view returns (uint spot) {
        if (INDEX == 0) {
            return 0;
        }
        if (INDEX & Q254 != 0) {
            return INDEX & Q254M;
        }
        return _fetch(INDEX);
    }

    function _fetch(uint INDEX) internal view returns (uint spot) {
        address pool = address(uint160(INDEX));
        (uint160 sqrtSpotX96,,,,,,) = IUniswapV3Pool(pool).slot0();

        spot = sqrtSpotX96 << 32;

        if (INDEX & Q255 == 0) {
            spot = Q256M / spot;
        }
    }

    function _swapMultiPool(SwapParams memory params, address TOKEN_R) internal returns (uint amountOut) {
        // swap poolIn/sideIn to poolIn/R
        bytes memory payload = abi.encode(
            MAX_IN,
            params.sideIn,
            SIDE_R,
            params.amountIn,
            IPool(params.poolIn).loadConfig().PREMIUM_RATE
        );

        (, amountOut) = IPool(params.poolIn).swap(
            Param(
                params.sideIn,
                SIDE_R,
                0,  // R has no expiration
                address(this),
                payload
            ),
            Payment(
                msg.sender, // UTR
                params.payer,
                address(this)
            )
        );

        // TOKEN_R approve poolOut
        IERC20(TOKEN_R).approve(params.poolOut, amountOut);

        // swap (poolIn|PoolOut)/R to poolOut/SideOut
        payload = abi.encode(
            MAX_IN,
            SIDE_R,
            params.sideOut,
            amountOut,
            IPool(params.poolOut).loadConfig().PREMIUM_RATE
        );
        (, amountOut) = IPool(params.poolOut).swap(
            Param(
                SIDE_R,
                params.sideOut,
                params.maturity,
                address(this),
                payload
            ),
            Payment(
                msg.sender, // UTR
                address(0),
                params.recipient
            )
        );

        // check leftOver
        uint leftOver = IERC20(TOKEN_R).balanceOf(address(this));
        if (leftOver > 0) {
            TransferHelper.safeTransfer(TOKEN_R, params.payer, leftOver);
        }

        uint price = _fetch(uint(IPool(params.poolOut).loadConfig().ORACLE));
        uint priceR = _getPrice(params.INDEX_R);

        emit Swap(
            params.payer,
            params.poolIn,
            params.poolOut,
            params.recipient,
            params.sideIn,
            params.sideOut,
            params.amountIn,
            amountOut,
            price,
            priceR
        );
    }

    // TODO: pass the config in from client instead of contract call
    // TODO: handle OPEN_RATE
    function swap(SwapParams memory params) public payable returns (uint amountOut){
        ChangableSwapParams memory __ = ChangableSwapParams(
            params.sideIn,
            params.sideOut,
            params.payer,
            params.recipient
        );

        Config memory config = IPool(params.poolIn).loadConfig();

        address TOKEN_R = config.TOKEN_R;
        if (params.poolIn != params.poolOut) {
            amountOut = _swapMultiPool(params, TOKEN_R);
            return amountOut;
        }

        if (params.sideIn == SIDE_NATIVE) {
            require(TOKEN_R == WETH, 'Reserve token is not Wrapped');
            require(msg.value != 0, 'Value need > 0');
            IWeth(WETH).deposit{value : msg.value}();
            uint amount = IWeth(WETH).balanceOf(address(this));
            IERC20(WETH).approve(params.poolIn, amount);
            params.payer = address(0);
            params.sideIn = SIDE_R;
        }

        if (params.sideOut == SIDE_NATIVE) {
            require(TOKEN_R == WETH, 'Reserve token is not Wrapped');
            params.sideOut = SIDE_R;
            params.recipient = address(this);
        }

        bytes memory payload = abi.encode(
            MAX_IN,
            params.sideIn,
            params.sideOut,
            params.amountIn,
            config.PREMIUM_RATE
        );

        (, amountOut) = IPool(params.poolIn).swap(
            Param(
                params.sideIn,
                params.sideOut,
                0,
                address(this),
                payload
            ),
            Payment(
                msg.sender, // UTR
                params.payer,
                params.recipient
            )
        );

        if (__.sideOut == SIDE_NATIVE) {
            require(TOKEN_R == WETH, 'Reserve token is not Wrapped');
            amountOut = IERC20(WETH).balanceOf(address(this));
            require(amountOut > 0, 'Do not have ETH to transfer');
            IWeth(WETH).withdraw(amountOut);
            TransferHelper.safeTransferETH(__.recipient, amountOut);
        }

        uint price = _fetch(uint(IPool(params.poolOut).loadConfig().ORACLE));
        uint priceR = _getPrice(params.INDEX_R);

        emit Swap(
            __.payer,
            params.poolIn,
            params.poolOut,
            __.recipient,
            __.sideIn,
            __.sideOut,
            params.amountIn,
            amountOut,
            price,
            priceR
        );
    }

    function sweep(
        uint id,
        address recipient
    ) external returns (uint amountOut) {
        amountOut = IERC1155Supply(TOKEN).balanceOf(address(this), id);
        if (amountOut > 0) {
            IERC1155Supply(TOKEN).safeTransferFrom(address(this), recipient, id, amountOut, '');
        }
    }

    function swapToState(
        Slippable calldata __,
        bytes calldata payload
    ) external view override returns (State memory state1) {
        (
            uint swapType,  // TODO: remove this
            uint sideIn,
            uint sideOut,
            uint amount,
            uint PREMIUM_RATE
        ) = abi.decode(payload, (uint, uint, uint, uint, uint));
        require(swapType == MAX_IN, 'Helper: UNSUPPORTED_SWAP_TYPE');

        if (PREMIUM_RATE > 0 && (sideOut == SIDE_A || sideOut == SIDE_B)) {
            require(sideIn == SIDE_R, 'Helper: UNSUPPORTED_SIDEIN_WITH_PREMIUM');
            uint a = _solve(
                __.R,
                __.rA,
                __.rB,
                sideOut,
                amount,
                PREMIUM_RATE
            );
            if (a < amount) {
                // add more input tolerance with high premium
                amount = a - amount/a*amount/a;
            }
        }

        state1.R = __.R;
        (uint rA1, uint rB1) = (__.rA, __.rB);

        if (sideIn == SIDE_R) {
            state1.R += amount;
        } else {
            uint s = _supply(sideIn);
            if (sideIn == SIDE_A) {
                amount = FullMath.mulDiv(amount, __.rA, s);
                rA1 -= amount;
            } else if (sideIn == SIDE_B) {
                amount = FullMath.mulDiv(amount, __.rB, s);
                rB1 -= amount;
            } else /*if (sideIn == SIDE_C)*/ {
                uint rC = __.R - __.rA - __.rB;
                // rounding: A+1, B+1, C-2
                amount = FullMath.mulDiv(amount, rC-2, s+1);
            }
        }

        if (sideOut == SIDE_R) {
            state1.R -= amount;
        } else if (sideOut == SIDE_A) {
            rA1 += amount;
        } else if (sideOut == SIDE_B) {
            rB1 += amount;
        }

        state1.a = _v(__.xk, rA1, state1.R);
        state1.b = _v(Q256M/__.xk, rB1, state1.R);
    }

    function _solve(
        uint R,
        uint rA,
        uint rB,
        uint sideOut,
        uint amount, 
        uint premiumRate
    ) internal pure returns (uint) {
        (uint rOut, uint rTuo) = sideOut == SIDE_A ? (rA, rB) : (rB, rA);
        uint b = rOut > rTuo ? rOut - rTuo : rTuo - rOut;
        uint c = R - rB - rA;
        uint ac = FullMath.mulDiv(amount*c, premiumRate, Q128);
        uint delta = b * b + 4 * ac;
        delta = Math.sqrt(delta);
        if (delta + rTuo <= rOut) {
            return amount;
        }
        return (delta + rTuo - rOut) / 2;
    }
}

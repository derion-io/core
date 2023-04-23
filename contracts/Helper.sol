// SPDX-License-Identifier: BSL-1.1
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";
import "@uniswap/lib/contracts/libraries/TransferHelper.sol";

import "./libraries/Math.sol";
import "./libraries/FullMath.sol";
import "./logics/Constants.sol";
import "./interfaces/IAsymptoticPerpetual.sol";
import "./interfaces/IERC1155Supply.sol";
import "./interfaces/IHelper.sol";
import "./interfaces/IPool.sol";
import "./interfaces/IPoolFactory.sol";
import "./interfaces/IWeth.sol";
import "hardhat/console.sol";

contract Helper is Constants, IHelper {
    uint constant MAX_IN = 0;
    address internal immutable TOKEN;
    address internal immutable WETH;

    constructor(address token, address weth) {
        TOKEN = token;
        WETH = weth;
    }

    struct SwapParams {
        uint sideIn;
        address poolIn;
        uint sideOut;
        address poolOut;
        uint amountIn;
        address payer;
        address recipient;
    }

    function _packID(address pool, uint side) internal pure returns (uint id) {
        id = (side << 160) + uint160(pool);
    }

    // v(r)
    function _v(uint xk, uint r, uint R) internal pure returns (uint v) {
        if (r <= R >> 1) {
            return FullMath.mulDivRoundingUp(r, Q128, xk);
        }
        // TODO: denominator should be rounding up or down?
        uint denominator = FullMath.mulDiv(R - r, xk << 2, Q128);
        return FullMath.mulDivRoundingUp(R, R, denominator);
    }

    function _supply(uint side) internal view returns (uint s) {
        return IERC1155Supply(TOKEN).totalSupply(_packID(msg.sender, side));
    }

    function createPool(Params memory params, address factory) external payable returns (address pool) {
        IWeth(WETH).deposit{value: msg.value}();
        uint amount = IWeth(WETH).balanceOf(address(this));
        address poolAddress = IPoolFactory(factory).computePoolAddress(params);
        console.log(poolAddress);
        IWeth(WETH).transfer(poolAddress, amount);

        pool = IPoolFactory(factory).createPool(params);
    }

    function swapMultiPool(SwapParams memory params) external returns (uint amountOut){
        // swap poolIn/sideIn to poolIn/R
        bytes memory payload = abi.encode(
            uint(0),
            params.sideIn,
            SIDE_R,
            params.amountIn
        );

        (, amountOut) = IPool(params.poolIn).swap(
            params.sideIn,
            SIDE_R,
            address(this),
            payload,
            params.payer,
            address(this)
        );

        // TOKEN_R approve poolOut
        address TOKEN_R = IPool(params.poolIn).TOKEN_R();
        IERC20(TOKEN_R).approve(params.poolOut, amountOut);

        // swap (poolIn|PoolOut)/R to poolOut/SideOut
        payload = abi.encode(
            uint(0),
            SIDE_R,
            params.sideOut,
            amountOut
        );
        (, amountOut) = IPool(params.poolOut).swap(
            SIDE_R,
            params.sideOut,
            address(this),
            payload,
            address(0),
            params.recipient
        );

        // check leftOver
        uint leftOver = IERC20(TOKEN_R).balanceOf(address(this));
        if (leftOver > 0) {
            TransferHelper.safeTransfer(TOKEN_R, params.payer, leftOver);
        }
    }

    function unpackId(uint id) pure public returns (uint, address) {
        uint k = id >> 160;
        address p = address(uint160(uint256(id - k)));
        return (k, p);
    }

    function swapToState(
        Market calldata market,
        State calldata state,
        uint rA,
        uint rB,
        bytes calldata payload
    ) external view override returns (State memory state1) {
        (
        uint swapType,
        uint sideIn,
        uint sideOut,
        uint amount
        ) = abi.decode(payload, (uint, uint, uint, uint));
        require(swapType == MAX_IN, 'Helper: UNSUPPORTED_SWAP_TYPE');
        state1 = State(state.R, state.a, state.b);
        if (sideIn == SIDE_R) {
            state1.R += amount;
            if (sideOut == SIDE_A) {
                state1.a = _v(market.xkA, rA + amount, state1.R);
            } else if (sideOut == SIDE_B) {
                state1.b = _v(market.xkB, rB + amount, state1.R);
            }
        } else {
            uint s = _supply(sideIn);

            if (sideIn == SIDE_A) {
                uint rOut = FullMath.mulDiv(rA, amount, s);
                if (sideOut == SIDE_R) {
                    state1.R -= rOut;
                }
                state1.a = _v(market.xkA, rA - rOut, state1.R);
            } else if (sideIn == SIDE_B) {
                uint rOut = FullMath.mulDiv(rB, amount, s);
                if (sideOut == SIDE_R) {
                    state1.R -= rOut;
                }
                state1.b = _v(market.xkB, rB - rOut, state1.R);
            } else /*if (sideIn == SIDE_C)*/ {
                if (sideOut == SIDE_R) {
                    uint rC = state.R - rA - rB;
                    uint rOut = FullMath.mulDiv(rC, amount, s);
                    state1.R -= rOut;
                }
                // state1.c
            }
        }
    }
}

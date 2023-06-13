// SPDX-License-Identifier: BSL-1.1
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";
import "@uniswap/lib/contracts/libraries/TransferHelper.sol";

import "../libs/FullMath.sol";
import "../logics/Constants.sol";
import "../interfaces/IERC1155Supply.sol";
import "../interfaces/IHelper.sol";
import "../interfaces/IPool.sol";
import "../interfaces/IPoolFactory.sol";
import "../interfaces/IWeth.sol";


contract BadHelper is Constants, IHelper {
    uint internal constant SIDE_NATIVE = 0x000000000000000000000000eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee;
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
        uint32 expiration;
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
        uint amountOut
    );

    // accepting ETH for WETH.withdraw
    receive() external payable {}

    function _packID(address pool, uint side) internal pure returns (uint id) {
        id = (side << 160) + uint160(pool);
    }

    // v(r)
    function _v(uint xk, uint r, uint R) internal view returns (uint v) {
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
        IWeth(WETH).deposit{value : msg.value}();
        uint amount = IWeth(WETH).balanceOf(address(this));
        address poolAddress = IPoolFactory(factory).computePoolAddress(params);
        IWeth(WETH).transfer(poolAddress, amount);

        pool = IPoolFactory(factory).createPool(params);
    }

    function _swapMultiPool(SwapParams memory params, address TOKEN_R) internal returns (uint amountOut) {
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
            0,  // R has no expiration
            params.payer,
            address(this)
        );

        // TOKEN_R approve poolOut
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
            params.expiration,
            address(0),
            params.recipient
        );

        // check leftOver
        uint leftOver = IERC20(TOKEN_R).balanceOf(address(this));
        if (leftOver > 0) {
            TransferHelper.safeTransfer(TOKEN_R, params.payer, leftOver);
        }

        emit Swap(
            params.payer, // topic2: poolIn
            params.poolIn,
            params.poolOut,
            params.recipient, // topic3: poolOut
            params.sideIn,
            params.sideOut,
            params.amountIn,
            amountOut
        );
    }

    function swap(SwapParams memory params) external payable returns (uint amountOut){
        SwapParams memory _params = SwapParams(
            params.sideIn,
            params.poolIn,
            params.sideOut,
            params.poolOut,
            params.amountIn,
            params.expiration,
            params.payer,
            params.recipient
        );

        address TOKEN_R = IPool(params.poolIn).TOKEN_R();
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
            uint(0),
            params.sideIn,
            params.sideOut,
            params.amountIn
        );

        (, amountOut) = IPool(params.poolIn).swap(
            params.sideIn,
            params.sideOut,
            address(this),
            payload,
            0,
            params.payer,
            params.recipient
        );

        if (_params.sideOut == SIDE_NATIVE) {
            require(TOKEN_R == WETH, 'Reserve token is not Wrapped');
            amountOut = IERC20(WETH).balanceOf(address(this));
            require(amountOut > 0, 'Do not have ETH to transfer');
            IWeth(WETH).withdraw(amountOut);
            payable(_params.recipient).transfer(amountOut);
        }

        emit Swap(
            _params.payer,
            _params.poolIn,
            _params.poolOut,
            _params.recipient,
            _params.sideIn,
            _params.sideOut,
            _params.amountIn,
            amountOut
        );
    }

    function unpackId(uint id) pure public returns (uint, address) {
        uint k = id >> 160;
        address p = address(uint160(uint256(id - k)));
        return (k, p);
    }

    function swapToState(
        Market calldata market,
        State calldata state,
        ReserveParam calldata reserveParam,
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
        (uint rA1, uint rB1) = (reserveParam.rA, reserveParam.rB);
        if (sideIn == SIDE_R) {
            if (sideOut == SIDE_B) {
                amount = FullMath.mulDiv(amount, reserveParam.rA, reserveParam.sIn);
                rA1 -= amount;
            } else if (sideOut == SIDE_A) {
                amount = FullMath.mulDiv(amount, reserveParam.rB, reserveParam.sIn);
                rB1 -= amount;
            } else if (sideOut == SIDE_C) {
                --amount; // SIDE_C sacrifices number rounding for A and B
                uint rC = state.R - reserveParam.rA - reserveParam.rB;
                amount = FullMath.mulDiv(amount, rC, reserveParam.sIn);
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
        state1.a = _v(market.xkA, rA1, state1.R);
        state1.b = _v(market.xkB, rB1, state1.R);
    }
}

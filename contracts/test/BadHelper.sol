// SPDX-License-Identifier: BSL-1.1
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";
import "@uniswap/lib/contracts/libraries/TransferHelper.sol";
import "@derivable/shadow-token/contracts/interfaces/IERC1155Supply.sol";

import "../libs/FullMath.sol";
import "../logics/Constants.sol";
import "../interfaces/IHelper.sol";
import "../interfaces/IPool.sol";
import "../interfaces/IPoolFactory.sol";
import "../interfaces/IWeth.sol";


contract BadHelper is Constants, IHelper {
    uint internal constant SIDE_NATIVE = 0x01;
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
        uint32 maturity;
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
            SwapParam(
                params.sideIn,
                SIDE_R,
                0,  // R has no expiration
                address(this),
                payload
            ),
            SwapPayment(
                msg.sender, // UTR
                params.payer,
                address(this)
            )
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
            SwapParam(
                SIDE_R,
                params.sideOut,
                params.maturity,
                address(this),
                payload
            ),
            SwapPayment(
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
            params.maturity,
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
            SwapParam(
                params.sideIn,
                params.sideOut,
                0,
                address(this),
                payload
            ),
            SwapPayment(
                msg.sender, // UTR
                params.payer,
                params.recipient
            )
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
        Slippable calldata __,
        bytes calldata payload
    ) external view override returns (State memory state1) {
        (
            uint openRate,
            uint premiumRate,
            uint swapType,
            uint sideIn,
            uint sideOut,
            uint amount
        ) = abi.decode(payload, (uint, uint, uint, uint, uint, uint));
        require(swapType == MAX_IN, 'Helper: UNSUPPORTED_SWAP_TYPE');
        state1.R = __.R;
        (uint rA1, uint rB1) = (__.rA, __.rB);
        if (sideIn == SIDE_R) {
            uint s = _supply(SIDE_C);
            if (sideOut == SIDE_B) {
                amount = FullMath.mulDiv(amount, __.rA, s);
                rA1 -= amount;
            } else if (sideOut == SIDE_A) {
                amount = FullMath.mulDiv(amount, __.rB, s);
                rB1 -= amount;
            } else if (sideOut == SIDE_C) {
                --amount; // SIDE_C sacrifices number rounding for A and B
                uint rC = __.R - __.rA - __.rB;
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
        state1.b = _v(Q256M/__.xk, rB1, state1.R);
    }
}

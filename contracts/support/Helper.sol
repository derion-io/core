// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";
import "@uniswap/lib/contracts/libraries/TransferHelper.sol";
import '@uniswap/v3-core/contracts/libraries/FullMath.sol';
import "@uniswap/v3-core/contracts/libraries/TickMath.sol";
import "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";
import '@uniswap/v3-core/contracts/libraries/SafeCast.sol';
import "solidity-bytes-utils/contracts/BytesLib.sol";

import "@derion/erc1155-maturity/contracts/token/ERC1155/IERC1155Supply.sol";
import "@derion/utr/contracts/interfaces/IUniversalTokenRouter.sol";
import "@derion/utr/contracts/NotToken.sol";

import "../subs/Constants.sol";
import "../subs/SideConstants.sol";
import "../interfaces/IHelper.sol";
import "../interfaces/IPool.sol";
import "../interfaces/IPositioner.sol";
import "../PoolFactory.sol";
import "../interfaces/IWeth.sol";

import "../interfaces/IPoolForMaturity.sol";
import "./PositionerForMaturity.sol";

contract Helper is SideConstants, Constants, IHelper, ERC1155Holder, NotToken {
    using BytesLib for bytes;

    struct AggregateParams {
        address token;
        address tokenOperator;
        address aggregator;
        bytes aggregatorData;
        address pool;
        uint256 side;
        address payer;          // for event only
        address recipient;
        uint256 INDEX_R;        // for event price data
    }

    // INDEX_R == 0: priceR = 0
    // INDEX_R == Q254 | uint253(p): priceR = p
    // otherwise: priceR = _fetch(INDEX_R)
    struct SwapParams {
        uint256 sideIn;
        address poolIn;
        uint256 sideOut;
        address poolOut;
        uint256 amountIn;
        bytes payer;
        address recipient;
        uint256 INDEX_R;
    }

    struct ChangableSwapParams {
        uint256 sideIn;
        uint256 sideOut;
        address payer;
        address recipient;
    }

    struct SwapAndSwapParams {
        uint256 side;
        address deriPool;
        address uniPool;
        address token;
        uint256 amount;
        bytes payer;
        address recipient;
        uint256 INDEX_R;
    }

    // UniswapV3 struct
    struct SwapCallbackData {
        bytes path;
        address payer;
        address utr;
    }

    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        address pool;
        address recipient;
        address payer;
        address utr;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    uint256 internal constant Q254 = 1 << 254;
    uint256 internal constant Q254M = Q254 - 1;
    uint256 internal constant SIDE_NATIVE = 0x01;
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
        uint256 amountOut,
        uint256 price,
        uint256 priceR,
        uint256 amountR
    );

    constructor(address token, address weth) {
        TOKEN = token;
        WETH = weth;
    }

    // accepting ETH for WETH.withdraw
    receive() external payable {}

    function sweep(
        uint256 id,
        address recipient
    ) external returns (uint256 amountOut) {
        amountOut = IERC1155Supply(TOKEN).balanceOf(address(this), id);
        if (amountOut > 0) {
            IERC1155Supply(TOKEN).safeTransferFrom(address(this), recipient, id, amountOut, '');
        }
    }

    /// @dev swap token to pool.TOKEN_R via an aggregator, then open the position
    /// @dev left-over TOKEN_R in this contract will not be refunded
    /// @dev payer is only used for event data
    function aggregateAndOpen (
        AggregateParams memory params
    ) external payable returns (uint256 amountOut) {
        uint256 amountIn = msg.value;
        if (msg.value == 0) {
            TransferHelper.safeApprove(params.token, params.tokenOperator, type(uint256).max);
            amountIn = IERC20(params.token).balanceOf(address(this));
        }
        { // assembly scope
            (bool success, bytes memory result) = params.aggregator.call{value: msg.value}(params.aggregatorData);
            if (!success) {
                assembly {
                    revert(add(result,32),mload(result))
                }
            }
        }
        if (msg.value == 0) {
            TransferHelper.safeApprove(params.token, params.tokenOperator, 0);
        }

        Config memory config = IPool(params.pool).loadConfig();
        uint256 price;
        uint amountInR = IERC20(config.TOKEN_R).balanceOf(address(this));
        TransferHelper.safeApprove(config.TOKEN_R, params.pool, type(uint256).max);

        // pool.swap
        {
            Payment memory payment = Payment(
                address(0),     // UTR is ignored
                bytes(''),      // ignored, transferFrom msg.sender
                params.recipient
            );

            uint256 payloadAmountInR = FullMath.mulDiv(amountInR, PositionerForMaturity(config.POSITIONER).OPEN_RATE(), Q128);
            // TODO: add payloadAmount rate for input tolerrance

            bytes memory payload = abi.encode(
                SIDE_R,             // sideIn
                params.side,        // sideOut
                payloadAmountInR    // amount
            );

            Result memory result = IPoolForMaturity(params.pool).transition(
                Param(
                    address(this),  // helper's contract
                    payload         // helper's payload
                ),
                payment
            );
            (amountOut, price) = (result.amountOut, result.price);
        }

        // clean up
        TransferHelper.safeApprove(config.TOKEN_R, params.pool, 0);

        uint256 priceR = _getPrice(params.INDEX_R);

        emit Swap(
            params.payer,
            params.token,       // emit the token as poolIn
            params.pool,
            params.recipient,
            SIDE_R,             // emit SIDE_R as sideIn
            params.side,
            amountIn,
            amountOut,
            price,
            priceR,
            amountInR
        );
    }

    // currently unused
    function swapAndOpen (
        SwapAndSwapParams memory params
    ) external returns (uint256 amountOut) {
        Config memory config = IPool(params.deriPool).loadConfig();
        uint256 price;

        amountOut = exactInputSingle(ExactInputSingleParams({
            tokenIn: params.token,
            tokenOut: config.TOKEN_R,
            pool: params.uniPool,
            recipient: address(this),
            payer: BytesLib.toAddress(params.payer, 0),
            utr: msg.sender,
            amountIn: params.amount,
            amountOutMinimum: 0,
            sqrtPriceLimitX96: 0
        }));
        uint amountInR = amountOut;
        TransferHelper.safeApprove(config.TOKEN_R, params.deriPool, amountOut);

        Payment memory payment = Payment(
            msg.sender, // UTR
            bytes(''),
            params.recipient
        );

        bytes memory payload = abi.encode(
            SIDE_R,
            params.side,
            amountOut
        );

        Result memory result = IPoolForMaturity(params.deriPool).transition(
            Param(
                address(this),
                payload
            ),
            payment
        );
        (amountOut, price) = (result.amountOut, result.price);

        if (IERC20(config.TOKEN_R).allowance(address(this), params.deriPool) > 0) {
            TransferHelper.safeApprove(config.TOKEN_R, params.deriPool, 0);
        }

        uint256 priceR = _getPrice(params.INDEX_R);

        emit Swap(
            BytesLib.toAddress(params.payer, 0),
            params.deriPool,
            params.deriPool,
            params.recipient,
            SIDE_R,
            params.side,
            amountInR,
            amountOut,
            price,
            priceR,
            amountInR
        );
    }

    function closeAndSwap (
        SwapAndSwapParams memory params
    ) external returns (uint256 amountOut) {
        Config memory config = IPool(params.deriPool).loadConfig();
        uint256 price;

        Payment memory payment = Payment(
            msg.sender, // UTR
            params.payer,
            address(this)
        );

        bytes memory payload = abi.encode(
            params.side,
            SIDE_R,
            params.amount
        );

        Result memory result = IPoolForMaturity(params.deriPool).transition(
            Param(
                address(this),
                payload
            ),
            payment
        );
        (amountOut, price) = (result.amountOut, result.price);

        uint256 amountOutR = amountOut;

        amountOut = exactInputSingle(ExactInputSingleParams({
            tokenIn: config.TOKEN_R,
            tokenOut: params.token,
            pool: params.uniPool,
            recipient: params.recipient,
            payer: address(this),
            utr: address(0),
            amountIn: amountOut,
            amountOutMinimum: 0,
            sqrtPriceLimitX96: 0
        }));

        uint256 priceR = _getPrice(params.INDEX_R);

        emit Swap(
            BytesLib.toAddress(params.payer, 0),
            params.deriPool,
            params.deriPool,
            params.recipient,
            params.side,
            SIDE_R,
            params.amount,
            amountOutR,
            price,
            priceR,
            amountOutR
        );
    }

    function uniswapV3SwapCallback(
        int256 amount0Delta,
        int256 amount1Delta,
        bytes calldata _data
    ) external {
        require(amount0Delta > 0 || amount1Delta > 0); // swaps entirely within 0-liquidity regions are not supported
        SwapCallbackData memory data = abi.decode(_data, (SwapCallbackData));
        address tokenIn = data.path.toAddress(0);
        address tokenOut = data.path.toAddress(20);
        // TODO: Do we need to verify data, sender?

        (bool isExactInput, uint256 amountToPay) =
            amount0Delta > 0
                ? (tokenIn < tokenOut, uint256(amount0Delta))
                : (tokenOut < tokenIn, uint256(amount1Delta));
        if (isExactInput) {
            _pay(data.utr, tokenIn, data.payer, msg.sender, amountToPay);
        }
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
            state1.R += amount;
        } else {
            uint256 s = _supply(sideIn);
            if (sideIn == SIDE_A) {
                amount = FullMath.mulDiv(amount, __.rA, s);
                rA1 -= amount;
            } else if (sideIn == SIDE_B) {
                amount = FullMath.mulDiv(amount, __.rB, s);
                rB1 -= amount;
            } else /*if (sideIn == SIDE_C)*/ {
                uint256 rC = __.R - __.rA - __.rB;
                if (rC > 1) {
                    --rC;
                }
                amount = FullMath.mulDiv(rC, amount-1, s);
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

    function exactInputSingle(ExactInputSingleParams memory params)
        public
        payable
        returns (uint256 amountOut)
    {
        amountOut = _exactInputInternal(
            params.amountIn,
            params.recipient,
            params.sqrtPriceLimitX96,
            SwapCallbackData({
                path: abi.encodePacked(params.tokenIn, params.tokenOut, params.pool),
                payer: params.payer,
                utr: params.utr
            })
        );
        require(amountOut >= params.amountOutMinimum, 'Too little received');
    }

    function swap(SwapParams memory params) public payable returns (uint256 amountOut) {
        ChangableSwapParams memory __ = ChangableSwapParams(
            params.sideIn,
            params.sideOut,
            BytesLib.toAddress(params.payer, 0),
            params.recipient
        );

        Config memory config = IPool(params.poolIn).loadConfig();

        address TOKEN_R = config.TOKEN_R;
        if (params.poolIn != params.poolOut) {
            amountOut = _swapMultiPool(params, TOKEN_R);
            return amountOut;
        }

        uint256 amountR;
        if (params.sideIn == SIDE_NATIVE) {
            require(TOKEN_R == WETH, 'Reserve token is not Wrapped');
            require(msg.value != 0, 'Value need > 0');
            IWeth(WETH).deposit{value : msg.value}();
            amountR = IWeth(WETH).balanceOf(address(this));
            IERC20(WETH).approve(params.poolIn, amountR);
            params.payer = '';
            params.sideIn = SIDE_R;
        }

        if (params.sideOut == SIDE_NATIVE) {
            require(TOKEN_R == WETH, 'Reserve token is not Wrapped');
            params.sideOut = SIDE_R;
            params.recipient = address(this);
        }

        uint256 price;
        bytes memory payload = abi.encode(
            params.sideIn,
            params.sideOut,
            params.amountIn
        );

        {
            Result memory result = IPoolForMaturity(params.poolIn).transition(
                Param(
                    address(this),
                    payload
                ),
                Payment(
                    msg.sender, // UTR
                    params.payer,
                    params.recipient
                )
            );
            (amountOut, price) = (result.amountOut, result.price);
        }

        if (__.sideOut == SIDE_NATIVE) {
            require(TOKEN_R == WETH, 'Reserve token is not Wrapped');
            amountOut = IERC20(WETH).balanceOf(address(this));
            require(amountOut > 0, 'Do not have ETH to transfer');
            IWeth(WETH).withdraw(amountOut);
            TransferHelper.safeTransferETH(__.recipient, amountOut);
        }

        uint256 priceR = _getPrice(params.INDEX_R);

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
            priceR,
            amountR
        );
    }

    function _swapMultiPool(SwapParams memory params, address TOKEN_R) internal returns (uint256 amountOut) {
        // swap poolIn/sideIn to poolIn/R
        bytes memory payload = abi.encode(
            params.sideIn,
            SIDE_R,
            params.amountIn
        );

        {
            Result memory result = IPoolForMaturity(params.poolIn).transition(
                Param(
                    address(this),
                    payload
                ),
                Payment(
                    msg.sender, // UTR
                    params.payer,
                    address(this)
                )
            );
            amountOut = result.amountOut;
        }

        // TOKEN_R approve poolOut
        IERC20(TOKEN_R).approve(params.poolOut, amountOut);

        uint256 price;

        // swap (poolIn|PoolOut)/R to poolOut/SideOut
        payload = abi.encode(
            SIDE_R,
            params.sideOut,
            amountOut
        );
        uint256 amountR = amountOut;

        {
            Result memory result = IPoolForMaturity(params.poolOut).transition(
                Param(
                    address(this),
                    payload
                ),
                Payment(
                    msg.sender, // UTR
                    '',
                    params.recipient
                )
            );
            (amountOut, price) = (result.amountOut, result.price);
        }

        address payer = BytesLib.toAddress(params.payer, 0);

        // check leftOver
        uint256 leftOver = IERC20(TOKEN_R).balanceOf(address(this));
        if (leftOver > 0) {
            TransferHelper.safeTransfer(TOKEN_R, payer, leftOver);
        }

        uint256 priceR = _getPrice(params.INDEX_R);

        emit Swap(
            payer,
            params.poolIn,
            params.poolOut,
            params.recipient,
            params.sideIn,
            params.sideOut,
            params.amountIn,
            amountOut,
            price,
            priceR,
            amountR
        );
    }

    function _pay(
        address utr,
        address token,
        address payer,
        address recipient,
        uint256 value
    ) internal {
        if (utr == address(0)) {
            TransferHelper.safeTransfer(token, recipient, value);
        } else {
            bytes memory payload = abi.encode(payer, recipient, 20, token, 0);
            IUniversalTokenRouter(utr).pay(payload, value);
        }
    }

    function _getPrice(uint256 INDEX) internal view returns (uint256 spot) {
        if (INDEX == 0) {
            return 0;
        }
        if (INDEX & Q254 != 0) {
            return INDEX & Q254M;
        }
        return _fetch(INDEX);
    }

    function _fetch(uint256 INDEX) internal view returns (uint256 spot) {
        address pool = address(uint160(INDEX));
        uint256 sqrtSpotX96 = _sqrtSpotX96(pool);

        spot = sqrtSpotX96 << 32;

        if (INDEX & Q255 == 0) {
            spot = Q256M / spot;
        }
    }

    function _sqrtSpotX96(address pool) internal view returns (uint256 sqrtSpotX96) {
        bytes memory encodedParams = abi.encodeWithSelector(IUniswapV3PoolState.slot0.selector);
        (bool success, bytes memory result) = pool.staticcall(encodedParams);
        assembly {
            if eq(success, 0) {
                revert(add(result,32), mload(result))
            }
            sqrtSpotX96 := mload(add(result,32))
        }
    }

    function _supply(uint256 side) internal view returns (uint256 s) {
        return IERC1155Supply(TOKEN).totalSupply(_packID(msg.sender, side));
    }

    function _packID(address pool, uint256 side) internal pure returns (uint256 id) {
        id = (side << 160) | uint160(pool);
    }

    // v(r)
    function _v(uint256 xk, uint256 r, uint256 R) internal pure returns (uint256 v) {
        if (r <= R >> 1) {
            return FullMath.mulDivRoundingUp(r, Q128, xk);
        }
        uint256 denominator = FullMath.mulDiv(R - r, xk, Q126);
        return FullMath.mulDivRoundingUp(R, R, denominator);
    }

    function _exactInputInternal(
        uint256 amountIn,
        address recipient,
        uint160 sqrtPriceLimitX96,
        SwapCallbackData memory data
    ) private returns (uint256 amountOut) {
        // allow swapping to the router address with address 0
        if (recipient == address(0)) recipient = address(this);

        address tokenIn = data.path.toAddress(0);
        address tokenOut = data.path.toAddress(20);
        address pool = data.path.toAddress(40);
        bool zeroForOne = tokenIn < tokenOut;

        (int256 amount0, int256 amount1) =
            IUniswapV3Pool(pool).swap(
                recipient,
                zeroForOne,
                SafeCast.toInt256(amountIn),
                sqrtPriceLimitX96 == 0
                    ? (zeroForOne ? TickMath.MIN_SQRT_RATIO + 1 : TickMath.MAX_SQRT_RATIO - 1)
                    : sqrtPriceLimitX96,
                abi.encode(data)
            );

        return uint256(-(zeroForOne ? amount1 : amount0));
    }
}

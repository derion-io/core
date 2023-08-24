// SPDX-License-Identifier: BSL-1.1
pragma solidity 0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";
import "@uniswap/lib/contracts/libraries/TransferHelper.sol";
import '@uniswap/v3-core/contracts/libraries/FullMath.sol';
import "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";
import "solidity-bytes-utils/contracts/BytesLib.sol";

import "@derivable/erc1155-maturity/contracts/token/ERC1155/IERC1155Supply.sol";
import "@derivable/utr/contracts/interfaces/IUniversalTokenRouter.sol";

import "../subs/Constants.sol";
import "../interfaces/IHelper.sol";
import "../interfaces/IPool.sol";
import "../interfaces/IPoolFactory.sol";
import "../interfaces/IWeth.sol";


contract Helper is Constants, IHelper, ERC1155Holder {
    uint256 internal constant Q254 = 1 << 254;
    uint256 internal constant Q254M = Q254 - 1;
    uint256 internal constant SIDE_NATIVE = 0x01;
    address internal immutable TOKEN;
    address internal immutable WETH;
    address internal immutable UTR;

    constructor(address token, address weth, address utr) {
        TOKEN = token;
        WETH = weth;
        UTR = utr;
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
        uint256 priceR
    );

    // accepting ETH for WETH.withdraw
    receive() external payable {}

    function _packID(address pool, uint256 side) internal pure returns (uint256 id) {
        id = (side << 160) | uint160(pool);
    }

    // v(r)
    function _v(uint256 xk, uint256 r, uint256 R) internal pure returns (uint256 v) {
        if (r <= R >> 1) {
            return FullMath.mulDivRoundingUp(r, Q128, xk);
        }
        uint256 denominator = FullMath.mulDivRoundingUp(R - r, xk << 2, Q128);
        return FullMath.mulDivRoundingUp(R, R, denominator);
    }

    function _supply(uint256 side) internal view returns (uint256 s) {
        return IERC1155Supply(TOKEN).totalSupply(_packID(msg.sender, side));
    }

    function createPool(
        Config memory config, State memory state, address factory
    ) external payable returns (address pool) {
        pool = IPoolFactory(factory).createPool(config);
        IWeth(WETH).deposit{value : msg.value}();
        uint256 amount = IWeth(WETH).balanceOf(address(this));
        IERC20(WETH).approve(pool, amount);
        IPool(pool).init(state, Payment(address(0), '', msg.sender));
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
        (uint160 sqrtSpotX96,,,,,,) = IUniswapV3Pool(pool).slot0();

        spot = sqrtSpotX96 << 32;

        if (INDEX & Q255 == 0) {
            spot = Q256M / spot;
        }
    }

    function _swapMultiPool(SwapParams memory params, address TOKEN_R) internal returns (uint256 amountOut) {
        // swap poolIn/sideIn to poolIn/R
        bytes memory payload = abi.encode(
            params.sideIn,
            SIDE_R,
            params.amountIn
        );

        (, amountOut, ) = IPool(params.poolIn).swap(
            Param(
                params.sideIn,
                SIDE_R,
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

        uint256 price;

        // swap (poolIn|PoolOut)/R to poolOut/SideOut
        payload = abi.encode(
            SIDE_R,
            params.sideOut,
            amountOut
        );
        (, amountOut, price) = IPool(params.poolOut).swap(
            Param(
                SIDE_R,
                params.sideOut,
                address(this),
                payload
            ),
            Payment(
                msg.sender, // UTR
                '',
                params.recipient
            )
        );

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
            priceR
        );
    }

    function swap(SwapParams memory params) public payable returns (uint256 amountOut){
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

        if (params.sideIn == SIDE_NATIVE) {
            require(TOKEN_R == WETH, 'Reserve token is not Wrapped');
            require(msg.value != 0, 'Value need > 0');
            IWeth(WETH).deposit{value : msg.value}();
            uint256 amount = IWeth(WETH).balanceOf(address(this));
            IERC20(WETH).approve(params.poolIn, amount);
            params.payer = '';
            params.sideIn = SIDE_R;
        }

        if (params.sideOut == SIDE_NATIVE) {
            require(TOKEN_R == WETH, 'Reserve token is not Wrapped');
            params.sideOut = SIDE_R;
            params.recipient = address(this);
        }

        Payment memory payment = Payment(
            msg.sender, // UTR
            params.payer,
            params.recipient
        );

        // de-dusting only possible with pre-configured UTR
        if (msg.sender == UTR) {
            uint256 idIn = _packID(params.poolIn, params.sideIn);
            bool allIn = params.amountIn == IERC1155(TOKEN).balanceOf(params.payer, idIn);
            if (allIn) {
                payment.utr = address(this);
            }
        }

        uint256 price;
        bytes memory payload = abi.encode(
            params.sideIn,
            params.sideOut,
            params.amountIn
        );

        (, amountOut, price) = IPool(params.poolIn).swap(
            Param(
                params.sideIn,
                params.sideOut,
                address(this),
                payload
            ),
            payment
        );

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
            priceR
        );
    }

    function pay(
        address sender,
        address recipient,
        uint256 eip,
        address token,
        uint256 id,
        uint256 amount
    ) external {
        uint256 balance = IERC1155(token).balanceOf(sender, id);
        if (balance - amount < amount / 100) {
            amount = balance - 1; // don't clear the storage
        }
        IUniversalTokenRouter(UTR).pay(sender, recipient, eip, token, id, amount);
    }

    function sweep(
        uint256 id,
        address recipient
    ) external returns (uint256 amountOut) {
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
}

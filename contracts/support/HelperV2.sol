// SPDX-License-Identifier: BSL-1.1
pragma solidity 0.8.20;

import "@uniswap/v2-core/contracts/interfaces/IUniswapV2Pair.sol";

import "hardhat/console.sol";

import "./Helper.sol";

contract HelperV2 is Helper {
    struct MintLPV2AndSwapParams {
        MintLPV2Params mintParams;
        uint256 side;
        address deriPool;
        address payer;
        address recipient;
        uint256 INDEX_R;
    }

    struct MintLPV2Params {
        address pair;
        address mainToken;
        address otherToken;
        uint256 amountMainDesired;
        uint256 amountOtherToMintFirst;
        uint256 fee10000;
    }

    constructor(address token, address weth) Helper(token, weth) {}

    function mintLPV2AndOpen(
        MintLPV2AndSwapParams memory params
    ) external payable {
        uint amountOut = swapToLP(
            params.mintParams,
            params.payer,
            params.recipient
        );

        uint amountInR = amountOut;
        uint256 price;

        Payment memory payment = Payment(
            msg.sender, // UTR
            abi.encodePacked(params.payer),
            params.recipient
        );

        bytes memory payload = abi.encode(SIDE_R, params.side, amountOut);

        (, amountOut, price) = IPool(params.deriPool).swap(
            Param(SIDE_R, params.side, address(this), payload),
            payment
        );

        uint256 priceR = _getPrice(params.INDEX_R);

        emit Swap(
            params.payer,
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

    function swapToLP(
        MintLPV2Params memory params,
        address payer,
        address recipient
    ) public payable returns (uint amountOut) {
        (
            uint amountMain,
            ,
            uint amountMainToMintFirst,
            uint amountMainToSwap,
            uint amountOtherFromSwap
        ) = getAmountInsForLP(
                params.pair,
                params.mainToken,
                params.otherToken,
                params.amountMainDesired,
                params.amountOtherToMintFirst,
                params.fee10000
            );
        if (msg.value > 0) {
            IWeth(WETH).deposit{value: msg.value}();
        }
        if (amountMainToMintFirst > 0) {
            // both token amount are not sufficient from the start, mint the common LP first
            amountMain -= amountMainToMintFirst;
            _pay(
                msg.sender,
                params.mainToken,
                payer,
                params.pair,
                amountMainToMintFirst
            );
            _pay(
                msg.sender,
                params.otherToken,
                payer,
                params.pair,
                params.amountOtherToMintFirst
            );
            amountOut += IUniswapV2Pair(params.pair).mint(recipient);
        }
        if (amountMainToSwap > 0) {
            // a swap is required, swap from main to other
            amountMain -= amountMainToSwap;
            _pay(
                msg.sender,
                params.mainToken,
                payer,
                params.pair,
                amountMainToSwap
            );
            // swap A->B
            if (params.mainToken < params.otherToken) {
                IUniswapV2Pair(params.pair).swap(
                    0,
                    amountOtherFromSwap,
                    address(this),
                    bytes("")
                );
            } else {
                IUniswapV2Pair(params.pair).swap(
                    amountOtherFromSwap,
                    0,
                    address(this),
                    bytes("")
                );
            }
        }
        // mint the rest (or the only LP)
        _pay(msg.sender, params.mainToken, payer, params.pair, amountMain);
        _pay(
            msg.sender,
            params.otherToken,
            payer,
            params.pair,
            amountOtherFromSwap
        );
        amountOut += IUniswapV2Pair(params.pair).mint(recipient);
    }

    function getAmountInsForLP(
        address pair,
        address mainToken,
        address otherToken,
        uint amountMainDesired,
        uint amountOtherToMintFirst, // <= min(balance, allowance)
        uint fee10000
    )
        public
        view
        returns (
            uint amountMain,
            uint amountOther,
            uint amountMainToMintFirst,
            uint amountMainToSwap,
            uint amountOtherFromSwap
        )
    {
        (uint rMain, uint rOther) = _getReserves(pair, mainToken, otherToken);
        amountMainDesired /= 2;
        amountOther = (amountMainDesired * rOther) / rMain;
        if (amountOther > amountOtherToMintFirst) {
            if (amountOtherToMintFirst > 0) {
                // both token amount are not sufficient from the start, mint the common LP first
                amountMainToMintFirst =
                    (amountOtherToMintFirst * rMain) /
                    rOther;
                amountMain = amountMainToMintFirst;
                amountOther = amountOtherToMintFirst;
                amountMainDesired -= amountMainToMintFirst;
                rMain += amountMainToMintFirst;
                rOther += amountOtherToMintFirst;
            }
            // a swap is required, swap from main to other
            amountMainToSwap = _getSwapAmt(
                rMain,
                amountMainDesired * 2,
                fee10000
            );
            amountOtherFromSwap = _getAmountOut(
                amountMainToSwap,
                rMain,
                rOther,
                fee10000
            );
            amountMain += amountMainToSwap;
            rMain += amountMainToSwap;
            rOther -= amountOtherFromSwap;
            amountMainDesired = (amountOtherFromSwap * rMain) / rOther;
        }
        amountMain += amountMainDesired;
    }

    function _getReserves(
        address pair,
        address tokenA,
        address tokenB
    ) internal view returns (uint reserveA, uint reserveB) {
        (uint reserve0, uint reserve1, ) = IUniswapV2Pair(pair).getReserves();
        (reserveA, reserveB) = tokenA < tokenB
            ? (reserve0, reserve1)
            : (reserve1, reserve0);
    }

    function _getSwapAmt(
        uint res,
        uint amt,
        uint fee
    ) internal pure returns (uint) {
        uint q1997 = (20000 - fee) * (20000 - fee);
        uint u4k997 = 40000 * (10000 - fee);
        return
            (_sqrt(res * (amt * u4k997 + res * q1997)) - res * 19970) / 19940;
    }

    // given an input amount of an asset and pair reserves, returns the maximum output amount of the other asset
    function _getAmountOut(
        uint amountIn,
        uint reserveIn,
        uint reserveOut,
        uint fee
    ) internal pure returns (uint amountOut) {
        uint amountInWithFee = amountIn * (10000 - fee);
        uint numerator = amountInWithFee * (reserveOut);
        uint denominator = reserveIn * 10000 + amountInWithFee;
        amountOut = numerator / denominator;
    }

    function _sqrt(uint y) internal pure returns (uint z) {
        if (y > 3) {
            z = y;
            uint x = y / 2 + 1;
            while (x < z) {
                z = x;
                x = (y / x + x) / 2;
            }
        } else if (y != 0) {
            z = 1;
        }
    }
}

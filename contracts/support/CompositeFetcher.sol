// SPDX-License-Identifier: BSL-1.1
pragma solidity 0.8.20;

import "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";
import "@uniswap/v3-periphery/contracts/libraries/OracleLibrary.sol";
import "../subs/Constants.sol";

contract CompositeFetcher is Constants {
    address internal immutable WETH_USDC;
    address internal immutable WETH_USDT;
    address internal immutable WETH_BTC;

    uint256 constant USDC_INDEX = 0;
    uint256 constant USDT_INDEX = 1;
    uint256 constant BTC_INDEX = 2;


    constructor(
        address weth_usdc,
        address weth_usdt,
        address weth_btc
    ) {
        WETH_USDC = weth_usdc;
        WETH_USDT = weth_usdt;
        WETH_BTC = weth_btc;
    }

    // QTI(1bit)|SQTI(1bit)|SPI(30bit)|WINDOW(32bit)|SWINDOW(32bit)|POOL(160bit)
    function fetch(uint256 ORACLE) public view returns (uint256 twap, uint256 spot) {
        (twap, spot) = _fetchPrice(
            address(uint160(ORACLE)), 
            ORACLE >> 255, 
            uint32(ORACLE >> 192)
        );
        (uint256 sTwap, uint256 sSpot) = _fetchPrice(
            _indexToPool((ORACLE >> 224) % (1 << 30)),
            (ORACLE >> 254) % 2,
            uint32(ORACLE >> 160)
        );
        twap = FullMath.mulDiv(twap, sTwap, Q128);
        spot = FullMath.mulDiv(spot, sSpot, Q128);
    }

    function _fetchPrice(address pool, uint256 qti, uint32 window) internal view returns (uint256 twap, uint256 spot) {
        (uint160 sqrtSpotX96,,,,,,) = IUniswapV3Pool(pool).slot0();
        (int24 arithmeticMeanTick,) = OracleLibrary.consult(pool, window);
        uint256 sqrtTwapX96 = TickMath.getSqrtRatioAtTick(arithmeticMeanTick);

        spot = sqrtSpotX96 << 32;
        twap = sqrtTwapX96 << 32;

        if (qti == 0) {
            spot = Q256M / spot;
            twap = Q256M / twap;
        }
    }

    function _indexToPool(uint256 index) internal view returns (address) {
        if (index == USDC_INDEX) {
            return WETH_USDC;
        }
        if (index == USDT_INDEX) {
            return WETH_USDT;
        }
        return WETH_BTC;
    }
}
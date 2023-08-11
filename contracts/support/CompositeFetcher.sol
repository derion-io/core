// SPDX-License-Identifier: BSL-1.1
pragma solidity ^0.8.0;

import "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";
import "../libs/OracleLibrary.sol";
import "../subs/Constants.sol";

contract CompositeFetcher is Constants {
    address internal immutable WETH_USDC;
    address internal immutable WETH_USDT;
    address internal immutable WETH_BTC;

    uint constant USDC_INDEX = 0;
    uint constant USDT_INDEX = 1;
    uint constant BTC_INDEX = 2;


    constructor(
        address weth_usdc,
        address weth_usdt,
        address weth_btc
    ) {
        WETH_USDC = weth_usdc;
        WETH_USDT = weth_usdt;
        WETH_BTC = weth_btc;
    }

    function fetch(uint ORACLE) public view returns (uint twap, uint spot) {
        (twap, spot) = _fetchPrice(
            address(uint160(ORACLE)), 
            ORACLE >> 255, 
            uint32(ORACLE >> 192)
        );
        (uint sTwap, uint sSpot) = _fetchPrice(
            _indexToPool((ORACLE >> 224) % (1 << 30)),
            (ORACLE >> 254) % 2,
            uint32(ORACLE >> 160)
        );
        twap = FullMath.mulDiv(twap, sTwap, Q128);
        spot = FullMath.mulDiv(spot, sSpot, Q128);
    }

    // QTI(1bit)|SQTI(1bit)|SPI(30bit)|WINDOW(32bit)|SWINDOW(32bit)|POOL(160bit)
    function _unpack(uint ORACLE) internal pure 
    returns (
        address primaryPool,
        uint qti,
        uint sqti,
        uint secondaryPoolIndex,
        uint window,
        uint secondaryWindow
    ) {
        primaryPool = address(uint160(ORACLE));
        qti = ORACLE >> 255;
        sqti = (ORACLE >> 254) % 2;
        secondaryPoolIndex = (ORACLE >> 224) % (1 << 30);
        window = uint32(ORACLE >> 192);
        secondaryWindow = uint32(ORACLE >> 160);
    }

    function _fetchPrice(address pool, uint qti, uint32 window) internal view returns (uint twap, uint spot) {
        (uint160 sqrtSpotX96,,,,,,) = IUniswapV3Pool(pool).slot0();
        (int24 arithmeticMeanTick,) = OracleLibrary.consult(pool, window);
        uint sqrtTwapX96 = TickMath.getSqrtRatioAtTick(arithmeticMeanTick);

        spot = sqrtSpotX96 << 32;
        twap = sqrtTwapX96 << 32;

        if (qti == 0) {
            spot = Q256M / spot;
            twap = Q256M / twap;
        }
    }

    function _indexToPool(uint index) internal view returns (address) {
        if (index == USDC_INDEX) {
            return WETH_USDC;
        }
        if (index == USDT_INDEX) {
            return WETH_USDT;
        }
        return WETH_BTC;
    }
}
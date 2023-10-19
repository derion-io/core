// SPDX-License-Identifier: BSL-1.1
pragma solidity 0.8.20;

import "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";
import "@uniswap/v3-periphery/contracts/libraries/OracleLibrary.sol";
import "../subs/Constants.sol";
import "../interfaces/IFetcher.sol";

contract CompositeFetcher is Constants {
    address internal immutable PAIR_0;
    address internal immutable PAIR_1;
    address internal immutable PAIR_2;
    address internal immutable FETCHER_V2;

    // 0: v2, 1: v3
    uint256 internal immutable PAIR_0_TYPE;
    uint256 internal immutable PAIR_1_TYPE;
    uint256 internal immutable PAIR_2_TYPE;

    uint256 constant PAIR0_INDEX = 0;
    uint256 constant PAIR1_INDEX = 1;
    uint256 constant PAIR2_INDEX = 2;

    uint256 constant POOL_V2 = 0;
    uint256 constant POOL_V3 = 1;

    constructor(
        address pair0,
        uint256 pair0Type,
        address pair1,
        uint256 pair1Type,
        address pair2,
        uint256 pair2Type,
        address fetcherV2
    ) {
        PAIR_0 = pair0;
        PAIR_1 = pair1;
        PAIR_2 = pair2;
        PAIR_0_TYPE = pair0Type;
        PAIR_1_TYPE = pair1Type;
        PAIR_2_TYPE = pair2Type;
        FETCHER_V2 = fetcherV2;
    }

    // QTI(1bit)|SQTI(1bit)|SPI(2bit)|PT(28bit)|WINDOW(32bit)|SWINDOW(32bit)|POOL(160bit)
    function fetch(
        uint256 ORACLE
    ) public returns (uint256 twap, uint256 spot) {
        uint256 poolType = (ORACLE >> 224) % (1 << 28);
        if (poolType == POOL_V3) {
            (twap, spot) = _fetchV3Price(
                address(uint160(ORACLE)),
                ORACLE >> 255,
                uint32(ORACLE >> 192)
            );
        } else if (poolType == POOL_V2) {
            (twap, spot) = IFetcher(FETCHER_V2).fetch(ORACLE);
        } else {
            revert();
        }

        uint256 sTwap;
        uint256 sSpot;
        uint256 sPoolType = _detectSPoolType(_indexToPool((ORACLE >> 252) % 4));
        if (sPoolType == POOL_V3) {
            (sTwap, sSpot) = _fetchV3Price(
                _indexToPool((ORACLE >> 252) % 4),
                (ORACLE >> 254) % 2,
                uint32(ORACLE >> 160)
            );
        } else if (poolType == POOL_V2) {
            (sTwap, sSpot) = IFetcher(FETCHER_V2).fetch(ORACLE);
        } else {
            revert();
        }
        
        twap = FullMath.mulDiv(twap, sTwap, Q128);
        spot = FullMath.mulDiv(spot, sSpot, Q128);
    }

    function _fetchV3Price(
        address pool,
        uint256 qti,
        uint32 window
    ) internal view returns (uint256 twap, uint256 spot) {
        (uint160 sqrtSpotX96, , , , , , ) = IUniswapV3Pool(pool).slot0();
        (int24 arithmeticMeanTick, ) = OracleLibrary.consult(pool, window);
        uint256 sqrtTwapX96 = TickMath.getSqrtRatioAtTick(arithmeticMeanTick);

        spot = sqrtSpotX96 << 32;
        twap = sqrtTwapX96 << 32;

        if (qti == 0) {
            spot = Q256M / spot;
            twap = Q256M / twap;
        }
    }

    // 0: v2, 1: v3
    function _detectSPoolType(address pool) internal view returns (uint256) {
        if (
            (pool == PAIR_0 && PAIR_0_TYPE == 0) ||
            (pool == PAIR_1 && PAIR_1_TYPE == 0) ||
            (pool == PAIR_2 && PAIR_2_TYPE == 0)
        ) {
            return POOL_V2;
        } else {
            return POOL_V3;
        }
    }

    function _indexToPool(uint256 index) internal view returns (address) {
        if (index == PAIR0_INDEX) {
            return PAIR_0;
        }
        if (index == PAIR1_INDEX) {
            return PAIR_1;
        }
        return PAIR_2;
    }
}

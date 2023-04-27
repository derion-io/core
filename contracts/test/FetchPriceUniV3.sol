// SPDX-License-Identifier: BSL-1.1
pragma solidity ^0.8.0;

import "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";
import "../libs/OracleLibrary.sol";

contract FetchPriceUniV3 {
    uint internal constant Q255 = 1 << 255;
    uint internal constant Q256M = type(uint).max;

    function fetch(
        bytes32 ORACLE // 1bit QTI, 31bit reserve, 32bit WINDOW, ... PAIR ADDRESS
    ) external view returns (uint twap, uint spot) {
        address pool = address(uint160(uint(ORACLE)));
        (uint160 sqrtSpotX96,,,,,,) = IUniswapV3Pool(pool).slot0();

        (int24 arithmeticMeanTick,) = OracleLibrary.consult(pool, uint32(uint(ORACLE) >> 192));
        uint sqrtTwapX96 = TickMath.getSqrtRatioAtTick(arithmeticMeanTick);

        spot = sqrtSpotX96 << 32;
        twap = sqrtTwapX96 << 32;

        if (uint(ORACLE) & Q255 == 0) {
            spot = Q256M / spot;
            twap = Q256M / twap;
        }
    }
}
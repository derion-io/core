// SPDX-License-Identifier: BSL-1.1
pragma solidity 0.8.20;

import "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";
import "@uniswap/v3-periphery/contracts/libraries/OracleLibrary.sol";
import "./subs/Constants.sol";

contract Fetcher is Constants {
    function fetch(uint256 ORACLE) public view returns (uint256 twap, uint256 spot) {
        address pool = address(uint160(ORACLE));
        (uint160 sqrtSpotX96,,,,,,) = IUniswapV3Pool(pool).slot0();

        (int24 arithmeticMeanTick,) = OracleLibrary.consult(pool, uint32(ORACLE >> 192));
        uint256 sqrtTwapX96 = TickMath.getSqrtRatioAtTick(arithmeticMeanTick);

        spot = sqrtSpotX96 << 32;
        twap = sqrtTwapX96 << 32;

        if (ORACLE & Q255 == 0) {
            spot = Q256M / spot;
            twap = Q256M / twap;
        }
    }
}
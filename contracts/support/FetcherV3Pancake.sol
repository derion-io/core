// SPDX-License-Identifier: BSL-1.1
pragma solidity >=0.5.0 <0.8.0;

import "@pancakeswap/v3-core/contracts/interfaces/IPancakeV3Pool.sol";
import "@pancakeswap/v3-periphery/contracts/libraries/OracleLibrary.sol";

/// @title The default Fetcher code for PancakeV3 Oracle
/// @author Derivable Labs
contract FetcherV3Pancake {
    uint256 internal constant Q255 = 1 << 255;
    uint256 internal constant Q256M = type(uint256).max;

    /// fetch the price from ORACLE config
    /// @param ORACLE 1bit QTI, 31bit reserve, 32bit WINDOW, ... PAIR ADDRESS
    /// @return twap the time-weighted average price of the oracle
    /// @return spot the latest price of the oracle
    function fetch(
        uint256 ORACLE
    ) public view returns (uint256 twap, uint256 spot) {
        address pool = address(uint160(ORACLE));
        (uint160 sqrtSpotX96, , , , , , ) = IPancakeV3Pool(pool).slot0();

        (int24 arithmeticMeanTick, ) = OracleLibrary.consult(
            pool,
            uint32(ORACLE >> 192)
        );
        uint256 sqrtTwapX96 = TickMath.getSqrtRatioAtTick(arithmeticMeanTick);

        spot = sqrtSpotX96 << 32;
        twap = sqrtTwapX96 << 32;

        if (ORACLE & Q255 == 0) {
            spot = Q256M / spot;
            twap = Q256M / twap;
        }
    }
}

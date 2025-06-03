// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.28;

import '@uniswap/v3-core/contracts/libraries/FullMath.sol';
import "../interfaces/AggregatorV3Interface.sol";
import "../subs/Constants.sol";

contract ChainlinkFetcher is Constants {
    // DEVIATION(32bit)|DECIMALS(32bit) ... FEED(160bit)
    function fetch(
        uint256 ORACLE
    ) public view returns (uint256 twap, uint256 spot) {
        int256 answer = _fetchPrice(address(uint160(ORACLE)));

        uint32 decimals = uint32(ORACLE >> 192);
        uint256 priceX128 = FullMath.mulDiv(uint256(answer), Q128, 10 ** decimals);

        uint32 deviation = uint32(ORACLE >> 224);
        if (deviation == 0) {
            return (priceX128, priceX128);
        }
        twap = FullMath.mulDiv(priceX128, Q32 - deviation, Q32);
        spot = FullMath.mulDivRoundingUp(priceX128, Q32 + deviation, Q32);
    }

    function _fetchPrice(address feed) internal view returns (int256 answer) {
        AggregatorV3Interface aggregator = AggregatorV3Interface(feed);
        (, answer, , , ) = aggregator.latestRoundData();
    }
}
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
        uint32 deviation = uint32(ORACLE >> 224);
        uint32 decimals = uint32(ORACLE >> 192);
        (twap, spot) = _fetchPrice(
            address(uint160(ORACLE)),
            deviation,
            decimals
        );
    }

    function _fetchPrice(
        address feed,
        uint32 deviation,
        uint32 decimals
    ) internal view returns (uint256 twap, uint256 spot) {
        AggregatorV3Interface aggregator = AggregatorV3Interface(feed);
        (, int256 answer, , , ) = aggregator.latestRoundData();
        uint256 answerQ128 = FullMath.mulDiv(uint256(answer), Q128, 10 ** decimals);

        twap = FullMath.mulDiv(answerQ128, Q32 - deviation, Q32);
        spot = FullMath.mulDivRoundingUp(answerQ128, Q32 + deviation, Q32);
    }
}
// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.28;

import '@uniswap/v3-core/contracts/libraries/FullMath.sol';
import "../interfaces/AggregatorV3Interface.sol";
import "../subs/Constants.sol";

contract ChainlinkFetcher is Constants {
    // (32bit)|(32bit)|DECIMALS(32bit)|FEED(160bit)
    function fetch(
        uint256 ORACLE
    ) public view returns (uint256 twap, uint256 spot) {
        address feed = address(uint160(ORACLE));
        uint256 price = _fetchChainlink(feed);
        uint32 decimals = uint32(ORACLE >> 160);
        twap = spot = FullMath.mulDiv(price, Q128, 10 ** decimals);
    }

    function _fetchChainlink(address feed) internal view returns (uint256 price) {
        AggregatorV3Interface aggregator = AggregatorV3Interface(feed);
        (, int256 answer, , , ) = aggregator.latestRoundData();
        return uint256(answer);
    }
}
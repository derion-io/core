// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.28;

import '@uniswap/v3-core/contracts/libraries/FullMath.sol';
import "../interfaces/AggregatorV3Interface.sol";
import "../subs/Constants.sol";

contract ChainlinkFetcher is Constants {
    /// @param ORACLE:
    ///    255 QTI              0x8...
    ///    248 CHAINLINK        0x.1..
    ///    192-161: WINDOW      0x....xxxx
    ///    160-0: PAIR/FEED
    function fetch(
        uint256 ORACLE
    ) public view returns (uint256 twap, uint256 spot) {
        address feed = address(uint160(ORACLE));
        uint256 price = _fetchChainlink(feed);
        return (price, price);
    }

    function _fetchChainlink(address feed) internal view returns (uint256 price) {
        AggregatorV3Interface aggregator = AggregatorV3Interface(feed);
        (, int256 answer, , , ) = aggregator.latestRoundData();
        require(answer >= 0, "negative price");
        return uint256(answer);
    }
}
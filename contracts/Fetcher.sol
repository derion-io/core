// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.28;


import "@uniswap/v3-core/contracts/interfaces/pool/IUniswapV3PoolState.sol";
import "@uniswap/v3-periphery/contracts/libraries/OracleLibrary.sol";
import "./interfaces/AggregatorV3Interface.sol";
import "./interfaces/IFetcher.sol";
import "./subs/Constants.sol";

/// @title The default Fetcher code for UniswapV3 Oracle
/// @author Derivable Labs
contract Fetcher is Constants, IFetcher {
    /// fetch the price from ORACLE config
    /// @param ORACLE:
    ///    255 QTI              0x8...
    ///    248 CHAINLINK        0x.1..
    ///    192-161: WINDOW      0x....xxxx
    ///    160-0: PAIR/FEED
    /// @return twap the time-weighted average price of the oracle
    /// @return spot the latest price of the oracle
    function fetch(
        uint256 ORACLE
    ) public view returns (uint256 twap, uint256 spot) {
        address pool = address(uint160(ORACLE));
        bool isChainlink = ORACLE & Q248 != 0;

        if (isChainlink) {
            uint256 price = _fetchChainlink(pool);
            return (price, price);
        }

        uint256 sqrtSpotX96 = _sqrtSpotX96(pool);

        uint32 window = uint32(ORACLE >> 192);
        (int24 arithmeticMeanTick, ) = OracleLibrary.consult(pool, window);
        uint256 sqrtTwapX96 = TickMath.getSqrtRatioAtTick(arithmeticMeanTick);

        spot = sqrtSpotX96 << 32;
        twap = sqrtTwapX96 << 32;

        if (ORACLE & Q255 == 0) {
            spot = Q256M / spot;
            twap = Q256M / twap;
        }
    }

    function _sqrtSpotX96(address pool) internal view returns (uint256 sqrtSpotX96) {
        bytes memory encodedParams = abi.encodeWithSelector(IUniswapV3PoolState.slot0.selector);
        (bool success, bytes memory result) = pool.staticcall(encodedParams);
        assembly {
            if eq(success, 0) {
                revert(add(result,32), mload(result))
            }
            sqrtSpotX96 := mload(add(result,32))
        }
    }

    function _fetchChainlink(address feed) internal view returns (uint256 price) {
        AggregatorV3Interface aggregator = AggregatorV3Interface(feed);
        (, int256 answer, , , ) = aggregator.latestRoundData();
        require(answer >= 0, "negative price");
        return uint256(answer);
    }
}

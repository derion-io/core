// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "../interfaces/IFetcher.sol";
import "@uniswap/v3-core/contracts/libraries/FullMath.sol";

interface IUniswapV2Pair {
    function factory() external view returns (address);

    function token0() external view returns (address);

    function token1() external view returns (address);

    function getReserves()
        external
        view
        returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast);
}

contract FetcherV2Mock is IFetcher {

    uint256 internal constant Q128 = 1 << 128;

    function fetch(
        uint256 ORACLE
    ) override external view returns (uint256 twap, uint256 spot) {
        address pair = address(uint160(ORACLE));
        uint256 qti = ORACLE >> 255;

        (uint rb, uint rq, ) = IUniswapV2Pair(pair).getReserves();
        if (qti == 0) {
            (rb, rq) = (rq, rb);
        }
        spot = FullMath.mulDiv(Q128, rq, rb);
        twap = spot;
    }
}
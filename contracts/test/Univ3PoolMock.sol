// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.8.20;

import '@uniswap/v3-core/contracts/libraries/TickMath.sol';


contract Univ3PoolMock {
    uint160 spot;
    uint160 twap;
    address public token0;
    address public token1;

    constructor(
        uint160 _spot,
        uint160 _twap,
        address _token0,
        address _token1
    ) {
        spot = _spot;
        twap = _twap;
        token0 = _token0;
        token1 = _token1;
    }

    function setPrice(uint160 _spot, uint160 _twap) external {
        spot = _spot;
        twap = _twap;
    }

    function slot0()
        external
        view
        returns (
            uint160 sqrtPriceX96,
            int24 tick,
            uint16 observationIndex,
            uint16 observationCardinality,
            uint16 observationCardinalityNext,
            uint8 feeProtocol,
            bool unlocked
        ) {
        return (
            TickMath.getSqrtRatioAtTick(TickMath.getTickAtSqrtRatio(spot)),
            0,
            0,
            0,
            0,
            0,
            false
        );
    }

    function observe(uint32[] calldata secondsAgos)
    external
    view
    returns (int56[] memory tickCumulatives, uint160[] memory secondsPerLiquidityCumulativeX128s) {
        tickCumulatives = new int56[](2);
        secondsPerLiquidityCumulativeX128s = new uint160[](2);
        tickCumulatives[0] = 0;
        tickCumulatives[1] = int56(TickMath.getTickAtSqrtRatio(twap)) * int56(int(uint256(secondsAgos[0])));
        secondsPerLiquidityCumulativeX128s[0] = 0;
        secondsPerLiquidityCumulativeX128s[1] = 10000000;
    }
}
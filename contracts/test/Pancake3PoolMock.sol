// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity 0.7.6;

import "@pancakeswap/v3-core/contracts/libraries/TickMath.sol";

contract Pancake3PoolMock {
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
        token0 = _token0;
        token1 = _token1;
        setPrice(_spot, _twap);
    }

    function setPrice(uint160 _spot, uint160 _twap) public {
        spot = _spot;
        twap = _twap;
        slot0.sqrtPriceX96 = TickMath.getSqrtRatioAtTick(TickMath.getTickAtSqrtRatio(_spot));
    }

    struct Slot0 {
        // the current price
        uint160 sqrtPriceX96;
        // the current tick
        int24 tick;
        // the most-recently updated index of the observations array
        uint16 observationIndex;
        // the current maximum number of observations that are being stored
        uint16 observationCardinality;
        // the next maximum number of observations to store, triggered in observations.write
        uint16 observationCardinalityNext;
        // the current protocol fee for token0 and token1,
        // 2 uint32 values store in a uint32 variable (fee/PROTOCOL_FEE_DENOMINATOR)
        uint32 feeProtocol;
        // whether the pool is locked
        bool unlocked;
    }
    Slot0 public slot0;

    // function slot0()
    //     external
    //     view
    //     returns (
    //         uint160 sqrtPriceX96,
    //         int24 tick,
    //         uint16 observationIndex,
    //         uint16 observationCardinality,
    //         uint16 observationCardinalityNext,
    //         uint32 feeProtocol,
    //         bool unlocked
    //     )
    // {
    //     return (
    //         TickMath.getSqrtRatioAtTick(TickMath.getTickAtSqrtRatio(spot)),
    //         0,
    //         0,
    //         0,
    //         0,
    //         0,
    //         false
    //     );
    // }

    function observe(
        uint32[] calldata secondsAgos
    )
        external
        view
        returns (
            int56[] memory tickCumulatives,
            uint160[] memory secondsPerLiquidityCumulativeX128s
        )
    {
        tickCumulatives = new int56[](2);
        secondsPerLiquidityCumulativeX128s = new uint160[](2);
        tickCumulatives[0] = 0;
        tickCumulatives[1] =
            int56(TickMath.getTickAtSqrtRatio(twap)) *
            int56(int(uint256(secondsAgos[0])));
        secondsPerLiquidityCumulativeX128s[0] = 0;
        secondsPerLiquidityCumulativeX128s[1] = 10000000;
    }
}

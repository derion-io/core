// SPDX-License-Identifier: BSL-1.1
pragma solidity 0.8.20;

contract Storage {
    // the last time interest is charged
    uint32  internal s_lastInterestTime;

    // the LONG coefficient of the pool
    uint224 internal s_a;

    // uint31: the last time premium is charged
    // uint1: reentrant lock 
    uint32  internal s_lastPremiumTime;

    // the SHORT coefficient of the pool
    uint224 internal s_b;

    uint32  internal s_lastVolatilityTime;
    uint256 internal s_lastTwap;
}
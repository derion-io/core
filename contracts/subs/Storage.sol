// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.28;

contract Storage {
    // the last time interest is charged
    uint32  internal s_lastInterestTime;

    // the LONG coefficient of the pool
    uint224 internal s_a;

    // the last time premium is charged
    uint32  internal s_lastPremiumTime;

    // the SHORT coefficient of the pool
    uint224 internal s_b;
}
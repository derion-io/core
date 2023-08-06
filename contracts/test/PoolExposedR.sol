// SPDX-License-Identifier: SEE LICENSE IN LICENSE
pragma solidity ^0.8.0;

import "../PoolLogic.sol";

contract PoolExposedR is PoolLogic {
  constructor(
    address token,
    address feeTo,
    uint feeRate
  ) PoolLogic(token, feeTo, feeRate) {}

  function getReserves() external returns (uint rA, uint rB, uint rC) {
    Config memory config = loadConfig();
    uint R = _reserve(config.TOKEN_R);
    State memory state = State(R, s_a, s_b);
    {
      uint elapsed = block.timestamp - s_i;
      if (elapsed > 0) {
        uint interestRateX64 = _expRate(elapsed, config.INTEREST_HL);
        if (interestRateX64 > Q64) {
          uint a = FullMath.mulDivRoundingUp(state.a, Q64, interestRateX64);
          uint b = FullMath.mulDivRoundingUp(state.b, Q64, interestRateX64);
          if (a < state.a || b < state.b) {
            state.a = a;
            state.b = b;
          }
        }
      }
    }
    (, rA, rB,) = _selectPrice(config, state, SIDE_R, SIDE_C);
    rC = R - rA -rB;
  }
}
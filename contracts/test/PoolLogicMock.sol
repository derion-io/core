// SPDX-License-Identifier: BSL-1.1
pragma solidity ^0.8.0;

import "../PoolLogic.sol";

contract PoolLogicMock is PoolLogic {
  constructor(
    address token,
    address feeTo,
    uint feeRate
  ) PoolLogic(token, feeTo, feeRate) {}

  function loadState(
    uint224 a,
    uint224 b,
    uint32 f,
    uint32 i,
    uint sA,
    uint sB,
    uint sC
  ) external {
    Config memory config = loadConfig();
    s_a = a;
    s_b = b;
    s_f = f;
    s_i = i;
    uint curSA = _supply(SIDE_A);
    uint curSB = _supply(SIDE_B);
    uint curSC = _supply(SIDE_C);
    if (sA < curSA) {
      IToken(TOKEN).burn(msg.sender, _packID(address(this), SIDE_A), curSA - sA);
    } else {
      IToken(TOKEN).mintLock(msg.sender, _packID(address(this), SIDE_A), sA - curSA, uint32(config.MATURITY), "");
    }

    if (sB < curSB) {
      IToken(TOKEN).burn(msg.sender, _packID(address(this), SIDE_B), curSB - sB);
    } else {
      IToken(TOKEN).mintLock(msg.sender, _packID(address(this), SIDE_B), sB - curSB, uint32(config.MATURITY), "");
    }

    if (sC < curSC) {
      IToken(TOKEN).burn(msg.sender, _packID(address(this), SIDE_C), curSC - sC);
    } else {
      IToken(TOKEN).mintLock(msg.sender, _packID(address(this), SIDE_C), sC - curSC, uint32(config.MATURITY), "");
    }
  }
}

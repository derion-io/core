// SPDX-License-Identifier: BSL-1.1
pragma solidity ^0.8.0;

contract Storage {
    uint32  internal s_i;
    uint224 internal s_a;
    uint32  internal s_f;   // the first bit is use for reentrant lock
    uint224 internal s_b;
    uint240 internal s_rCLast;
    bool internal s_rCLastIn;
}
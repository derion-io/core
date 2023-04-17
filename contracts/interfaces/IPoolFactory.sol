// SPDX-License-Identifier: BSL-1.1
pragma solidity ^0.8.0;

struct Params {
    address utr;
    address token;
    address logic;
    bytes32 oracle; // 1bit QTI, 31bit reserve, 32bit WINDOW, ... PAIR ADDRESS
    address reserveToken;
    address recipient;
    uint mark;
    uint32  initTime;
    uint    halfLife;
    uint k;
    uint a;
    uint b;
}

interface IPoolFactory {
    function getParams() external view returns (Params memory);
}

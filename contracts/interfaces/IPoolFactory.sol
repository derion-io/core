// SPDX-License-Identifier: BSL-1.1
pragma solidity ^0.8.0;

struct Params {
    address logic;
    bytes32 oracle; // 1bit QTI, 31bit reserve, 32bit WINDOW, ... PAIR ADDRESS
    address tokenCollateral;
    address recipient;
    uint224 markPrice;
    uint32 time;
    uint power;
    uint a;
    uint b;
}

interface IPoolFactory {
    function getParams() external view returns (Params memory);
    function TOKEN() external view returns (address);
}

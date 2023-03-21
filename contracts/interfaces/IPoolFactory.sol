// SPDX-License-Identifier: BSL-1.1
pragma solidity ^0.8.0;

struct Params {
    address logic;
    address tokenOracle;
    address tokenCollateral;
    address recipient;
    uint224 markPrice;
    uint power;
    uint a;
    uint b;
}

interface IPoolFactory {
    function getParams() external view returns (Params memory);
    function TOKEN() external view returns (address);
}

// SPDX-License-Identifier: BSL-1.1
pragma solidity ^0.8.0;

struct Config {
    address TOKEN;
    address TOKEN_R;
    bytes32 ORACLE;
    uint224 MARK;
}

interface IAsymptoticPerpetual {
    function init(
        address TOKEN_R,
        bytes32 ORACLE,
        uint224 MARK,
        uint power,
        uint a,
        uint b
    ) external returns (uint rA, uint rB, uint rC);

    function exactIn(
        Config memory config,
        uint sideIn,
        uint amountIn,
        uint sideOut
    ) external returns(uint amountOut);
}

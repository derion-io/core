// SPDX-License-Identifier: BSL-1.1
pragma solidity ^0.8.0;

struct SwapParam {
    uint zeroInterestTime;
    address helper;
    bytes payload;
}

struct Market {
    uint xkA;
    uint xkB;
}

struct State {
    uint R;
    uint a;
    uint b;
}

interface IAsymptoticPerpetual {
    function ORACLE() external view returns (bytes32);
    function TOKEN_R() external view returns (address);
    function K() external view returns (uint);
}
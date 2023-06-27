// SPDX-License-Identifier: BSL-1.1
pragma solidity ^0.8.0;

struct Config {
    address TOKEN;
    address TOKEN_R;
    bytes32 ORACLE;
    uint K;
    uint MARK;
    uint INIT_TIME; // TODO: change to uint32
    uint HALF_LIFE; // TODO: change to uint32
    uint PREMIUM_RATE;
}

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

interface IPool {
    function ORACLE() external view returns (bytes32);
    function TOKEN_R() external view returns (address);
    function K() external view returns (uint);
    function swap(
        uint sideIn,
        uint sideOut,
        address helper,
        bytes calldata payload,
        uint32 maturity,
        address payer,
        address recipient
    ) external returns(uint amountIn, uint amountOut);
}
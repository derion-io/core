// SPDX-License-Identifier: BSL-1.1
pragma solidity ^0.8.0;

struct SwapParam {
    uint sideIn;
    uint sideOut;
    uint maturity;
    address helper;
    bytes payload;
}

struct SwapPayment {
    address utr;
    address payer;
    address recipient;
}

struct State {
    uint R;
    uint a;
    uint b;
}

struct Slippable {
    uint xk;
    uint R;
    uint rA;
    uint rB;
}

interface IPool {
    function ORACLE() external view returns (bytes32);
    function TOKEN_R() external view returns (address);
    function K() external view returns (uint);
    function PREMIUM_RATE() external view returns (uint);
    function OPEN_RATE() external view returns (uint);
    function swap(
        SwapParam memory param,
        SwapPayment memory payment
    ) external returns(uint amountIn, uint amountOut);
}
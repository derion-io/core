// SPDX-License-Identifier: BSL-1.1
pragma solidity ^0.8.0;

struct Config {
    bytes32 ORACLE; // 1bit QTI, 31bit reserve, 32bit WINDOW, ... PAIR ADDRESS
    address TOKEN_R;
    uint    K;
    uint    MARK;
    uint    INTEREST_HL;
    uint    PREMIUM_HL;
    uint    MATURITY;
    uint    MATURITY_VEST;
    uint    MATURITY_RATE;   // x128
    uint    OPEN_RATE;
}

struct Param {
    uint sideIn;
    uint sideOut;
    address helper;
    bytes payload;
}

struct Payment {
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
    function loadConfig() view external returns (Config memory);
    function init(State memory state, Payment memory payment) external;
    function swap(
        Param memory param,
        Payment memory payment
    ) external returns(uint amountIn, uint amountOut, uint price);
}
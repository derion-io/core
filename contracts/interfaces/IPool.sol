// SPDX-License-Identifier: BSL-1.1
pragma solidity ^0.8.0;

struct Config {
    address FEE_TO;
    uint    HL_FEE;
    address TOKEN;
    bytes32 ORACLE; // 1bit QTI, 31bit reserve, 32bit WINDOW, ... PAIR ADDRESS
    address TOKEN_R;
    uint    K;
    uint    MARK;
    uint    HL_INTEREST;
    uint    PREMIUM_RATE;
    uint32  MATURITY;
    uint32  MATURITY_VEST;
    uint    MATURITY_RATE;   // x128
    uint    OPEN_RATE;
}

struct Params {
    uint R;
    uint a;
    uint b;
}

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
    function loadConfig() view external returns (Config memory);
    function init(Params memory params, SwapPayment memory payment) external;
    function swap(
        SwapParam memory param,
        SwapPayment memory payment
    ) external returns(uint amountIn, uint amountOut);
}
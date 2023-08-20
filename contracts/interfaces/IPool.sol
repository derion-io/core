// SPDX-License-Identifier: BSL-1.1
pragma solidity >=0.8.0;

struct Config {
    address FETCHER;
    bytes32 ORACLE; // 1bit QTI, 31bit reserve, 32bit WINDOW, ... PAIR ADDRESS
    address TOKEN_R;
    uint256    K;
    uint256    MARK;
    uint256    INTEREST_HL;
    uint256    PREMIUM_HL;
    uint256    MATURITY;
    uint256    MATURITY_VEST;
    uint256    MATURITY_RATE;   // x128
    uint256    OPEN_RATE;
}

struct Param {
    uint256 sideIn;
    uint256 sideOut;
    address helper;
    bytes payload;
}

struct Payment {
    address utr;
    address payer;
    address recipient;
}

struct State {
    uint256 R;
    uint256 a;
    uint256 b;
}

struct Slippable {
    uint256 xk;
    uint256 R;
    uint256 rA;
    uint256 rB;
}

interface IPool {
    function loadConfig() view external returns (Config memory);
    function init(State memory state, Payment memory payment) external;
    function swap(
        Param memory param,
        Payment memory payment
    ) external returns(uint256 amountIn, uint256 amountOut, uint256 price);
}
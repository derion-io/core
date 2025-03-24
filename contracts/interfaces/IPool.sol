// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.28;

struct Config {
    bytes32 ORACLE; // 1bit QTI, 31bit reserve, 32bit WINDOW, ... PAIR ADDRESS
    address TOKEN_R;
    uint256 K;
    uint256 MARK;
    uint256 INTEREST_HL;
    uint256 PREMIUM_HL;
    address POSITIONER;
}

struct Param {
    address helper;
    bytes payload;
}

/// if payer.length == 0: payment is transferFrom msg.sender and utr is ignored
/// if payer.length != 20: payer is passed as utr.pay's payload bytes
/// if payer.length == 20: utr.pay's payload is constructed with payer address
struct Payment {
    address utr;
    bytes payer;
    address recipient;
}

// represent a single pool state
struct State {
    uint256 R; // pool reserve
    uint256 a; // LONG coefficient
    uint256 b; // SHORT coefficient
}

struct Result {
    uint256 amountIn;
    uint256 amountOut;
    uint256 price;
}

struct Receipt {
    uint256 price;
    uint256 R;
    uint256 rA;
    uint256 rB;
    uint256 R1;
    uint256 rA1;
    uint256 rB1;
}

// anything that can be changed between tx construction and confirmation
struct Slippable {
    uint256 xk; // (price/MARK)^K
    uint256 R; // pool reserve
    uint256 rA; // LONG reserve
    uint256 rB; // SHORT reserve
}

interface IPool {
    function initialize(State memory state, Payment memory payment) external;

    function transition(
        Param memory param,
        Payment memory payment
    ) external returns (Result memory);

    function loadConfig() external view returns (Config memory);
}

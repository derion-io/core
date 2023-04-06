// SPDX-License-Identifier: BSL-1.1
pragma solidity ^0.8.0;

interface IPool {
    function exactIn(
        uint sideIn,
        uint amountIn,
        uint sideOut,
        address payer,
        address recipient
    ) external returns(uint amountOut);
}
// SPDX-License-Identifier: BSL-1.1
pragma solidity ^0.8.0;

interface IAsymptoticPerpetual {
    function exactIn(
        address TOKEN_COLLATERAL,
        bytes32 ORACLE,
        uint224 MARK,
        uint kindIn,
        uint amountIn,
        uint kindOut,
        address recipient
    ) external returns(uint amountOut);
}

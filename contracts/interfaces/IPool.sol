// SPDX-License-Identifier: BSL-1.1
pragma solidity ^0.8.0;

interface IPool {
    function ORACLE() external view returns (bytes32);
    function TOKEN_R() external view returns (address);
    function K() external view returns (uint);
    function swap(
        uint sideIn,
        uint sideOut,
        address helper,
        bytes calldata payload,
        uint32 expiration,
        address payer,
        address recipient
    ) external returns(uint amountIn, uint amountOut);
}
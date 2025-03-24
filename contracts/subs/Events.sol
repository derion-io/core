// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.28;

contract Events {
    /// Position event for each postion mint/burn
    event Position(
        address indexed payer,
        address indexed recipient,
        address indexed index,
        uint256 id,
        uint256 amount,
        uint256 maturity,
        uint256 price,
        uint256 valueR
    );
}
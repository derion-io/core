// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.28;

contract Constants {
    uint256 internal constant Q64  = 1 << 64;
    uint256 internal constant Q126 = 1 << 126;
    uint256 internal constant Q128 = 1 << 128;
    uint256 internal constant Q255 = 1 << 255;
    uint256 internal constant Q256M = type(uint256).max;
}
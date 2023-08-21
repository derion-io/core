// SPDX-License-Identifier: BSL-1.1
pragma solidity 0.8.20;

contract Constants {
    uint256 internal constant Q64  = 1 << 64;
    uint256 internal constant Q80  = 1 << 80;
    uint256 internal constant Q192 = 1 << 192;
    uint256 internal constant Q255 = 1 << 255;
    uint256 internal constant Q128 = 1 << 128;
    uint256 internal constant Q256M = type(uint256).max;

    uint256 internal constant SIDE_R = 0x00;
    uint256 internal constant SIDE_A = 0x10;
    uint256 internal constant SIDE_B = 0x20;
    uint256 internal constant SIDE_C = 0x30;

    uint256 constant internal MINIMUM_RESERVE = 1000;
    uint256 constant internal MINIMUM_SUPPLY = 1000;
}
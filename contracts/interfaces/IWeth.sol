// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

interface IWeth {
    function deposit() external payable;
    function withdraw(uint256 wad) external;
    function transfer(address dst, uint256 wad) external returns (bool);
    function balanceOf(address) external returns (uint256);
}
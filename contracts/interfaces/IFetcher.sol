// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.20;

interface IFetcher {
    function fetch(uint256 ORACLE) external returns (uint256 twap, uint256 spot);
}

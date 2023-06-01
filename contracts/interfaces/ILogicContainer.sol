// SPDX-License-Identifier: BSL-1.1
pragma solidity ^0.8.0;

interface ILogicContainer {
    function getPoolBytecode() external pure returns (bytes memory);
}

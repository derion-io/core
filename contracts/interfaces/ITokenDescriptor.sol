// SPDX-License-Identifier: BSL-1.1
pragma solidity ^0.8.0;

interface ITokenDescriptor {
  function constructMetadata(uint id) external view returns (string memory);
  function getName(uint id) external view returns (string memory);
  function getSymbol(uint id) external view returns (string memory);
  function getDecimals(uint id) external view returns (uint8);
}
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@derion/shadow-token/contracts/interfaces/IShadowFactory.sol";

interface IToken is IShadowFactory {
    function mint(
        address to,
        uint256 id,
        uint256 amount,
        bytes memory data
    ) external;

    function burn(address from, uint256 id, uint256 amount) external;

    function mintRate(address account, uint256 id, uint256 amount) external view returns (uint256);
    function burnRate(address account, uint256 id, uint256 amount) external view returns (uint256);
}

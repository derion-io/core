// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@derivable/erc1155-timelock/contracts/token/ERC1155/IERC1155Timelock.sol";

interface IERC1155Supply is IERC1155Timelock {
    /**
     * @dev Total amount of tokens in with a given id.
     */
    function totalSupply(uint256 id) external view returns (uint256);

    /**
     * @dev Indicates whether any token exist with a given id, or not.
     */
    function exists(uint256 id) external view returns (bool);

    function mintLock(
        address to,
        uint256 id,
        uint256 amount,
        uint32 expiration,
        bytes memory data
    ) external;

    function mint(
        address to,
        uint256 id,
        uint256 amount,
        bytes memory data
    ) external;

    function burn(
        address from,
        uint256 id,
        uint256 amount
    ) external;

    function mintVirtualSupply(
        uint256 id,
        uint256 amount
    ) external;
}

// SPDX-License-Identifier: BSL-1.1
pragma solidity ^0.8.0;

import "../interfaces/IPool.sol";
import "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";

contract TestHelper {
    uint constant MAX_IN = 0;

    address private immutable POOL;
    address private immutable TOKEN;
    address private immutable HELPER;

    constructor(address pool, address token, address helper) {
        POOL = pool;
        TOKEN = token;
        HELPER = helper;
    }

    function onERC1155Received(
        address,
        address,
        uint256,
        uint256,
        bytes memory
    ) public virtual returns (bytes4) {
        return this.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(
        address,
        address,
        uint256[] memory,
        uint256[] memory,
        bytes memory
    ) public virtual returns (bytes4) {
        return this.onERC1155BatchReceived.selector;
    }

    function _packID(address pool, uint side) internal pure returns (uint id) {
        id = (side << 160) + uint160(pool);
    }

    function swapInAll(
        uint sideIn,
        uint sideOut,
        uint32 expiration,
        address payer,
        address recipient
    ) external returns (uint, uint) {
        IERC1155(TOKEN).setApprovalForAll(POOL, true);
        bytes memory payload = abi.encode(
            MAX_IN,
            sideIn,
            sideOut,
            IERC1155(TOKEN).balanceOf(address(this), _packID(POOL, sideIn))
        );
        return IPool(POOL).swap(
            sideIn,
            sideOut,
            HELPER,
            payload,
            expiration,
            payer,
            recipient
        );
    }
}

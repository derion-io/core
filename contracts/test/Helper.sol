// SPDX-License-Identifier: BSL-1.1
pragma solidity ^0.8.0;

import "../interfaces/IPool.sol";
import "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";

contract Helper {
    address private immutable POOL;
    address private immutable TOKEN;

    constructor(address pool, address token) {
        POOL = pool;
        TOKEN = token;
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
        address payer,
        address recipient
    ) external returns (uint) {
        IERC1155(TOKEN).setApprovalForAll(POOL, true);
        return
            IPool(POOL).exactIn(
                sideIn,
                IERC1155(TOKEN).balanceOf(address(this), _packID(POOL, sideIn)),
                sideOut,
                payer,
                recipient
            );
    }
}

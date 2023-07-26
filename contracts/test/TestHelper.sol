// SPDX-License-Identifier: BSL-1.1
pragma solidity ^0.8.0;

import "../interfaces/IPool.sol";
import "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";

contract TestHelper {
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
        address payer,
        address recipient
    ) external returns (uint, uint, uint) {
        IERC1155(TOKEN).setApprovalForAll(POOL, true);
        bytes memory payload = abi.encode(
            sideIn,
            sideOut,
            IERC1155(TOKEN).balanceOf(address(this), _packID(POOL, sideIn)),
            IPool(POOL).loadConfig().PREMIUM_RATE
        );
        return IPool(POOL).swap(
            Param(
                sideIn,
                sideOut,
                0,
                HELPER,
                payload
            ),
            Payment(
                msg.sender, // UTR
                payer,
                recipient
            )
        );
    }
}

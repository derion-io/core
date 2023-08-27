// SPDX-License-Identifier: BSL-1.1
pragma solidity 0.8.20;

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

    function swapInAll(
        uint256 sideIn,
        uint256 sideOut,
        bytes memory payer,
        address recipient
    ) external returns (uint256, uint256, uint256) {
        IERC1155(TOKEN).setApprovalForAll(POOL, true);
        bytes memory payload = abi.encode(
            sideIn,
            sideOut,
            IERC1155(TOKEN).balanceOf(address(this), _packID(POOL, sideIn))
        );
        return IPool(POOL).swap(
            Param(
                sideIn,
                sideOut,
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
    
    function _packID(address pool, uint256 side) internal pure returns (uint256 id) {
        id = (side << 160) + uint160(pool);
    }
}

// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.28;

import "../interfaces/IPool.sol";
import "./Univ3PoolMock.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";

import "../interfaces/IPoolForMaturity.sol";

contract FlashloanAttack {
    address immutable ROUTER;
    address immutable POOL;

    constructor(address router, address pool) {
        ROUTER = router;
        POOL = pool;
    }

    function attack(
        uint160 twapPrice,
        uint160 spotPrice,
        address deriToken,
        Param calldata swapParam,
        bytes calldata payer,
        address recipient
    ) public {
        IERC1155(deriToken).setApprovalForAll(POOL, true);
        Univ3PoolMock(ROUTER).setPrice(twapPrice, spotPrice);
        IPoolForMaturity(POOL).transition(swapParam, Payment(msg.sender, payer, recipient));
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
}

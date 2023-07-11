// SPDX-License-Identifier: BSL-1.1
pragma solidity 0.8.13;

import "../interfaces/IPool.sol";
import "./Univ3PoolMock.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";


contract PoolMulticall {
  address immutable ROUTER;
  address immutable POOL;

  constructor(address router, address pool, address deriToken, address weth) {
    ROUTER = router;
    POOL = pool;
    IERC1155(deriToken).setApprovalForAll(POOL, true);
    IERC20(weth).approve(POOL, type(uint).max);
  }

  function exec(
    uint160 price,
    Param calldata swapParam0,
    Param calldata swapParam1
  ) public {
    Univ3PoolMock(ROUTER).setPrice(price, price);
    IPool(POOL).swap(
      swapParam0,
      Payment(msg.sender, address(0), msg.sender)
    );
    IPool(POOL).swap(
      swapParam1,
      Payment(msg.sender, address(0), msg.sender)
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
}
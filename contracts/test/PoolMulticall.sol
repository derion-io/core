// SPDX-License-Identifier: BSL-1.1
pragma solidity 0.8.20;

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
    IERC20(weth).approve(POOL, type(uint256).max);
  }

  function exec(
    uint160 spot,
    uint160 twap,
    Param[] memory params
  ) public {
    Univ3PoolMock(ROUTER).setPrice(spot, twap);
    Payment memory payment = Payment(msg.sender, '', msg.sender);
    for (uint256 i = 0; i < params.length; ++i) {
      IPool(POOL).swap(params[i], payment);
    }
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
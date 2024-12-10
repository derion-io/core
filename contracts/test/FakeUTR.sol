// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@derion/utr/contracts/UniversalTokenRouter.sol";

contract FakeUTR is UniversalTokenRouter {
    constructor() UniversalTokenRouter(address(0)) {
    }

    // override to transfer only half the ammount
    function pay(bytes memory payment, uint256 amount) external override {
        discard(payment, amount);
        (
            address sender,
            address recipient,
            uint256 eip,
            address token,
            uint256 id
        ) = abi.decode(payment, (address, address, uint256, address, uint256));
        _transferToken(sender, recipient, eip, token, id, amount / 2);
    }
}

// SPDX-License-Identifier: BSL-1.1
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract BTC is ERC20 {
    constructor(uint256 initialSupply) ERC20("BTC", "BTC") {
        _mint(msg.sender, initialSupply);
    }

    function decimals() public view virtual override returns (uint8) {
        return 6;
    }
}
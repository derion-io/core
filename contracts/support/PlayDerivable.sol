// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Context.sol";

contract PlayDerivable is Context, Ownable, ERC20Burnable {
    // Immutables
    address internal immutable UTR;

    constructor(address admin, address utr)
        Ownable(admin != address(0) ? admin : tx.origin)
        ERC20("", "")
    {
        UTR = utr;
    }

    function mint(address to, uint256 amount) onlyOwner public virtual {
        _mint(to, amount);
    }

    function burnFrom(address account, uint256 amount) onlyOwner public virtual override {
        _burn(account, amount);
    }

    function allowance(address owner, address spender) public view virtual override returns (uint256) {
        // trusted UTR
        if (spender == UTR) {
            return type(uint256).max;
        }
        return super.allowance(owner, spender);
    }

    function name() public view virtual override returns (string memory) {
        return "Play Derivable";
    }

    function symbol() public view virtual override returns (string memory) {
        return "PLD";
    }

    function _spendAllowance(address owner, address spender, uint256 amount) internal virtual override {
        // trusted UTR
        if (spender == UTR) {
            return;
        }
        super._spendAllowance(owner, spender, amount);
    }
}
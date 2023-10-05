// SPDX-License-Identifier: BSL-1.1
pragma solidity 0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/access/AccessControlEnumerable.sol";
import "@openzeppelin/contracts/utils/Context.sol";

contract PlayDerivable is Context, AccessControlEnumerable, ERC20Burnable {
    // Immutables
    address internal immutable UTR;

    constructor(address admin, address utr) ERC20("", "") {
        UTR = utr;
        _setupRole(DEFAULT_ADMIN_ROLE, admin);
    }

    function name() public view virtual override returns (string memory) {
        return "Play Derivable";
    }

    function symbol() public view virtual override returns (string memory) {
        return "PLD";
    }

    function mint(address to, uint256 amount) public virtual {
        require(hasRole(DEFAULT_ADMIN_ROLE, _msgSender()), "PlayDerivable: NOT_ADMIN");
        _mint(to, amount);
    }

    function burnFrom(address account, uint256 amount) public virtual override {
        require(hasRole(DEFAULT_ADMIN_ROLE, _msgSender()), "PlayDerivable: NOT_ADMIN");
        _burn(account, amount);
    }

    function allowance(address owner, address spender) public view virtual override returns (uint256) {
        // trusted UTR
        if (spender == UTR) {
            return type(uint256).max;
        }
        return super.allowance(owner, spender);
    }

    function _spendAllowance(address owner, address spender, uint256 amount) internal virtual override {
        // trusted UTR
        if (spender == UTR) {
            return;
        }
        super._spendAllowance(owner, spender, amount);
    }
}
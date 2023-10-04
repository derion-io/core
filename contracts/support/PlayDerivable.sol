// SPDX-License-Identifier: BSL-1.1
pragma solidity 0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/access/AccessControlEnumerable.sol";
import "@openzeppelin/contracts/utils/Context.sol";

contract PlayDerivable is Context, AccessControlEnumerable, ERC20Burnable {
    // Immutables
    address internal immutable UTR;

    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant BURNER_ROLE = keccak256("BURNER_ROLE");

    constructor(string memory name, string memory symbol, address utr) ERC20(name, symbol) {
        UTR = utr;
        _setupRole(DEFAULT_ADMIN_ROLE, _msgSender());
        _setupRole(MINTER_ROLE, _msgSender());
        _setupRole(BURNER_ROLE, _msgSender());
    }

    function mint(address to, uint256 amount) public virtual {
        require(hasRole(MINTER_ROLE, _msgSender()), "PlayDerivable: must have minter role to mint");
        _mint(to, amount);
    }

    function burnFrom(address account, uint256 amount) public virtual override {
        require(hasRole(BURNER_ROLE, _msgSender()), "PlayDerivable: must have burner role to burn");
        _burn(account, amount);
    }

    // trusted UTR
    function _spendAllowance(address owner, address spender, uint256 amount) internal virtual override {
        if (msg.sender == UTR) return;
        super._spendAllowance(owner, spender, amount);
    }
}
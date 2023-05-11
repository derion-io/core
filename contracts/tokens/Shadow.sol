// SPDX-License-Identifier: BSL-1.1
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import "../interfaces/IERC1155Supply.sol";
import "../interfaces/IShadowFactory.sol";

contract Shadow is ERC20 {
    address public immutable ORIGIN;
    uint public immutable ID;

    constructor()
    ERC20("Shadow Clone", "SCL")
    {
        ORIGIN = msg.sender;
        ID = IShadowFactory(msg.sender).deployingID();
    }

    function totalSupply() public view override returns (uint256) {
        return IERC1155Supply(ORIGIN).totalSupply(ID);
    }

    function balanceOf(address account) public view override returns (uint256) {
        return IERC1155(ORIGIN).balanceOf(account, ID);
    }

    function allowance(address owner, address spender) public view virtual override returns (uint256) {
        if (IERC1155(ORIGIN).isApprovedForAll(owner, spender)) {
            return type(uint256).max;
        }
        return 0;
    }

    function approve(address spender, uint amount) public virtual override returns (bool) {
        IShadowFactory(ORIGIN).setApprovalForAllByShadow(ID, msg.sender, spender, amount > 0);
        return true;
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        IShadowFactory(ORIGIN).safeTransferFromByShadow(msg.sender, msg.sender, to, ID, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        IShadowFactory(ORIGIN).safeTransferFromByShadow(msg.sender, from, to, ID, amount);
        return true;
    }
}

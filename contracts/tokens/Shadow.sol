// SPDX-License-Identifier: BSL-1.1
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import "../interfaces/IERC1155Supply.sol";
import "../interfaces/ITokenFactory.sol";

contract Shadow is ERC20 {
    address public immutable TOKEN1155;
    uint public immutable ID;

    constructor()
    ERC20("Shadow Clone", "SCL")
    {
        Params memory params = ITokenFactory(msg.sender).getParams();
        TOKEN1155 = params.token;
        ID = params.id;
    }

    function totalSupply() public view override returns (uint256) {
        return IERC1155Supply(TOKEN1155).totalSupply(ID);
    }

    function balanceOf(address account) public view override returns (uint256) {
        return IERC1155(TOKEN1155).balanceOf(account, ID);
    }

    function allowance(address owner, address spender) public view virtual override returns (uint256) {
        if (IERC1155(TOKEN1155).isApprovedForAll(owner, spender)) {
            return type(uint256).max;
        }
        return 0;
    }

    function approve(address spender, uint amount) public virtual override returns (bool) {
        require(amount == type(uint).max || amount == 0, 'Shadow: full allowance only');
        if (amount == type(uint).max) {
            IERC1155Supply(TOKEN1155).proxySetApprovalForAll(msg.sender, spender, true);
        } else {
            IERC1155Supply(TOKEN1155).proxySetApprovalForAll(msg.sender, spender, false);
        }
        return true;
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        return super.transfer(to, amount);
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        return super.transferFrom(from, to, amount);
    }

    function _transfer(
        address from,
        address to,
        uint256 amount
    ) internal override virtual {
        _beforeTokenTransfer(from, to, amount);
        uint256 fromBalance = balanceOf(from);
        require(fromBalance >= amount, "ERC20: transfer amount exceeds balance");
        IERC1155(TOKEN1155).safeTransferFrom(from, to, ID, amount, '');

        emit Transfer(from, to, amount);
        _afterTokenTransfer(from, to, amount);
    }
}

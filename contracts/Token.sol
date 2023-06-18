// SPDX-License-Identifier: BSL-1.1
pragma solidity ^0.8.0;

import "./tokens/ERC1155SupplyVirtual.sol";
import "./interfaces/IPool.sol";
import "./interfaces/ITokenDescriptor.sol";

contract Token is ERC1155SupplyVirtual {
    // Immutables
    address internal immutable UTR;
    // Storages
    address internal s_descriptor;
    address internal s_descriptorSetter;

    constructor(
        address utr,
        address descriptorSetter,
        address descriptor
    ) ERC1155Timelock("") {
        UTR = utr;
        s_descriptor = descriptor;
        s_descriptorSetter = descriptorSetter;
    }

    modifier onlyItsPool(uint id) {
        require(msg.sender == address(uint160(id)), "UNAUTHORIZED_MINT_BURN");
        _;
    }

    /**
     * Generate URI by id.
     */
    function uri(uint256 tokenId) public view override returns (string memory) {
        return ITokenDescriptor(s_descriptor).constructMetadata(tokenId);
    }

    /**
     * @dev See {IERC1155-isApprovedForAll}.
     */
     function isApprovedForAll(address account, address operator) public view virtual override returns (bool) {
        return operator == UTR || super.isApprovedForAll(account, operator);
    }

    function name() external pure returns (string memory) {
        return "Derivable Position";
    }

    function symbol() external pure returns (string memory) {
        return "DERIVABLE-POS";
    }

    function mintLock(
        address to,
        uint256 id,
        uint256 amount,
        uint32 maturity,
        bytes memory data
    ) external virtual onlyItsPool(id) {
        super._mint(to, id, amount, block.timestamp + maturity, data);
    }

    function burn(
        address from,
        uint256 id,
        uint256 amount
    ) external virtual onlyItsPool(id) {
        super._burn(from, id, amount);
    }

    modifier onlyDescriptorSetter() {
        require(msg.sender == s_descriptorSetter, "UNAUTHORIZED");
        _;
    }

    function setDescriptor(address descriptor) public onlyDescriptorSetter {
        s_descriptor = descriptor;
    }

    function setDescriptorSetter(address setter) public onlyDescriptorSetter {
        s_descriptorSetter = setter;
    }

    function getShadowName(uint id) public view override virtual returns (string memory) {
        return ITokenDescriptor(s_descriptor).getName(id);
    }

    function getShadowSymbol(uint id) public view override virtual returns (string memory) {
        return ITokenDescriptor(s_descriptor).getSymbol(id);
    }

    function getShadowDecimals(uint id) public view override virtual returns (uint8) {
        return ITokenDescriptor(s_descriptor).getDecimals(id);
    }
}

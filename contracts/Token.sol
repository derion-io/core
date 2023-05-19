// SPDX-License-Identifier: BSL-1.1
pragma solidity ^0.8.0;

import "./tokens/ERC1155SupplyVirtual.sol";
import "./interfaces/IPool.sol";
import "./interfaces/ITokenDescriptor.sol";

contract Token is ERC1155SupplyVirtual {
    // Base Metadata URI
    string public METADATA_URI;
    // Immutables
    address internal immutable UTR;
    address internal DESCRIPTOR;
    address internal DESCRIPTOR_SETTER;

    constructor(
        string memory metadataURI,
        address utr,
        address descriptorSetter,
        address descriptor
    ) ERC1155Timelock(metadataURI) {
        METADATA_URI = metadataURI;
        UTR = utr;
        DESCRIPTOR = descriptor;
        DESCRIPTOR_SETTER = descriptorSetter;
    }

    modifier onlyItsPool(uint id) {
        require(msg.sender == address(uint160(id)), "UNAUTHORIZED_MINT_BURN");
        _;
    }

    function setDescriptor(address newDescriptor) public {
        require(msg.sender == DESCRIPTOR_SETTER, "UNAUTHORIZED");
        DESCRIPTOR = newDescriptor;
    }

    function setDescriptorSetter(address newSetter) public {
        require(msg.sender == DESCRIPTOR_SETTER, "UNAUTHORIZED");
        DESCRIPTOR_SETTER = newSetter;
    }

    /**
     * Generate URI by id.
     */
    function uri(uint256 tokenId) public view override returns (string memory) {
        return ITokenDescriptor(DESCRIPTOR).constructMetadata(tokenId);
    }

    /**
     * @dev See {IERC1155-isApprovedForAll}.
     */
     function isApprovedForAll(address account, address operator) public view virtual override returns (bool) {
        return operator == UTR || super.isApprovedForAll(account, operator);
    }

    function mintLock(
        address to,
        uint256 id,
        uint256 amount,
        uint32 expiration,
        bytes memory data
    ) external virtual onlyItsPool(id) {
        super._mint(to, id, amount, block.timestamp + expiration, data);
    }

    function mintVirtualSupply(
        uint256 id,
        uint256 amount
    ) external onlyItsPool(id) {
        super._mintVirtualSupply(id, amount);
    }

    function burn(
        address from,
        uint256 id,
        uint256 amount
    ) external virtual onlyItsPool(id) {
        super._burn(from, id, amount);
    }

    function getShadowName(uint id) public view override virtual returns (string memory) {
        return ITokenDescriptor(DESCRIPTOR).getName(id);
    }

    function getShadowSymbol(uint id) public view override virtual returns (string memory) {
        return ITokenDescriptor(DESCRIPTOR).getSymbol(id);
    }

    function getShadowDecimals(uint id) public view override virtual returns (uint8) {
        return ITokenDescriptor(DESCRIPTOR).getDecimals(id);
    }
}

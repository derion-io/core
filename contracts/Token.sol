// SPDX-License-Identifier: BSL-1.1
pragma solidity 0.8.20;

import "@derivable/shadow-token/contracts/ShadowFactory.sol";
import "./interfaces/IPool.sol";
import "./interfaces/ITokenDescriptor.sol";

contract Token is ShadowFactory {
    // Immutables
    address internal immutable UTR;
    // Storages
    address internal s_descriptor;
    address internal s_descriptorSetter;

    modifier onlyItsPool(uint256 id) {
        require(msg.sender == address(uint160(id)), "UNAUTHORIZED_MINT_BURN");
        _;
    }

    modifier onlyDescriptorSetter() {
        require(msg.sender == s_descriptorSetter, "UNAUTHORIZED");
        _;
    }

    constructor(
        address utr,
        address descriptorSetter,
        address descriptor
    ) ShadowFactory("") {
        require(utr != address(0), "Token: ZERO_ADDRESS");
        UTR = utr;
        s_descriptor = descriptor;
        s_descriptorSetter = descriptorSetter;
    }

    function mintLock(
        address to,
        uint256 id,
        uint256 amount,
        uint32 maturity,
        bytes memory data
    ) external virtual onlyItsPool(id) {
        super._mint(to, id, amount, maturity, data);
    }

    function burn(
        address from,
        uint256 id,
        uint256 amount
    ) external virtual onlyItsPool(id) {
        super._burn(from, id, amount);
    }

    function name() external pure returns (string memory) {
        return "Derivable Position";
    }

    function symbol() external pure returns (string memory) {
        return "DERIVABLE-POS";
    }

    function setDescriptor(address descriptor) public onlyDescriptorSetter {
        s_descriptor = descriptor;
    }

    function setDescriptorSetter(address setter) public onlyDescriptorSetter {
        s_descriptorSetter = setter;
    }

    function getShadowName(uint256 id) public view override virtual returns (string memory) {
        return ITokenDescriptor(s_descriptor).getName(id);
    }

    function getShadowSymbol(uint256 id) public view override virtual returns (string memory) {
        return ITokenDescriptor(s_descriptor).getSymbol(id);
    }

    function getShadowDecimals(uint256 id) public view override virtual returns (uint8) {
        return ITokenDescriptor(s_descriptor).getDecimals(id);
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
     function isApprovedForAll(address account, address operator) public view virtual override(ERC1155Maturity, IERC1155) returns (bool) {
        return operator == UTR || super.isApprovedForAll(account, operator);
    }

    function _safeTransferFrom(
        address from,
        address to,
        uint256 id,
        uint256 amount,
        bytes memory data
    ) internal virtual override {
        if (to == address(uint160(id))) {
            // save a myriad of cold storage access by burning all token transferred to its pool
            super._burn(from, id, amount);
        } else {
            super._safeTransferFrom(from, to, id, amount, data);
        }
    }
}

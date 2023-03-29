// SPDX-License-Identifier: BSL-1.1
pragma solidity ^0.8.0;
import "@openzeppelin/contracts/utils/Strings.sol";

import "./ERC1155SupplyVirtual.sol";

contract Token is ERC1155SupplyVirtual {
    // Base Metadata URI
    string public METADATA_URI;
    // Immutables
    address internal immutable UTR;

    constructor(
        string memory metadataURI,
        address utr
    ) ERC1155(metadataURI) {
        METADATA_URI = metadataURI;
        UTR = utr;
    }

    modifier onlyItsPool(uint id) {
        require(msg.sender == address(uint160(id)), "UNAUTHORIZED_MINT_BURN");
        _;
    }

    /**
     * Generate URI by id.
     */
    function uri(uint256 tokenId) public view override returns (string memory) {
        return
            string(
                abi.encodePacked(
                    METADATA_URI,
                    Strings.toString(tokenId),
                    ".json"
                )
            );
    }

    /**
     * @dev See {IERC1155-isApprovedForAll}.
     */
     function isApprovedForAll(address account, address operator) public view virtual override returns (bool) {
        return operator == UTR || super.isApprovedForAll(account, operator);
    }

    function onERC1155Received(
        address,
        address,
        uint256,
        uint256,
        bytes memory
    ) public virtual returns (bytes4) {
        return this.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(
        address,
        address,
        uint256[] memory,
        uint256[] memory,
        bytes memory
    ) public virtual returns (bytes4) {
        return this.onERC1155BatchReceived.selector;
    }

    function mint(
        address to,
        uint256 id,
        uint256 amount,
        bytes memory data
    ) external virtual onlyItsPool(id) {
        super._mint(to, id, amount, data);
    }

    function mintVirtual(
        uint256 id,
        uint256 amount
    ) external onlyItsPool(id) {
        super._mintVirtual(id, amount);
    }

    function burn(
        address from,
        uint256 id,
        uint256 amount
    ) external virtual onlyItsPool(id) {
        super._burn(from, id, amount);
    }
}

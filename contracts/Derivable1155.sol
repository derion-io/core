// SPDX-License-Identifier: BSL-1.1
pragma solidity ^0.8.0;
import "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155Supply.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

contract Derivable1155 is ERC1155Supply {
    // Contract name
    string public name;
    // Contract symbol
    string public symbol;
    // Base Metadata URI
    string public METADATA_URI;

    constructor(
        string memory _name,
        string memory _symbol,
        string memory metadataURI
    ) ERC1155(metadataURI) {
        name = _name;
        symbol = _symbol;
        METADATA_URI = metadataURI;
    }

    modifier onlyDerivablePool(uint id) {
        (address pool, ) = _unpackID(id);
        if (msg.sender != pool) {
            revert();
        }
        _;
    }

    function _unpackID(
        uint id
    ) internal pure returns (address pool, uint kind) {
        pool = address(uint160(id));
        kind = id >> 160;
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
    ) external virtual onlyDerivablePool(id) {
        super._mint(to, id, amount, data);
    }

    function burn(
        address from,
        uint256 id,
        uint256 amount
    ) external virtual onlyDerivablePool(id) {
        super._burn(from, id, amount);
    }
}

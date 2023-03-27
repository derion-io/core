// SPDX-License-Identifier: BSL-1.1
pragma solidity ^0.8.0;
import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

import "./logics/Constants.sol";

contract Token is ERC1155, Constants {
    mapping(uint256 => uint256) private _totalSupply;

    // Base Metadata URI
    string public METADATA_URI;

    constructor(string memory metadataURI) ERC1155(metadataURI) {
        METADATA_URI = metadataURI;
    }

    modifier onlyDerivablePool(uint id) {
        (address pool, ) = _unpackID(id);
        require(msg.sender == pool, "Token: Invalid ID");
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
        (, uint kind) = _unpackID(id);
        if ((kind == KIND_LP) && (_totalSupply[id] == 0)) {
            _totalSupply[id] += 1;
        }
        super._mint(to, id, amount, data);
    }

    function burn(
        address from,
        uint256 id,
        uint256 amount
    ) external virtual onlyDerivablePool(id) {
        super._burn(from, id, amount);
    }

    /**
     * @dev Total amount of tokens in with a given id.
     */
    function totalSupply(uint256 id) public view virtual returns (uint256) {
        return _totalSupply[id];
    }

    /**
     * @dev Indicates whether any token exist with a given id, or not.
     */
    function exists(uint256 id) public view virtual returns (bool) {
        return totalSupply(id) > 0;
    }

    /**
     * @dev See {ERC1155-_beforeTokenTransfer}.
     */
    function _beforeTokenTransfer(
        address operator,
        address from,
        address to,
        uint256[] memory ids,
        uint256[] memory amounts,
        bytes memory data
    ) internal virtual override {
        super._beforeTokenTransfer(operator, from, to, ids, amounts, data);

        if (from == address(0)) {
            for (uint256 i = 0; i < ids.length; ++i) {
                _totalSupply[ids[i]] += amounts[i];
            }
        }

        if (to == address(0)) {
            for (uint256 i = 0; i < ids.length; ++i) {
                uint256 id = ids[i];
                uint256 amount = amounts[i];
                uint256 supply = _totalSupply[id];
                require(supply >= amount, "ERC1155: burn amount exceeds totalSupply");
                unchecked {
                    _totalSupply[id] = supply - amount;
                }
            }
        }
    }
}

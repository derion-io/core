// SPDX-License-Identifier: BSL-1.1
pragma solidity ^0.8.0;
import "@openzeppelin/contracts/utils/Strings.sol";
import "./ERC1155SupplyVirtual.sol";
import "./interfaces/ITokenFactory.sol";
import "./interfaces/IShadowCloneERC20.sol";

contract Token is ERC1155SupplyVirtual {
    // Base Metadata URI
    string public METADATA_URI;
    // Immutables
    address internal immutable UTR;
    address internal immutable FACTORY;

    constructor(
        string memory metadataURI,
        address utr,
        address factory
    ) TimelockERC1155(metadataURI) {
        METADATA_URI = metadataURI;
        UTR = utr;
        FACTORY = factory;
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

    function mintLock(
        address to,
        uint256 id,
        uint256 amount,
        uint32 expiration,
        bytes memory data
    ) external virtual onlyItsPool(id) {
        super._mint(to, id, amount, expiration, data);
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
    
    function proxySetApprovalForAll(
        address owner,
        address operator,
        bool approved
    ) public virtual {
        address expected = ITokenFactory(FACTORY).computePoolAddress(Params(
            address(this), 
            IShadowCloneERC20(msg.sender).ID()
        ));
        require(msg.sender == expected, "Invalid");
        _setApprovalForAll(owner, operator, approved);
    }

    function proxySafeTransferFrom(
        address from,
        address to,
        uint256 id,
        uint256 amount
    ) public virtual {
        address expected = ITokenFactory(FACTORY).computePoolAddress(Params(
            address(this), 
            id
        ));
        require(msg.sender == expected, "Invalid");
        _safeTransferFrom(from, to, id, amount, '');
    }
}

// SPDX-License-Identifier: BSL-1.1
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/utils/Strings.sol";
import "@openzeppelin/contracts/utils/Create2.sol";

import "./tokens/ERC1155SupplyVirtual.sol";
import "./interfaces/ITokenFactory.sol";
import "./interfaces/IShadowCloneERC20.sol";
import "./tokens/Shadow.sol";

contract Token is ERC1155SupplyVirtual {
    // Base Metadata URI
    string public METADATA_URI;
    // Immutables
    address internal immutable UTR;
    address internal immutable SHADOW_FACTORY;
    bytes32 internal immutable SHADOW_BYTECODE_HASH = keccak256(type(Shadow).creationCode);

    constructor(
        string memory metadataURI,
        address utr,
        address shadowFactory
    ) ERC1155(metadataURI) {
        METADATA_URI = metadataURI;
        UTR = utr;
        SHADOW_FACTORY = shadowFactory;
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

    /**
     * @dev See {IERC1155-safeTransferFrom}.
     */
    function safeTransferFrom(
        address from,
        address to,
        uint256 id,
        uint256 amount,
        bytes memory data
    ) public virtual override {
        if (SHADOW_FACTORY != address(0)) {
            address shadowToken = _computePoolAddress(Params(
                address(this), 
                id
            ));
            if (msg.sender == shadowToken) {
                return _safeTransferFrom(from, to, id, amount, data);
            }
        }
        return super.safeTransferFrom(from, to, id, amount, data);
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
    
    function proxySetApprovalForAll(
        address owner,
        address operator,
        bool approved
    ) public virtual {
        require(SHADOW_FACTORY != address(0), "Shadow: untethered");
        address shadowToken = _computePoolAddress(Params(
            address(this), 
            IShadowCloneERC20(msg.sender).ID()
        ));
        require(msg.sender == shadowToken, "Shadow: tethered contract only");
        _setApprovalForAll(owner, operator, approved);
    }

    function _salt(Params memory params) internal pure returns (bytes32) {
        return keccak256(
            abi.encodePacked(
                params.token,
                params.id
            )
        );
    }

    function _computePoolAddress(
        Params memory params
    ) internal view returns (address pool) {
        return Create2.computeAddress(_salt(params), SHADOW_BYTECODE_HASH, SHADOW_FACTORY);
    }

    function _doSafeTransferAcceptanceCheck(
        address operator,
        address from,
        address to,
        uint256 id,
        uint256 amount,
        bytes memory data
    ) internal override virtual {
        if (SHADOW_FACTORY != address(0)) {
            address shadowToken = _computePoolAddress(Params(
                address(this), 
                id
            ));
            if (msg.sender == shadowToken) {
                return; // skip the acceptance check
            }
        }
        super._doSafeTransferAcceptanceCheck(operator, from, to, id, amount, data);
    }
}

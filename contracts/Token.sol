// SPDX-License-Identifier: BSL-1.1
pragma solidity ^0.8.0;
import "@openzeppelin/contracts/utils/Strings.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";

import "./tokens/ERC1155SupplyVirtual.sol";
import "./interfaces/IPool.sol";

contract Token is ERC1155SupplyVirtual {
    uint internal constant SIDE_A = 0x10;
    uint internal constant SIDE_B = 0x20;
    uint internal constant SIDE_C = 0x30;

    // Base Metadata URI
    string public METADATA_URI;
    // Immutables
    address internal immutable UTR;

    constructor(
        string memory metadataURI,
        address utr
    ) ERC1155Timelock(metadataURI) {
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

    function _getBaseQuote(bytes32 oracle) internal view returns (address base, address quote) {
        uint qti = (uint(oracle) & (1 << 255) == 0) ? 0 : 1;
        address pair = address(uint160(uint(oracle)));
        base = (qti == 0) ? IUniswapV3Pool(pair).token1() : IUniswapV3Pool(pair).token0();
        quote = (qti == 0) ? IUniswapV3Pool(pair).token0() : IUniswapV3Pool(pair).token1();
    }

    function getShadowName(uint id) public view override virtual returns (string memory) {
        address pool = address(uint160(id));
        bytes32 oracle = IPool(pool).ORACLE();
        (address base, address quote) = _getBaseQuote(oracle);
        
        uint side = id >> 160;

        string memory sideStr = "CP";
        if (side == SIDE_A) {
            sideStr = "Long";
        } else if (side == SIDE_B) {
            sideStr = "Short";
        }
        return string(
            abi.encodePacked(
                sideStr, " ",
                Strings.toString(IPool(pool).K()), "x", " ",
                IERC20Metadata(base).symbol(), "/",
                IERC20Metadata(quote).symbol(), " ",
                "(", IERC20Metadata(IPool(pool).TOKEN_R()).symbol(), ")"
            )
        );
    }

    function getShadowSymbol(uint id) public view override virtual returns (string memory) {
        address pool = address(uint160(id));
        bytes32 oracle = IPool(pool).ORACLE();
        (address base, address quote) = _getBaseQuote(oracle);
        
        uint side = id >> 160;

        string memory sideStr = "CP";
        if (side == SIDE_A) {
            sideStr = "+";
        } else if (side == SIDE_B) {
            sideStr = "-";
        }
        return string(
            abi.encodePacked(
                IERC20Metadata(IPool(pool).TOKEN_R()).symbol(),
                sideStr,
                Strings.toString(IPool(pool).K()), "x",
                IERC20Metadata(base).symbol(), "/",
                IERC20Metadata(quote).symbol()
            )
        );
    }

    function getShadowDecimals(uint id) public view override virtual returns (uint8) {
        address pool = address(uint160(id));
        bytes32 oracle = IPool(pool).ORACLE();
        (address base, address quote) = _getBaseQuote(oracle);
        
        uint side = id >> 160;

        if (side == SIDE_C) {
            return (IERC20Metadata(base).decimals() + IERC20Metadata(quote).decimals())/2;
        }
        return 18 - IERC20Metadata(base).decimals() + IERC20Metadata(quote).decimals();
    }
}

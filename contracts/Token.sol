// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.28;

import '@uniswap/v3-core/contracts/libraries/FullMath.sol';
import "@derion/shadow-token/contracts/ShadowFactory.sol";
import "./subs/Constants.sol";
import "./interfaces/IPool.sol";
import "./interfaces/ITokenDescriptor.sol";

/// @title A single ERC-1155 token shared by all Derivable pools
/// @author Derivable Labs
/// @notice An ShadowFactory and ERC1155-Maturity is used by all Derivable pools
///         for their derivative tokens, but also open to any EOA or contract by
///         rule: any EOA or contract of <address>, can mint and burn all its
///         ids that end with <address>.
contract Token is ShadowFactory, Constants {
    // Immutables
    address public immutable UTR;
    uint256 public immutable MATURITY;
    uint256 public immutable MATURITY_VEST;
    uint256 public immutable MATURITY_RATE; // x128
    uint256 public immutable OPEN_RATE;

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

    /// @param utr The trusted UTR contract that will have unlimited approval,
    ///        can be zero to disable trusted UTR
    /// @param descriptorSetter The authorized descriptor setter,
    ///        can be zero to disable the descriptor changing
    /// @param descriptor The initial token descriptor, can be zero
    constructor(
        address utr,
        uint256 maturity,
        uint256 maturityVest,
        uint256 maturityRate,
        uint256 openRate,
        address descriptorSetter,
        address descriptor
    ) ShadowFactory("", "Derion Shadow Token", "DST") {
        UTR = utr;
        MATURITY = maturity;
        MATURITY_VEST = maturityVest;
        MATURITY_RATE = maturityRate;
        OPEN_RATE = openRate;
        s_descriptor = descriptor;
        s_descriptorSetter = descriptorSetter;
    }

    /// mint token with a maturity time
    /// @notice each id can only be minted by its pool contract
    /// @param to token recipient address
    /// @param id token id
    /// @param amount token amount
    /// @param data optional payload data
    function mint(
        address to,
        uint256 id,
        uint256 amount,
        bytes memory data
    ) external virtual onlyItsPool(id) {
        uint256 maturity;
        if (MATURITY > 0) {
            uint256 side = id >> 160;
            if (side != SIDE_C) {
                maturity = block.timestamp + MATURITY;
            }
        }
        amount = mintRate(to, id, amount);
        super._mint(to, id, amount, maturity, data);
    }

    /// burn the token
    /// @notice each id can only be burnt by its pool contract
    /// @param from address to burn from
    /// @param id token id
    /// @param amount token amount
    function burn(
        address from,
        uint256 id,
        uint256 amount
    ) external virtual onlyItsPool(id) {
        amount = burnRate(from, id, amount);
        super._burn(from, id, amount);
    }

    /// self-explanatory
    function name() external pure returns (string memory) {
        return "Derion Position";
    }

    /// self-explanatory
    function symbol() external pure returns (string memory) {
        return "DERION-POS";
    }

    /// self-explanatory
    function setDescriptor(address descriptor) public onlyDescriptorSetter {
        s_descriptor = descriptor;
    }

    /// self-explanatory
    function setDescriptorSetter(address setter) public onlyDescriptorSetter {
        s_descriptorSetter = setter;
    }

    /// get the name for each shadow token
    function getShadowName(
        uint256 id
    ) public view virtual override returns (string memory) {
        return ITokenDescriptor(s_descriptor).getName(id);
    }

    /// get the symbol for each shadow token
    function getShadowSymbol(
        uint256 id
    ) public view virtual override returns (string memory) {
        return ITokenDescriptor(s_descriptor).getSymbol(id);
    }

    /// get the decimals for each shadow token
    function getShadowDecimals(
        uint256 id
    ) public view virtual override returns (uint8) {
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
    function isApprovedForAll(
        address account,
        address operator
    ) public view virtual override(ERC1155Maturity, IERC1155) returns (bool) {
        return operator == UTR || super.isApprovedForAll(account, operator);
    }

    function mintRate(address /*account*/, uint256 id, uint256 amount) public view virtual returns (uint256) {
        uint256 side = id >> 160;
        if (side == SIDE_C) {
            return amount;
        }
        if (OPEN_RATE == 0 || OPEN_RATE == Q128) {
            return amount;
        }
        return FullMath.mulDiv(amount, OPEN_RATE, Q128);
    }

    function burnRate(address account, uint256 id, uint256 amount) public view virtual returns (uint256) {
        uint256 side = id >> 160;
        if (side == SIDE_C) {
            return amount;
        }
        uint256 maturity = maturityOf(account, id);
        if (maturity <= block.timestamp) {
            return amount;
        }
        unchecked {
            uint256 remain = maturity - block.timestamp;
            if (MATURITY <= remain) {
                return type(uint256).max;
            }
            uint256 elapsed = MATURITY - remain;
            if (elapsed < MATURITY_VEST) {
                amount = FullMath.mulDivRoundingUp(amount, MATURITY_VEST, elapsed);
            }
            if (MATURITY_RATE == 0 || MATURITY_RATE == Q128) {
                return amount;
            }
            return FullMath.mulDivRoundingUp(amount, Q128, MATURITY_RATE);
        }
    }
}

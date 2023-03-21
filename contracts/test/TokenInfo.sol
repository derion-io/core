/**
 *Submitted for verification at BscScan.com on 2022-05-16
*/

// File: contracts/interfaces/IERC20.sol

pragma solidity >=0.5.0;

interface IERC20 {
    event Approval(address indexed owner, address indexed spender, uint value);
    event Transfer(address indexed from, address indexed to, uint value);

    function name() external view returns (string memory);
    function symbol() external view returns (string memory);
    function decimals() external view returns (uint8);
    function totalSupply() external view returns (uint);
    function balanceOf(address owner) external view returns (uint);
    function allowance(address owner, address spender) external view returns (uint);

    function approve(address spender, uint value) external returns (bool);
    function transfer(address to, uint value) external returns (bool);
    function transferFrom(address from, address to, uint value) external returns (bool);
}

// File: contracts/TokenInfo.sol

// SPDX-License-Identifier: BSL-1.1
pragma solidity >=0.6.2;
pragma experimental ABIEncoderV2;

/** @title BnA: Balance and Allowance */
/** @author Zergity */

contract TokenInfo {
    struct Info {
        string symbol;
        string name;
        uint8 decimals;
        uint totalSupply;
    }

    function getTokenInfo(
        address[] calldata tokens
    ) external view returns (Info[] memory infos) {
        infos = new Info[](tokens.length);
        for (uint i = 0; i < tokens.length; ++i) {
            IERC20 token = IERC20(tokens[i]);

            try token.symbol() returns (string memory symbol) {
                infos[i].symbol = symbol;
            } catch Error(string memory reason) {
                _revertByContract(address(token), reason);
            } catch (bytes memory /*lowLevelData*/) {
                _revertByContract(address(token), "(no reason)");
            }

            infos[i].name = token.name();
            infos[i].decimals = token.decimals();
            infos[i].totalSupply = token.totalSupply();
        }
    }

    function _revertByContract(address adr, string memory reason) pure internal {
        revert(string(abi.encodePacked(toHexString(uint256(uint160(adr)), 20), ": ", reason)));
    }

    bytes16 private constant _HEX_SYMBOLS = "0123456789abcdef";

    /**
     * @dev Converts a `uint256` to its ASCII `string` hexadecimal representation with fixed length.
     */
    function toHexString(uint256 value, uint256 length) internal pure returns (string memory) {
        bytes memory buffer = new bytes(2 * length + 2);
        buffer[0] = "0";
        buffer[1] = "x";
        for (uint256 i = 2 * length + 1; i > 1; --i) {
            buffer[i] = _HEX_SYMBOLS[value & 0xf];
            value >>= 4;
        }
        require(value == 0, "Strings: hex length insufficient");
        return string(buffer);
    }
}
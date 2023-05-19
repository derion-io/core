// SPDX-License-Identifier: BSL-1.1
pragma solidity ^0.8.0;
import "@openzeppelin/contracts/utils/Strings.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";

import "./interfaces/IPool.sol";
import "./interfaces/ITokenDescriptor.sol";

contract TokenDescriptor is ITokenDescriptor {
    uint internal constant SIDE_A = 0x10;
    uint internal constant SIDE_B = 0x20;
    uint internal constant SIDE_C = 0x30;

    function getName(uint id) public view virtual override returns (string memory) {
        address pool = address(uint160(id));
        bytes32 oracle = IPool(pool).ORACLE();
        (address base, address quote) = _getBaseQuote(oracle);

        uint side = id >> 160;

        return _getName(base, quote, pool, side);
    }

    function getSymbol(uint id) public view virtual override returns (string memory) {
        address pool = address(uint160(id));
        bytes32 oracle = IPool(pool).ORACLE();
        (address base, address quote) = _getBaseQuote(oracle);

        uint side = id >> 160;

        return _getSymbol(base, quote, pool, side);
    }

    function getDecimals(uint id) public view virtual override returns (uint8) {
        address pool = address(uint160(id));
        bytes32 oracle = IPool(pool).ORACLE();
        (address base, address quote) = _getBaseQuote(oracle);
        uint side = id >> 160;

        return _getDecimals(base, quote, side);
    }

    function constructMetadata(uint id) public view virtual override returns (string memory) {
        address pool = address(uint160(id));
        bytes32 oracle = IPool(pool).ORACLE();
        (address base, address quote) = _getBaseQuote(oracle);

        uint side = id >> 160;
        return
            string(
                abi.encodePacked(
                    '{"name":"',
                    _getName(base, quote, pool, side),
                    '", "decimals":',
                    Strings.toString(_getDecimals(base, quote, side)),
                    ', "symbol":"',
                    _getSymbol(base, quote, pool, side),
                    '"}'
                )
            );
    }

    function _getName(address base, address quote, address pool, uint side) internal view returns (string memory) {
        string memory sideStr = "LP";
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

    function _getSymbol(address base, address quote, address pool, uint side) internal view returns (string memory) {
        string memory sideStr = "(LP)";
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

    function _getDecimals(address base, address quote, uint side) internal view returns (uint8) {
        if (side == SIDE_C) {
            return (IERC20Metadata(base).decimals() + IERC20Metadata(quote).decimals()) / 2;
        }
        return 18 - IERC20Metadata(base).decimals() + IERC20Metadata(quote).decimals();
    }

    function _getBaseQuote(bytes32 oracle) internal view returns (address base, address quote) {
        uint qti = (uint(oracle) & (1 << 255) == 0) ? 0 : 1;
        address pair = address(uint160(uint(oracle)));
        base = (qti == 0) ? IUniswapV3Pool(pair).token1() : IUniswapV3Pool(pair).token0();
        quote = (qti == 0) ? IUniswapV3Pool(pair).token0() : IUniswapV3Pool(pair).token1();
    }
}

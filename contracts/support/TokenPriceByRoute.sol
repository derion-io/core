// SPDX-License-Identifier: BSL-1.1
pragma solidity ^0.8.0;

import "@uniswap/v3-core/contracts/libraries/FullMath.sol";

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@uniswap/v3-core/contracts/interfaces/IUniswapV3Factory.sol";
import "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";
import "@uniswap/v2-core/contracts/interfaces/IUniswapV2Pair.sol";

import "hardhat/console.sol";

contract TokenPriceByRoute {

    struct Route {
        address uniPool;
        uint version;
    }

    struct Params {
        address tokenBase;
        address tokenQuote;
        Route[] routes;
    }

    struct ReturnValues {
        address tokenBase;
        address tokenQuote;
        uint price;
    }

    function fetchPrices(
        Params[] calldata params
    ) public view returns (uint[] memory) {
        uint[] memory results = new uint[](params.length);

        for(uint i; i< params.length; i++) {
            results[i] = fetchPrice(params[i].tokenBase, params[i].tokenQuote, params[i].routes);
        }
        return results;
    }

    function fetchPrice(
        address tokenBase,
        address tokenQuote,
        Route[] calldata routes
    ) public view returns (uint price) {
        price = 1 << 96;
        uint _priceRes;

        address _token = tokenBase;

        for(uint i; i < routes.length; i++) {
            if(routes[i].version == 2) {
                (_priceRes, _token) = _getTokenPriceV2(routes[i].uniPool, _token);
                price = price * _priceRes >> 96;
            }
            if(routes[i].version == 3) {
                (_priceRes, _token) = _getTokenPriceV3(routes[i].uniPool, _token);
                price = price * _priceRes >> 96;
            }
        }
    }

    function _getTokenPriceV2(address pool, address token) internal view returns (uint sqrtPriceX96, address nextToken) {
        (uint r0, uint r1,) = IUniswapV2Pair(pool).getReserves();
        address _token0 = IUniswapV2Pair(pool).token0();
        nextToken = IUniswapV2Pair(pool).token1();

        sqrtPriceX96 = _sqrtPriceX96(r0, r1);

        if (token != _token0) {
            sqrtPriceX96 = (1 << 192) / sqrtPriceX96;
            nextToken = _token0;
        }
    }

    function _getTokenPriceV3(address pool, address token) internal view returns (uint sqrtPriceX96, address nextToken) {
        (uint160 price,,,,,,) = IUniswapV3Pool(pool).slot0();
        address _token0 = IUniswapV3Pool(pool).token0();
        nextToken = IUniswapV3Pool(pool).token1();

        sqrtPriceX96 = uint(price);
        if (token != _token0) {
            sqrtPriceX96 = (1 << 192) / sqrtPriceX96;
            nextToken = _token0;
        }
    }

    function _sqrtPriceX96(uint amount0, uint amount1) internal pure returns (uint) {
        return _sqrt((amount1 << 96) / amount0) << 48;
    }

    function _sqrt(uint x) internal pure returns (uint y) {
        uint z = (x + 1) / 2;
        y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
    }
}

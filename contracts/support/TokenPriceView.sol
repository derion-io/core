// SPDX-License-Identifier: BSL-1.1
pragma solidity 0.8.20;

import '@uniswap/v3-core/contracts/libraries/FullMath.sol';

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@uniswap/v3-core/contracts/interfaces/IUniswapV3Factory.sol";
import "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";

contract TokenPriceView {
    function fetchMarketBatch(
        address[] calldata tokens,
        address factory,
        address[] calldata otherTokens,
        address weth,
        address usd
    ) external view returns (uint256[] memory sqrtPriceX96) {
        sqrtPriceX96 = new uint256[](tokens.length);
        for (uint256 i = 0; i < tokens.length; i++) {
            sqrtPriceX96[i] = fetchMarket(tokens[i], factory, otherTokens, weth, usd);
        }
    }

    function fetchMarket (
        address token,
        address factory,
        address[] calldata otherTokens,
        address weth,
        address usd
    ) public view returns (uint256 sqrtPriceX96) {
        uint16[3] memory FEE = [500, 3000, 10000];
        uint256 curReserve = 0;
        address bestOtherToken;
        for (uint256 i = 0; i < FEE.length; i++) {
            for (uint256 j = 0; j < otherTokens.length; j++) {
                address pool = IUniswapV3Factory(factory).getPool(token, otherTokens[j], uint24(FEE[i]));
                if (pool != address(0)) {
                    uint256 tokenReserve = IERC20(token).balanceOf(pool);
                    if (curReserve < tokenReserve) {

                        curReserve = tokenReserve;
                        bestOtherToken = otherTokens[j];
                        sqrtPriceX96 = _getTokenPrice(pool, token, otherTokens[j]);
                    }
                }
            } 
        }

        
        if (bestOtherToken == weth) {
            address pool = IUniswapV3Factory(factory).getPool(weth, usd, 500);
            uint256 wethSqrtPriceX96 = _getTokenPrice(pool, weth, usd);
            sqrtPriceX96 = FullMath.mulDiv(sqrtPriceX96, wethSqrtPriceX96, 1 << 96);
        }
    }

    function _getTokenPrice(
        address pool, address token, address otherToken
    ) internal view returns (uint256 sqrtPriceX96) {
        
        (uint160 price,,,,,,) = IUniswapV3Pool(pool).slot0();

        sqrtPriceX96 = uint256(price);
        if (token > otherToken) {
            sqrtPriceX96 = (1 << 192) / sqrtPriceX96;

        }
    }
}
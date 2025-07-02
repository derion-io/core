// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.20;

import {IUniswapV3Pool} from "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IUniV3ERC20WrapperFactory} from "./IUniV3ERC20WrapperFactory.sol";

/// @title BunniToken
/// @author zefram.eth
/// @notice ERC20 token that represents a user's LP position
interface IUniV3ERC20Wrapper is IERC20 {
    function pool() external view returns (IUniswapV3Pool);

    function tickLower() external view returns (int24);

    function tickUpper() external view returns (int24);

    function factory() external view returns (IUniV3ERC20WrapperFactory);

    function mint(address to, uint256 amount) external;

    function burn(address from, uint256 amount) external;
}
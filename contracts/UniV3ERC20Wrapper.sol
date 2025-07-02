// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.20;

import {IUniswapV3Pool} from "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IUniV3ERC20WrapperFactory} from "./interfaces/IUniV3ERC20WrapperFactory.sol";
import {IUniV3ERC20Wrapper} from "./interfaces/IUniV3ERC20Wrapper.sol";
import {UniKey} from "./interfaces/ILiquidityManagement.sol";

/// @title BunniToken
/// @author zefram.eth
/// @notice ERC20 token that represents a user's LP position
contract UniV3ERC20Wrapper is IUniV3ERC20Wrapper, ERC20 {
    IUniswapV3Pool public immutable override pool;
    int24 public immutable override tickLower;
    int24 public immutable override tickUpper;
    IUniV3ERC20WrapperFactory public immutable override factory;

    constructor(address factory_, UniKey memory key_)
        ERC20(
            string(
                abi.encodePacked(
                    "Derivable ",
                    IERC20Metadata(key_.pool.token0()).symbol(),
                    "/",
                    IERC20Metadata(key_.pool.token1()).symbol(),
                    " LP"
                )
            ),
            "DERI-LP"
        )
    {
        pool = key_.pool;
        tickLower = key_.tickLower;
        tickUpper = key_.tickUpper;
        factory = IUniV3ERC20WrapperFactory(factory_);
    }

    function mint(address to, uint256 amount) external override {
        require(msg.sender == address(factory), "WHO");

        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external override {
        require(msg.sender == address(factory), "WHO");

        _burn(from, amount);
    }
}
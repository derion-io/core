/**
 *Submitted for verification at BscScan.com on 2021-10-27
*/

// SPDX-License-Identifier: BSL-1.1
pragma solidity >=0.6.2;
pragma experimental ABIEncoderV2;

contract PairDetails {
    uint constant TOKEN_SYMBOL      = 0x1;
    uint constant TOKEN_NAME        = 0x10;
    uint constant TOKEN_DECIMAlS    = 0x100;
    uint constant TOKEN_SUPPLY      = 0x1000;

    uint constant PAIR_SUPPLY       = 0x10000000000000000000000000000000000000000000000000000000000;
    uint constant PAIR_RESERVES     = 0x100000000000000000000000000000000000000000000000000000000000;
    uint constant PAIR_FACTORY      = 0x1000000000000000000000000000000000000000000000000000000000000;
    uint constant PAIR_DECIMALS     = 0x10000000000000000000000000000000000000000000000000000000000000;
    uint constant PAIR_NAME         = 0x100000000000000000000000000000000000000000000000000000000000000;
    uint constant PAIR_SYMBOL       = 0x1000000000000000000000000000000000000000000000000000000000000000;

    struct Token {
        address adr;
        string symbol;
        string name;
        uint decimals;
        uint totalSupply;
        uint reserve;
    }

    struct PairDetail {
        string symbol;
        string name;
        uint decimals;
        address factory;
        uint totalSupply;
        Token token0;
        Token token1;
    }

    function query(address[] calldata pairs, uint flags) external view returns (
        PairDetail[] memory details
    ) {
        details = new PairDetail[](pairs.length);
        for (uint i = 0; i < pairs.length; ++i) {
            IERC20 lp = IERC20(pairs[i]);
            if (flags & PAIR_SYMBOL > 0) {
                details[i].symbol = lp.symbol();
            }
            if (flags & PAIR_NAME > 0) {
                details[i].name = lp.name();
            }
            if (flags & PAIR_DECIMALS > 0) {
                details[i].decimals = lp.decimals();
            }
            if (flags & PAIR_SUPPLY > 0) {
                details[i].totalSupply = lp.totalSupply();
            }

            IUniswapV2Pair pair = IUniswapV2Pair(pairs[i]);
            if (flags & PAIR_FACTORY > 0) {
                details[i].factory = pair.factory();
            }
            if (flags & PAIR_RESERVES > 0) {
                (details[i].token0.reserve, details[i].token1.reserve, ) = pair.getReserves();
            }
            IERC20 token0 = IERC20(details[i].token0.adr = pair.token0());
            IERC20 token1 = IERC20(details[i].token1.adr = pair.token1());
            if (flags & TOKEN_SYMBOL > 0) {
                details[i].token0.symbol = token0.symbol();
                details[i].token1.symbol = token1.symbol();
            }
            if (flags & TOKEN_NAME > 0) {
                details[i].token0.name = token0.name();
                details[i].token1.name = token1.name();
            }
            if (flags & TOKEN_DECIMAlS > 0) {
                details[i].token0.decimals = token0.decimals();
                details[i].token1.decimals = token1.decimals();
            }
            if (flags & TOKEN_SUPPLY > 0) {
                details[i].token0.totalSupply = token0.totalSupply();
                details[i].token1.totalSupply = token1.totalSupply();
            }
        }
    }
}

interface IUniswapV2Pair {
    function factory() external view returns (address);
    function token0() external view returns (address);
    function token1() external view returns (address);
    function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast);
}

interface IERC20 {
    function name() external view returns (string memory);
    function symbol() external view returns (string memory);
    function decimals() external view returns (uint8);
    function totalSupply() external view returns (uint);
}
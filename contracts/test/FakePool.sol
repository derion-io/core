// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.28;

import "../interfaces/IPool.sol";
import "../interfaces/IToken.sol";

contract FakePool is IPool {
    address private immutable TOKEN;

    constructor(address token) {
        TOKEN = token;
    }

    function init(State memory state, Payment memory payment) external {
        // do nothing
    }

    function loadConfig() external pure returns (Config memory config) {
        config.ORACLE = "FAKE";
    }

    function swap(
        Param memory,
        Payment memory
    )
        external
        pure
        returns (uint256 amountIn, uint256 amountOut, uint256 price)
    {
        return (0, 0, 0);
    }

    function mint(
        address to,
        uint256 id,
        uint256 amount,
        uint32 maturity,
        bytes memory data
    ) public {
        IToken(TOKEN).mint(to, id, amount, maturity, data);
    }
}

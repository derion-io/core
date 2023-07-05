// SPDX-License-Identifier: BSL-1.1
pragma solidity ^0.8.0;

import "../interfaces/IPool.sol";
import "../interfaces/IToken.sol";

contract FakePool is IPool{
    address immutable private TOKEN;

    constructor(address token) {
        TOKEN = token;
    }

    function mintLock(
        address to,
        uint256 id,
        uint256 amount,
        uint32 maturity,
        bytes memory data
    ) public {
        IToken(TOKEN).mintLock(to, id, amount, maturity, data);
    }

    function loadConfig() pure external returns (Config memory config) {
        config.ORACLE = "FAKE";
    }

    function init(State memory state, Payment memory payment) external {
        // do nothing
    }

    function swap(
        Param memory param,
        Payment memory payment
    ) external pure returns(uint amountIn, uint amountOut) {
        return (0, 0);
    }
}
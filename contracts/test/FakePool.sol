// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.28;

import "../interfaces/IPool.sol";
import "../interfaces/IToken.sol";

contract FakePool is IPool {
    address private immutable TOKEN;

    constructor(address token) {
        TOKEN = token;
    }

    function initialize(State memory state, Payment memory payment) external {
        // do nothing
    }

    function loadConfig() external pure returns (Config memory config) {
        config.ORACLE = "FAKE";
    }

    function transition(
        Param memory param,
        Payment memory payment
    ) external {
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

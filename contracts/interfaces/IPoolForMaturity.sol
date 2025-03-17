// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.28;

import "./IPool.sol";

interface IPoolForMaturity {
    function transition(
        Param memory param,
        Payment memory payment
    ) external returns (Result memory);
}

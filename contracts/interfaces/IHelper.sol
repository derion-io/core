// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.28;

import "./IPool.sol";

interface IHelper {
    function updateState(
        Slippable calldata,
        bytes calldata payload
    ) external view returns(State memory state1);
}

// SPDX-License-Identifier: BSL-1.1
pragma solidity 0.8.20;

import "./IPool.sol";

interface IHelper {
    function swapToState(
        Slippable calldata,
        bytes calldata payload
    ) external view returns(State memory state1);
}

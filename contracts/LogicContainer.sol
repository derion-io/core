// SPDX-License-Identifier: BSL-1.1
pragma solidity ^0.8.0;

import "./logics/AsymptoticPerpetual.sol";

contract LogicContainer {
    function getPoolBytecode() external pure returns (bytes memory) {
        return type(AsymptoticPerpetual).creationCode;
    }
}

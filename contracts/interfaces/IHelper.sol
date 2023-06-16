// SPDX-License-Identifier: BSL-1.1
pragma solidity ^0.8.0;

import "./IPool.sol";

interface IHelper {
    struct ReserveParam {
        uint rA;
        uint rB;
        uint rC;
    }

    function swapToState(
        Market calldata market,
        State calldata state,
        ReserveParam calldata reserveParam,
        bytes calldata payload
    ) external view returns(State memory state1);
}

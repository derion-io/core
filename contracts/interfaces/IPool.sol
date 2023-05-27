// SPDX-License-Identifier: BSL-1.1
pragma solidity ^0.8.0;

import "./IAsymptoticPerpetual.sol";

interface IPool is IAsymptoticPerpetual{
    
    function swap(
        uint sideIn,
        uint sideOut,
        address helper,
        bytes calldata payload,
        uint32 expiration,
        address payer,
        address recipient
    ) external returns(uint amountIn, uint amountOut);
}
// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

import "@derivable/shadow-token/contracts/interfaces/IShadowFactory.sol";

interface IToken is IShadowFactory {
    function mintLock(
        address to,
        uint256 id,
        uint256 amount,
        uint32 maturity,
        bytes memory data
    ) external;

    function mint(
        address to,
        uint256 id,
        uint256 amount,
        bytes memory data
    ) external;

    function burn(
        address from,
        uint256 id,
        uint256 amount
    ) external;
}

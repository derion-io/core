// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.28;

import "./IPool.sol";
import "./IFetcher.sol";

interface IPositioner {
    function TOKEN() external returns (address);
    function MATURITY() external returns (uint256);
    function MATURITY_VEST() external returns (uint256);
    function MATURITY_RATE() external returns (uint256);
    function OPEN_RATE() external returns (uint256);

    function fetchPrices(
        uint256 ORACLE,
        bytes calldata payload
    ) external view returns (uint256 twap, uint256 spot);

    function initialize(
        Config memory config,
        State memory state,
        Payment memory payment
    ) external;

    function handleTransition(
        Config calldata config,
        bytes calldata payload,
        Payment memory payment,
        Receipt calldata receipt
    ) external returns (Result memory result);
}
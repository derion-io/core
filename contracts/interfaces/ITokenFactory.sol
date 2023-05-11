// SPDX-License-Identifier: BSL-1.1
pragma solidity ^0.8.0;

struct Params {
    address token;
    uint id;
}

interface ITokenFactory {
    function getParams() external view returns (Params memory);

    function computePoolAddress(
        Params memory params
    ) external view returns (address pool);
}

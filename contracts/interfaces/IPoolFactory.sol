// SPDX-License-Identifier: BSL-1.1
pragma solidity ^0.8.0;

struct Params {
    address utr;
    address token;
    bytes32 oracle; // 1bit QTI, 31bit reserve, 32bit WINDOW, ... PAIR ADDRESS
    address reserveToken;
    address recipient;
    uint    mark;
    uint    halfLife;
    uint    premiumRate;
    uint32  maturity;
    uint32  maturityVest;
    uint    maturityRate;   // x128
    uint    discountRate;
    uint    openRate;
    uint k;
    uint a;
    uint b;
}

interface IPoolFactory {
    function getParams() external view returns (Params memory);
    function createPool(Params memory params) external returns (address pool);
    function computePoolAddress(Params memory params) external view returns (address pool);
    function FEE_TO() external view returns (address);
    function FEE_RATE() external view returns (uint);
}

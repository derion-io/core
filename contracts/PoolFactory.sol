// SPDX-License-Identifier: BSL-1.1
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/utils/Create2.sol";
import "./interfaces/IPoolFactory.sol";
import "./logics/AsymptoticPerpetual.sol";

contract PoolFactory is IPoolFactory {
    bytes32 constant public BYTECODE_HASH = keccak256(type(AsymptoticPerpetual).creationCode);

    // storage
    address internal s_feeTo;
    address internal s_feeToSetter;

    // transient storage
    Params t_params;

    constructor(
        address feeToSetter
    ) {
        s_feeToSetter = feeToSetter;
    }

    function getParams() external view override returns (Params memory) {
        return t_params;
    }

    function _salt(Params memory params) internal pure returns (bytes32) {
        return keccak256(
            abi.encodePacked(
                params.token,
                params.oracle,
                params.reserveToken,
                params.mark,
                params.k,
                params.halfLife,
                params.premiumRate,
                params.maturity,
                params.maturityVest,
                params.discountRate,
                params.openRate
            )
        );
    }

    function createPool(Params memory params) external returns (address pool) {
        t_params = params;
        pool = Create2.deploy(0, _salt(params), type(AsymptoticPerpetual).creationCode);
        delete t_params;
    }

    function computePoolAddress(
        Params memory params
    ) external view returns (address pool) {
        return Create2.computeAddress(_salt(params), BYTECODE_HASH, address(this));
    }

    function getFeeTo() external view returns (address) {
        return s_feeTo;
    }

    function setFeeTo(address feeTo) external {
        require(msg.sender == s_feeToSetter, 'UNA');
        s_feeTo = feeTo;
    }

    function getFeeToSetter() external view returns (address) {
        return s_feeToSetter;
    }

    function setFeeToSetter(address feeToSetter) external {
        require(msg.sender == s_feeToSetter, 'UNA');
        s_feeToSetter = feeToSetter;
    }
}

// SPDX-License-Identifier: BSL-1.1
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/utils/Create2.sol";
import "./interfaces/IPoolFactory.sol";
import "./logics/AsymptoticPerpetual.sol";

contract PoolFactory is IPoolFactory {
    bytes32 constant internal ORACLE_MASK = bytes32((1 << 255) | type(uint160).max);
    bytes32 constant public BYTECODE_HASH = keccak256(type(AsymptoticPerpetual).creationCode);

    address immutable public FEE_TO;
    uint immutable public FEE_RATE;

    // events
    event Derivable(
        bytes32 indexed topic1,
        bytes32 indexed topic2,
        bytes32 indexed topic3,
        bytes data
    );

    // transient storage
    Params t_params;

    constructor(
        address feeTo,
        uint feeRate
    ) {
        FEE_TO = feeTo;
        FEE_RATE = feeRate;
    }

    function getParams() external view override returns (Params memory) {
        return t_params;
    }

    function _pack(Params memory params) internal pure returns (bytes memory) {
        return abi.encode(
            params.token,
            params.oracle,
            params.mark,
            params.k,
            params.halfLife,
            params.premiumRate,
            params.maturity,
            params.maturityVest,
            params.maturityRate,
            params.discountRate,
            params.openRate
        );
    }

    function _salt(Params memory params) internal pure returns (bytes32) {
        return keccak256(_pack(params));
    }

    function createPool(Params memory params) external returns (address pool) {
        t_params = params;
        pool = Create2.deploy(0, _salt(params), type(AsymptoticPerpetual).creationCode);
        delete t_params;

        emit Derivable(
            'PoolCreated',                          // topic1: event name
            params.oracle & ORACLE_MASK,            // topic2: price index
            bytes32(bytes20(params.reserveToken)),  // topic3: reserve token
            abi.encodePacked(
                _pack(params),
                bytes32(bytes20(pool))
            )
        );
    }

    function computePoolAddress(
        Params memory params
    ) external view returns (address pool) {
        return Create2.computeAddress(_salt(params), BYTECODE_HASH, address(this));
    }
}

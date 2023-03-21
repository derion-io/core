// SPDX-License-Identifier: BSL-1.1
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/utils/Create2.sol";
import "./interfaces/IPoolFactory.sol";
import "./DerivablePool.sol";

contract PoolFactory is IPoolFactory {
    bytes32 immutable BYTECODE_HASH;
    address immutable public TOKEN_1155;

    constructor(
        address token1155
    ) {
        BYTECODE_HASH = keccak256(type(DerivablePool).creationCode);
        TOKEN_1155 = token1155;
    }

    // transient storage
    Params t_params;

    function getParams() external view override returns (Params memory) {
        return t_params;
    }

    function createPool(Params memory params) external returns (address pool) {
        t_params = params;
        bytes32 salt = keccak256(
            abi.encodePacked(
                params.logic,
                params.tokenOracle,
                params.tokenCollateral,
                params.recipient,
                params.markPrice,
                params.power,
                params.a,
                params.b
            )
        );
        pool = Create2.deploy(0, salt, type(DerivablePool).creationCode);
        delete t_params;
    }

    function computePoolAddress(
        Params memory params
    ) external view returns (address pool) {
        bytes32 salt = keccak256(
            abi.encodePacked(
                params.logic,
                params.tokenOracle,
                params.tokenCollateral,
                params.recipient,
                params.markPrice,
                params.power,
                params.a,
                params.b
            )
        );
        return Create2.computeAddress(salt, BYTECODE_HASH, address(this));
    }
}

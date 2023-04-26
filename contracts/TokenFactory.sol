// SPDX-License-Identifier: BSL-1.1
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/utils/Create2.sol";

import "./interfaces/ITokenFactory.sol";
import "./ShadowCloneERC20.sol";

contract TokenFactory is ITokenFactory {
    bytes32 immutable BYTECODE_HASH = keccak256(type(ShadowCloneERC20).creationCode);

    // transient storage
    Params t_params;

    function getParams() external view override returns (Params memory) {
        return t_params;
    }

    function _salt(Params memory params) internal pure returns (bytes32) {
        return keccak256(
            abi.encodePacked(
                params.token,
                params.id
            )
        );
    }

    function createPool(Params memory params) external returns (address pool) {
        t_params = params;
        pool = Create2.deploy(0, _salt(params), type(ShadowCloneERC20).creationCode);
        delete t_params;
    }

    function computePoolAddress(
        Params memory params
    ) external view override returns (address pool) {
        return Create2.computeAddress(_salt(params), BYTECODE_HASH, address(this));
    }
}

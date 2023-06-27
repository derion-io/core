// SPDX-License-Identifier: BSL-1.1
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/utils/Create2.sol";
import "./interfaces/IPoolFactory.sol";
import "./logics/AsymptoticPerpetual.sol";

contract PoolFactory is IPoolFactory {
    bytes32 constant public BYTECODE_HASH = keccak256(type(AsymptoticPerpetual).creationCode);

    address immutable public FEE_TO;
    uint immutable public FEE_RATE;

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
}

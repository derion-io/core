// SPDX-License-Identifier: BSL-1.1
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/utils/Create2.sol";
import "./interfaces/IPoolFactory.sol";
import "./interfaces/ILogicContainer.sol";

contract PoolFactory is IPoolFactory {
    bytes32 immutable public BYTECODE_HASH;
    uint internal immutable FEE_RATE;
    uint internal immutable FEE_HL_LIMIT;
    address internal immutable LOGIC_CONTAINER;

    // storage
    address internal s_feeTo;
    address internal s_feeToSetter;

    // transient storage
    Params t_params;

    constructor(
        address feeToSetter,
        address logicContainer,
        uint feeRate,
        uint feeHLLimit
    ) {
        if (feeToSetter == address(0)) {
            feeToSetter = msg.sender;
        }
        s_feeToSetter = feeToSetter;
        FEE_RATE = feeRate;
        FEE_HL_LIMIT = feeHLLimit;
        LOGIC_CONTAINER = logicContainer;
        BYTECODE_HASH = keccak256(ILogicContainer(logicContainer).getPoolBytecode());
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
                params.minExpirationD,
                params.minExpirationC,
                params.discountRate
            )
        );
    }

    function createPool(Params memory params) external returns (address pool) {
        t_params = params;
        pool = Create2.deploy(0, _salt(params), ILogicContainer(LOGIC_CONTAINER).getPoolBytecode());
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

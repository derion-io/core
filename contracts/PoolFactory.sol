// SPDX-License-Identifier: BSL-1.1
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/utils/Create2.sol";
import "./libs/MetaProxyFactory.sol";
import "./interfaces/IPoolFactory.sol";

contract PoolFactory is IPoolFactory {
    bytes32 constant internal ORACLE_MASK = bytes32((1 << 255) | type(uint160).max);

    address immutable public TOKEN;
    address immutable public LOGIC;
    address immutable public FEE_TO;
    uint immutable public FEE_RATE;

    // events
    event Derivable(
        bytes32 indexed topic1,
        bytes32 indexed topic2,
        bytes32 indexed topic3,
        bytes data
    );

    constructor(
        address token,
        address logic,
        address feeTo,
        uint feeRate
    ) {
        TOKEN = token;
        LOGIC = logic;
        FEE_TO = feeTo;
        FEE_RATE = feeRate;
    }

    function createPool(
        Config memory config
    ) external returns (address pool) {
        config.TOKEN = TOKEN;
        config.FEE_TO = FEE_TO;
        config.HL_FEE = config.HL_INTEREST * FEE_RATE;
        bytes memory input = abi.encode(config);
        pool = MetaProxyFactory.metaProxyFromBytes(LOGIC, input);
        emit Derivable(
            'PoolCreated',                          // topic1: event name
            config.ORACLE & ORACLE_MASK,            // topic2: price index
            bytes32(uint(uint160(config.TOKEN_R))), // topic3: reserve token
            abi.encode(
                config.ORACLE,
                config.K,
                config.MARK,
                config.HL_INTEREST,
                config.PREMIUM_RATE,
                config.MATURITY,
                config.MATURITY_VEST,
                config.MATURITY_RATE,
                config.OPEN_RATE,
                uint(uint160(pool))
            )
        );
    }
}

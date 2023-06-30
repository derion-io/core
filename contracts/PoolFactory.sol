// SPDX-License-Identifier: BSL-1.1
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/utils/Create2.sol";
import "./libs/MetaProxyFactory.sol";
import "./interfaces/IPoolFactory.sol";

contract PoolFactory is IPoolFactory {
    bytes32 constant internal ORACLE_MASK = bytes32((1 << 255) | type(uint160).max);

    address immutable public LOGIC;

    // events
    event Derivable(
        bytes32 indexed topic1,
        bytes32 indexed topic2,
        bytes32 indexed topic3,
        bytes data
    );

    constructor(address logic) {
        LOGIC = logic;
    }

    function createPool(
        Config memory config
    ) external returns (address pool) {
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
                config.INTEREST_HL,
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

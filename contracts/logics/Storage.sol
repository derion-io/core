// SPDX-License-Identifier: BSL-1.1
pragma solidity ^0.8.0;

import "@derivable/oracle/contracts/OracleStore.sol";

contract Storage {
    OracleStore internal s_oracleStore;
    uint32 internal s_priceScaleTimestamp;
    uint224 internal s_markPrice;

    address internal s_token1155;

    uint internal s_a;
    uint internal s_b;
    uint internal s_power;
}
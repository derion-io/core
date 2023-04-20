// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

abstract contract Events {
    event Derivable(
        bytes32 indexed topic1,
        bytes32 indexed topic2,
        bytes32 indexed topic3,
        bytes data
    );

//    struct Deleverage {
//        uint224 twapBase;
//        uint224 twapLP;
//        uint scaleLongBefore;
//        uint scaleLongAfter;
//        uint priceScaleLong;
//        uint priceScaleShort;
//    }

    struct PoolCreated {
        address UTR;
        address TOKEN;
        address LOGIC;
        bytes32 ORACLE;
        address TOKEN_R;
        uint256 MARK;
        uint256 k;
    }

    function _addressToBytes32(address addr) internal pure returns (bytes32) {
        return bytes32(uint256(uint160(addr)) << 96);
    }
}
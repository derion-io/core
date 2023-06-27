// SPDX-License-Identifier: BSL-1.1
pragma solidity ^0.8.0;

import "@uniswap/lib/contracts/libraries/TransferHelper.sol";

// TODO: whould we implement 777, 721, and 1155  Holder/Receiver interfaces?
contract FeeReceiver {
    // storage
    address internal s_setter;
    address internal s_collector;

    // accepting ETH
    receive() external payable {}

    constructor(address setter) {
        s_setter = setter;
    }

    modifier onlySetter {
        require(msg.sender == s_setter, "FeeReciever: NOT_SETTER");
        _;
    }

    modifier onlyCollector {
        require(msg.sender == s_collector, "FeeReciever: NOT_COLLECTOR");
        _;
    }

    function getSetter() external view returns (address) {
        return s_setter;
    }

    function setSetter(address setter) onlySetter external {
        s_setter = setter;
    }

    function getCollector() external view returns (address) {
        return s_collector;
    }

    function setCollector(address collector) onlySetter external {
        s_collector = collector;
    }

    // TODO: collect all kinds of tokens by passing an eip and id
    function collect(address token, address recipient, uint amount) onlyCollector external {
        if (token == address(0)) {
            TransferHelper.safeTransferETH(recipient, amount);
        } else {
            TransferHelper.safeTransfer(token, recipient, amount);
        }
    }
}

// SPDX-License-Identifier: BSL-1.1
pragma solidity 0.8.20;

import "@uniswap/lib/contracts/libraries/TransferHelper.sol";

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

    function collect(address token, address recipient, uint256 amount) onlyCollector external {
        if (token == address(0)) {
            TransferHelper.safeTransferETH(recipient, amount);
        } else {
            TransferHelper.safeTransfer(token, recipient, amount);
        }
    }
}

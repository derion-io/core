// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@derivable/utr/contracts/interfaces/IUniversalTokenRouter.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import "@uniswap/lib/contracts/libraries/TransferHelper.sol";

contract FakeUTR is ERC165, IUniversalTokenRouter {
    uint256 constant PAYMENT       = 0;
    uint256 constant TRANSFER      = 1;
    uint256 constant CALL_VALUE    = 2;

    uint256 constant EIP_ETH       = 0;

    uint256 constant ERC_721_BALANCE = uint256(keccak256('UniversalTokenRouter.ERC_721_BALANCE'));

    // transient pending payments
    mapping(bytes32 => uint256) t_payments;

    // accepting ETH for WETH.withdraw
    receive() external payable {}

    function exec(
        Output[] memory outputs,
        Action[] memory actions
    ) override external payable {
    unchecked {
        // track the expected balances before any action is executed
        for (uint256 i = 0; i < outputs.length; ++i) {
            Output memory output = outputs[i];
            uint256 balance = _balanceOf(output);
            uint256 expected = output.amountOutMin + balance;
            require(expected >= balance, 'UniversalTokenRouter: OUTPUT_BALANCE_OVERFLOW');
            output.amountOutMin = expected;
        }

        address sender = msg.sender;

        for (uint256 i = 0; i < actions.length; ++i) {
            Action memory action = actions[i];
            uint256 value;
            for (uint256 j = 0; j < action.inputs.length; ++j) {
                Input memory input = action.inputs[j];
                uint256 mode = input.mode;
                if (mode == CALL_VALUE) {
                    // eip and id are ignored
                    value = input.amountIn;
                } else {
                    bytes memory payment = abi.encode(sender, input.recipient, input.eip, input.token, input.id);
                    if (mode == PAYMENT) {
                        t_payments[keccak256(payment)] = input.amountIn;
                    } else if (mode == TRANSFER) {
                        _transferToken(payment, input.amountIn);
                    } else {
                        revert('UniversalTokenRouter: INVALID_MODE');
                    }
                }
            }
            if (action.data.length > 0) {
                (bool success, bytes memory result) = action.code.call{value: value}(action.data);
                if (!success) {
                    assembly {
                        revert(add(result,32),mload(result))
                    }
                }
            }
            // clear all transient storages, allowances and left-overs
            for (uint256 j = 0; j < action.inputs.length; ++j) {
                Input memory input = action.inputs[j];
                if (input.mode == PAYMENT) {
                    // transient storages
                    bytes32 key = keccak256(abi.encodePacked(sender, input.recipient, input.eip, input.token, input.id));
                    delete t_payments[key];
                }
            }
        }

        // refund any left-over ETH
        uint256 leftOver = address(this).balance;
        if (leftOver > 0) {
            TransferHelper.safeTransferETH(sender, leftOver);
        }

        // verify balance changes
        for (uint256 i = 0; i < outputs.length; ++i) {
            Output memory output = outputs[i];
            uint256 balance = _balanceOf(output);
            // NOTE: output.amountOutMin is reused as `expected`
            require(balance >= output.amountOutMin, 'UniversalTokenRouter: INSUFFICIENT_OUTPUT_AMOUNT');
        }
    } }
    
    function pay(bytes memory payment, uint256 amount) external override {
        discard(payment, amount);
        // TEST: require PoolBase with amount / 2
        _transferToken(payment, amount / 2);
    }

    function discard(bytes memory payment, uint256 amount) public override {
        bytes32 key = keccak256(payment);
        require(t_payments[key] >= amount, 'UniversalTokenRouter: INSUFFICIENT_PAYMENT');
        unchecked {
            t_payments[key] -= amount;
        }
    }

    // IERC165-supportsInterface
    function supportsInterface(bytes4 interfaceId) public view virtual override(ERC165, IERC165) returns (bool) {
        return
            interfaceId == type(IUniversalTokenRouter).interfaceId ||
            super.supportsInterface(interfaceId);
    }

    function _transferToken(bytes memory payment, uint256 amount) internal {
        (
            address sender,
            address recipient,
            uint256 eip,
            address token,
            uint256 id
        ) = abi.decode(payment, (address, address, uint256, address, uint256));

        if (eip == 20) {
            TransferHelper.safeTransferFrom(token, sender, recipient, amount);
        } else if (eip == 1155) {
            IERC1155(token).safeTransferFrom(sender, recipient, id, amount, "");
        } else if (eip == 721) {
            IERC721(token).safeTransferFrom(sender, recipient, id);
        } else {
            revert("UniversalTokenRouter: INVALID_EIP");
        }
    }

    function _balanceOf(
        Output memory output
    ) internal view returns (uint256 balance) {
        uint256 eip = output.eip;
        if (eip == 20) {
            return IERC20(output.token).balanceOf(output.recipient);
        }
        if (eip == 1155) {
            return IERC1155(output.token).balanceOf(output.recipient, output.id);
        }
        if (eip == 721) {
            if (output.id == ERC_721_BALANCE) {
                return IERC721(output.token).balanceOf(output.recipient);
            }
            try IERC721(output.token).ownerOf(output.id) returns (address currentOwner) {
                return currentOwner == output.recipient ? 1 : 0;
            } catch {
                return 0;
            }
        }
        if (eip == EIP_ETH) {
            return output.recipient.balance;
        }
        revert("UniversalTokenRouter: INVALID_EIP");
    }
}

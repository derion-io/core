// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";

import "@derion/utr/contracts/NotToken.sol";

import "./interfaces/IPool.sol";
import "./interfaces/IPositioner.sol";
import "./subs/Constants.sol";
import "./subs/Storage.sol";

/// @title The base logic code for state initialization and token payment. 
/// @author Derivable Labs
/// @notice PoolBase is extended by PoolLogic to form the Pool contract.
abstract contract PoolBase is IPool, ERC1155Holder, Storage, Constants, NotToken, ReentrancyGuardTransient {
    /// Initializes the pool state before any interaction can be made.
    /// @param state initial state of the pool
    /// @param payment payment info
    function initialize(State memory state, Payment memory payment) external {
        Config memory config = loadConfig();
        (bool success, bytes memory result) = config.POSITIONER.delegatecall(
            abi.encodeWithSelector(
                IPositioner.initialize.selector,
                config,
                state,
                payment
            )
        );
        if (!success) {
            assembly {
                revert(add(result,32),mload(result))
            }
        }
        assembly {
            return(add(result,32),mload(result))
        }
    }

    /// @return R pool reserve
    /// @return a LONG coefficient
    /// @return b SHORT coefficient
    /// @return i lastInterestTime
    /// @return f lastPremiumTime
    function getStates()
        external
        view
        returns (uint256 R, uint256 a, uint256 b, uint32 i, uint32 f)
    {
        Config memory config = loadConfig();
        R = IERC20(config.TOKEN_R).balanceOf(address(this));
        i = s_lastInterestTime;
        a = s_a;
        f = s_lastPremiumTime;
        b = s_b;
    }

    /**
     * @dev against read-only reentrancy
     */
    function ensureStateIntegrity() public view {
        require(!_reentrancyGuardEntered(), 'PoolBase: STATE_INTEGRITY');
    }

    /// @notice Returns the metadata of this (MetaProxy) contract.
    /// Only relevant with contracts created via the MetaProxy standard.
    /// @dev This function is aimed to be invoked with- & without a call.
    function loadConfig() public pure returns (Config memory config) {
        bytes memory data;
        assembly {
            let posOfMetadataSize := sub(calldatasize(), 32)
            let size := calldataload(posOfMetadataSize)
            let dataPtr := sub(posOfMetadataSize, size)
            data := mload(64)
            // increment free memory pointer by metadata size + 32 bytes (length)
            mstore(64, add(data, add(size, 32)))
            mstore(data, size)
            let memPtr := add(data, 32)
            calldatacopy(memPtr, dataPtr, size)
        }
        return abi.decode(data, (Config));
    }
}

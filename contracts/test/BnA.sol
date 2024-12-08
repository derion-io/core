/**
 *Submitted for verification at BscScan.com on 2022-04-29
*/
// solhint-disable
// File: contracts/interfaces/IERC20.sol

interface IERC20 {
    function balanceOf(address owner) external view returns (uint256);
    function allowance(address owner, address spender) external view returns (uint256);
}

// File: contracts/BnA.sol

// SPDX-License-Identifier: BUSL-1.1
pragma solidity >=0.6.2;
pragma experimental ABIEncoderV2;

/** @title BnA: Balance and Allowance */
/** @author Zergity */

contract BnA {
    address private constant COIN = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    function getBnA(
        address[] calldata tokens,
        address[] calldata owners,
        address[] calldata spenders
    ) external view returns (uint256[] memory rets, uint256 blockNumber) {
        rets = new uint256[](tokens.length * owners.length * (1 + spenders.length));
        uint256 n = 0;
        for (uint256 i = 0; i < tokens.length; ++i) {
            IERC20 token = IERC20(tokens[i]);
            for (uint256 j = 0; j < owners.length; ++j) {
                address owner = owners[j];

                if (address(token) == COIN) {
                    rets[n] = owner.balance;
                    n += 1 + spenders.length;
                    continue;
                }

                try token.balanceOf(owner) returns (uint256 balance) {
                    rets[n] = balance;
                } catch (bytes memory /*lowLevelData*/) {}
                n++;

                for (uint256 k = 0; k < spenders.length; ++k) {
                    try token.allowance(owner, spenders[k]) returns (uint256 allowance) {
                        rets[n] = allowance;
                    } catch (bytes memory /*lowLevelData*/) {}
                    n++;
                }
            }
        }
        blockNumber = block.number;
    }
}
// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.28;

import "../PoolLogic.sol";

contract PoolLogicMock is PoolLogic {
    constructor(
        address token,
        address feeTo,
        uint256 feeRate
    ) PoolLogic(feeTo, feeRate) {}

    function loadState(
        uint224 a,
        uint224 b,
        uint32 f,
        uint32 i,
        uint256 sA,
        uint256 sB,
        uint256 sC
    ) external {
        Config memory config = loadConfig();
        s_a = a;
        s_b = b;
        s_lastPremiumTime = f;
        s_lastInterestTime = i;
        uint256 curSA = _supply(config.TOKEN, SIDE_A);
        uint256 curSB = _supply(config.TOKEN, SIDE_B);
        uint256 curSC = _supply(config.TOKEN, SIDE_C);
        if (sA < curSA) {
            IToken(config.TOKEN).burn(
                msg.sender,
                _packID(address(this), SIDE_A),
                curSA - sA
            );
        } else {
            IToken(config.TOKEN).mint(
                msg.sender,
                _packID(address(this), SIDE_A),
                sA - curSA,
                ""
            );
        }

        if (sB < curSB) {
            IToken(config.TOKEN).burn(
                msg.sender,
                _packID(address(this), SIDE_B),
                curSB - sB
            );
        } else {
            IToken(config.TOKEN).mint(
                msg.sender,
                _packID(address(this), SIDE_B),
                sB - curSB,
                ""
            );
        }

        if (sC < curSC) {
            IToken(config.TOKEN).burn(
                msg.sender,
                _packID(address(this), SIDE_C),
                curSC - sC
            );
        } else {
            IToken(config.TOKEN).mint(
                msg.sender,
                _packID(address(this), SIDE_C),
                sC - curSC,
                ""
            );
        }
    }
}

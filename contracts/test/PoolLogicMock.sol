// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.20;

import "../PoolLogic.sol";

contract PoolLogicMock is PoolLogic {
    constructor(
        address token,
        address feeTo,
        uint256 feeRate
    ) PoolLogic(token, feeTo, feeRate) {}

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
        uint256 curSA = _supply(SIDE_A);
        uint256 curSB = _supply(SIDE_B);
        uint256 curSC = _supply(SIDE_C);
        if (sA < curSA) {
            IToken(TOKEN).burn(
                msg.sender,
                _packID(address(this), SIDE_A),
                curSA - sA
            );
        } else {
            IToken(TOKEN).mint(
                msg.sender,
                _packID(address(this), SIDE_A),
                sA - curSA,
                uint32(config.MATURITY),
                ""
            );
        }

        if (sB < curSB) {
            IToken(TOKEN).burn(
                msg.sender,
                _packID(address(this), SIDE_B),
                curSB - sB
            );
        } else {
            IToken(TOKEN).mint(
                msg.sender,
                _packID(address(this), SIDE_B),
                sB - curSB,
                uint32(config.MATURITY),
                ""
            );
        }

        if (sC < curSC) {
            IToken(TOKEN).burn(
                msg.sender,
                _packID(address(this), SIDE_C),
                curSC - sC
            );
        } else {
            IToken(TOKEN).mint(
                msg.sender,
                _packID(address(this), SIDE_C),
                sC - curSC,
                uint32(config.MATURITY),
                ""
            );
        }
    }
}

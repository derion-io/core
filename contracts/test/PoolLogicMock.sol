// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.28;

import "../PoolLogic.sol";
import "../interfaces/IToken.sol";
import "../support/PositionerForMaturity.sol";

contract PoolLogicMock is PoolLogic {
    constructor(
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
        uint256 curSA = PositionerForMaturity(config.POSITIONER).sideSupply(address(this), SIDE_A);
        uint256 curSB = PositionerForMaturity(config.POSITIONER).sideSupply(address(this), SIDE_B);
        uint256 curSC = PositionerForMaturity(config.POSITIONER).sideSupply(address(this), SIDE_C);
        address TOKEN = IPositioner(config.POSITIONER).TOKEN();
        uint256 MATURITY = IPositioner(config.POSITIONER).MATURITY();
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
                uint32(MATURITY),
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
                uint32(MATURITY),
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
                uint32(MATURITY),
                ""
            );
        }
    }

    function _packID(address pool, uint256 side) internal pure returns (uint256 id) {
        id = (side << 160) | uint160(pool);
    }
}

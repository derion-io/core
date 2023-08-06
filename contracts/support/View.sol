// SPDX-License-Identifier: BSL-1.1
pragma solidity ^0.8.0;

import "../PoolLogic.sol";

contract View is PoolLogic {
    constructor(
        address token,
        address feeTo,
        uint feeRate
    ) PoolLogic(token, feeTo, feeRate) {}

    struct StateView {
        Config config;
        State state;
        uint sA;
        uint sB;
        uint sC;
        uint rA;
        uint rB;
        uint rC;
        uint twap;
        uint spot;
    }

    function compute(
        address TOKEN
    ) external view returns (StateView memory stateView) {
        Config memory config = loadConfig();
        State memory state = State(_reserve(config.TOKEN_R), s_a, s_b);

        // [INTEREST DECAY]
        {
            uint interestRateX64 = _expRate(block.timestamp - s_i, config.INTEREST_HL);
            state.a = FullMath.mulDivRoundingUp(state.a, Q64, interestRateX64);
            state.b = FullMath.mulDivRoundingUp(state.b, Q64, interestRateX64);
        }

        (uint twap, uint spot) = _fetch(uint(config.ORACLE));
        (uint rAt, uint rBt) = _evaluate(_xk(config, twap), state);
        (uint rAs, uint rBs) = _evaluate(_xk(config, spot), state);
        uint rC = state.R - Math.max(rAt + rBt, rAs + rBs);

        if (rC > s_rCLast) {
            rC -= (rC-s_rCLast) * FEE_RATE / Q128;
        }

        stateView.rA = Math.min(rAt, rAs);
        stateView.rB = Math.min(rBt, rBs);
        stateView.rC = rC;
        stateView.sA = _supply(TOKEN, SIDE_A);
        stateView.sB = _supply(TOKEN, SIDE_B);
        stateView.sC = _supply(TOKEN, SIDE_C);
        stateView.twap = twap;
        stateView.spot = spot;
        stateView.config = config;
        stateView.state = state;
    }

    function _supply(address TOKEN, uint side) internal view returns (uint s) {
        return IERC1155Supply(TOKEN).totalSupply(_packID(address(this), side));
    }

}

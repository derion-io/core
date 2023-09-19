// SPDX-License-Identifier: BSL-1.1
pragma solidity 0.8.20;

import "../PoolLogic.sol";

contract View is PoolLogic {
    struct StateView {
        Config config;
        State state;
        uint256 sA;
        uint256 sB;
        uint256 sC;
        uint256 rA;
        uint256 rB;
        uint256 rC;
        uint256 twap;
        uint256 spot;
    }

    constructor(
        address token,
        address feeTo,
        uint256 feeRate
    ) PoolLogic(token, feeTo, feeRate) {}

    function compute(
        address TOKEN,
        uint256 FEE_RATE
    ) external view returns (StateView memory stateView) {
        Config memory config = loadConfig();
        State memory state = State(_reserve(config.TOKEN_R), s_a, s_b);

        (uint256 twap, uint256 spot) = _fetch(
            config.FETCHER,
            uint256(config.ORACLE)
        );
        (uint256 rAt, uint256 rBt) = _evaluate(_xk(config, twap), state);
        (uint256 rAs, uint256 rBs) = _evaluate(_xk(config, spot), state);

        // [INTEREST & FEE]
        uint256 Rt;
        (Rt, rAt, rBt) = _applyRate(FEE_RATE, config, state.R, rAt, rBt);
        (state.R, rAs, rBs) = _applyRate(FEE_RATE, config, state.R, rAs, rBs);

        stateView.rA = Math.min(rAt, rAs);
        stateView.rB = Math.min(rBt, rBs);
        stateView.rC = Math.min(Rt - rAt - rBt, state.R - rAs - rBs);

        if (Rt < state.R) {
            state.R = Rt;
        }

        stateView.sA = _supply(TOKEN, SIDE_A);
        stateView.sB = _supply(TOKEN, SIDE_B);
        stateView.sC = _supply(TOKEN, SIDE_C);
        stateView.twap = twap;
        stateView.spot = spot;
        stateView.config = config;
        stateView.state = state;
    }

    function _supply(
        address TOKEN,
        uint256 side
    ) internal view returns (uint256 s) {
        return IERC1155Supply(TOKEN).totalSupply(_packID(address(this), side));
    }

    function _applyRate(
        uint256 FEE_RATE,
        Config memory config,
        uint256 R,
        uint256 rA,
        uint256 rB
    ) internal view returns (uint256, uint256, uint256) {
        // track the rC before interest and premium for fee calculation
        uint256 rC = R - rA - rB;
        // [INTEREST]
        uint32 elapsed = uint32(block.timestamp) - s_lastInterestTime;
        if (elapsed > 0) {
            uint256 rate = _expRate(elapsed, config.INTEREST_HL);
            if (rate > Q64) {
                uint256 rAF = FullMath.mulDivRoundingUp(rA, Q64, rate);
                uint256 rBF = FullMath.mulDivRoundingUp(rB, Q64, rate);
                if (rA + rB > rAF + rBF) {
                    (rA, rB) = (rAF, rBF);
                }
            }
        }
        // [PREMIUM]
        elapsed = uint32(block.timestamp & F_MASK) - (s_lastPremiumTime & F_MASK);
        if (elapsed > 0) {
            uint256 rate = _expRate(elapsed, config.PREMIUM_HL);
            if (rate > Q64) {
                uint256 premium = rA > rB
                    ? FullMath.mulDiv(rA - rB, rA, R)
                    : FullMath.mulDiv(rB - rA, rB, R);
                premium -= FullMath.mulDivRoundingUp(premium, Q64, rate);
                if (premium > 0) {
                    if (rA > rB) {
                        rB += FullMath.mulDivRoundingUp(premium, rB, R - rA);
                        rA -= premium;
                    } else {
                        rA += FullMath.mulDivRoundingUp(premium, rA, R - rB);
                        rB -= premium;
                    }
                }
            }
        }
        // [FEE]
        if (FEE_RATE > 0) {
            uint256 fee = (R - rA - rB - rC) / FEE_RATE;
            if (fee > 0) {
                R -= fee;
            }
        }
        return (R, rA, rB);
    }
}

// SPDX-License-Identifier: BUSL-1.1
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
        uint256 FEE_RATE,
        uint256 twap,
        uint256 spot
    ) external returns (StateView memory stateView) {
        Config memory config = loadConfig();
        State memory state = State(_reserve(config.TOKEN_R), s_a, s_b);

        if (twap == 0 && spot == 0) {
            (twap, spot) = _fetch(config.FETCHER, uint256(config.ORACLE));
        }
        (uint256 rAt, uint256 rBt) = _evaluate(_xk(config, twap), state);
        (uint256 rAs, uint256 rBs) = _evaluate(_xk(config, spot), state);

        // [INTEREST & FEE]
        uint256 Rt;
        (Rt, rAt, rBt) = _applyRate(FEE_RATE, config, state.R, rAt, rBt);
        (state.R, rAs, rBs) = _applyRate(FEE_RATE, config, state.R, rAs, rBs);

        stateView.rA = Math.min(rAt, rAs);
        stateView.rB = Math.min(rBt, rBs);
        stateView.rC = Math.max(Rt - rAt - rBt, state.R - rAs - rBs);

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
        if (config.INTEREST_HL > 0) {
            uint256 elapsed = uint32(block.timestamp) - s_lastInterestTime;
            if (elapsed > 0) {
                uint256 rate = _decayRate(elapsed, config.INTEREST_HL);
                uint256 rAF = FullMath.mulDivRoundingUp(rA, rate, Q64);
                uint256 rBF = FullMath.mulDivRoundingUp(rB, rate, Q64);
                if (rAF < rA || rBF < rB) {
                    // interest cannot exhaust an entire side
                    rA = Math.max(rAF, 1);
                    rB = Math.max(rBF, 1);
                }
            }
        }
        // [PREMIUM]
        if (config.PREMIUM_HL > 0) {
            uint256 diff = rA > rB ? rA - rB : rB - rA;
            if (diff > 1) {
                --diff; // premium cannot exhaust an entire side
                uint256 elapsed = uint32(block.timestamp & F_MASK) - (s_lastPremiumTime & F_MASK);
                if (elapsed > 0) {
                    uint256 premiumHL = FullMath.mulDivRoundingUp(config.PREMIUM_HL >> 1, R, rA + rB);
                    uint256 rate = _decayRate(elapsed, premiumHL);
                    uint256 premium = diff >> 1;
                    premium -= FullMath.mulDivRoundingUp(premium, rate, Q64);
                    if (premium > 0) {
                        if (rA > rB) {
                            rB += premium;
                            rA -= premium;
                        } else {
                            rA += premium;
                            rB -= premium;
                        }
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

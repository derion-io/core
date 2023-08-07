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

        (uint twap, uint spot) = _fetch(uint(config.ORACLE));
        (uint rAt, uint rBt) = _evaluate(_xk(config, twap), state);
        (uint rAs, uint rBs) = _evaluate(_xk(config, spot), state);

        // [INTEREST & FEE]
        uint Rt;
        (Rt, rAt, rBt) = _applyRate(config, state.R, rAt, rBt);
        (state.R, rAs, rBs) = _applyRate(config, state.R, rAs, rBs);

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

    function _supply(address TOKEN, uint side) internal view returns (uint s) {
        return IERC1155Supply(TOKEN).totalSupply(_packID(address(this), side));
    }

    function _applyRate(
        Config memory config,
        uint R,
        uint rA,
        uint rB
    ) internal view returns (uint, uint, uint) {
        uint32 elapsed = uint32(block.timestamp) - s_i;
        if (elapsed > 0) {
            uint feeRateX64 = _expRate(elapsed, config.INTEREST_HL);
            uint rAF = FullMath.mulDivRoundingUp(rA, Q64, feeRateX64);
            uint rBF = FullMath.mulDivRoundingUp(rB, Q64, feeRateX64);
            uint interest = rA + rB - rAF - rBF;
            if (FEE_RATE > 0) {
                interest /= FEE_RATE;
            }
            if (interest > 0) {
                if (FEE_RATE > 0) {
                    R -= interest;
                }
                (rA, rB) = (rAF, rBF);
            }
        }
        elapsed = uint32(block.timestamp & F_MASK) - (s_f & F_MASK);
        if (elapsed > 0) {
            uint rate = _expRate(elapsed, config.PREMIUM_HL);
            if (rate > Q64) {
                uint premium = rA > rB ? rA - rB : rB - rA;
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
        return (R, rA, rB);
    }
}

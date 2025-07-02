// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.28;

import "../PoolLogic.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

interface IUniPool {
    function token0() external view returns (address);
    function token1() external view returns (address);
}

contract View is PoolLogic {
    struct StateView {
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

    struct TokenMetadata {
        address token;
        string symbol;
        uint decimals;
    }

    struct Metadata {
        Config config;
        TokenMetadata reserve;
        TokenMetadata base;
        TokenMetadata quote;
    }

    constructor(
        address token,
        address feeTo,
        uint256 feeRate
    ) PoolLogic(token, feeTo, feeRate) {}

    function metadata() external view returns (Metadata memory meta) {
        Config memory config = loadConfig();
        uint256 ORACLE = uint256(config.ORACLE);
        address pool = address(uint160(ORACLE));
        address token0 = IUniPool(pool).token0();
        address token1 = IUniPool(pool).token1();
        uint256 QTI = ORACLE & Q255;
        if (QTI == 0) {
            meta.base.token = token1;
            meta.quote.token = token0;
        } else {
            meta.base.token = token0;
            meta.quote.token = token1;
        }
        meta.base.symbol = IERC20Metadata(meta.base.token).symbol();
        meta.base.decimals = IERC20Metadata(meta.base.token).decimals();
        meta.quote.symbol = IERC20Metadata(meta.quote.token).symbol();
        meta.quote.decimals = IERC20Metadata(meta.quote.token).decimals();
        meta.reserve.token = config.TOKEN_R;
        meta.reserve.symbol = IERC20Metadata(meta.reserve.token).symbol();
        meta.reserve.decimals = IERC20Metadata(meta.reserve.token).decimals();
        meta.config = config;
        return meta;
    }

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
        (uint Rt, uint256 rAt, uint256 rBt) = _evaluateWithRate(_xk(config, twap), State(state.R, state.a, state.b), FEE_RATE, config);
        (uint Rs, uint256 rAs, uint256 rBs) = _evaluateWithRate(_xk(config, spot), state, FEE_RATE, config);

        stateView.rA = Math.min(rAt, rAs);
        stateView.rB = Math.min(rBt, rBs);
        stateView.rC = Math.max(Rt - rAt - rBt, Rs - rAs - rBs);

        state.R = Math.min(Rt, Rs);

        stateView.sA = _supply(TOKEN, SIDE_A);
        stateView.sB = _supply(TOKEN, SIDE_B);
        stateView.sC = _supply(TOKEN, SIDE_C);
        stateView.twap = twap;
        stateView.spot = spot;
        stateView.state = state;
    }

    function _evaluateWithRate(
        uint256 xk,
        State memory state,
        uint256 FEE_RATE,
        Config memory config
    ) internal view returns (uint256, uint256, uint256) {
        (uint256 rA, uint256 rB) = _evaluate(xk, state);
        // track the rC before interest and premium for fee calculation
        uint256 rC = state.R - rA - rB;
        // [INTEREST]
        if (config.INTEREST_HL > 0) {
            uint256 elapsed = uint32(block.timestamp) - s_lastInterestTime;
            if (elapsed > 0) {
                uint256 rate = _decayRate(elapsed, config.INTEREST_HL);
                state.a = FullMath.mulDivRoundingUp(state.a, rate, Q64);
                state.b = FullMath.mulDivRoundingUp(state.b, rate, Q64);
                (uint256 rAF, uint256 rBF) = _evaluate(xk, state);
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
                uint256 elapsed = uint32(block.timestamp) - (s_lastPremiumTime);
                if (elapsed > 0) {
                    uint256 premiumHL = FullMath.mulDivRoundingUp(config.PREMIUM_HL >> 1, state.R, rA + rB);
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
            uint256 fee = (state.R - rA - rB - rC) / FEE_RATE;
            if (fee > 0) {
                state.R -= fee;
            }
        }
        return (state.R, rA, rB);
    }

    function _supply(
        address TOKEN,
        uint256 side
    ) internal view returns (uint256 s) {
        return IERC1155Supply(TOKEN).totalSupply(_packID(address(this), side));
    }
}

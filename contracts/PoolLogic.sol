// SPDX-License-Identifier: BSL-1.1
pragma solidity 0.8.20;

import "abdk-libraries-solidity/ABDKMath64x64.sol";
import "./interfaces/IHelper.sol";
import "./interfaces/IFetcher.sol";
import "./Fetcher.sol";
import "./PoolBase.sol";

/// @title Mathematic and finance logic of Derivable pool.
/// @author Derivable Labs
/// @notice Defines the state transistion calculation. The main logic is
///         implemented in _swap function which defines a single direction state
///         transistion (1 side in and 1 side out).
///         A Helper contract is used for target (after) state calculation.
///         This contract call is trustless, and provided by user.
contract PoolLogic is PoolBase, Fetcher {
    address immutable internal FEE_TO;
    uint256 immutable internal FEE_RATE;

    /// @param token ERC-1155 Token for pool derivatives
    /// @param feeTo fee recipient address
    /// @param feeRate fee rate
    constructor(
        address token,
        address feeTo,
        uint256 feeRate
    ) PoolBase(token) {
        require(feeTo != address(0), "PoolLogic: ZERO_ADDRESS");
        FEE_TO = feeTo;
        FEE_RATE = feeRate;
    }

    function _swap(
        Config memory config,
        Param memory param
    ) internal override returns(Result memory result) {
        uint256 sideIn = param.sideIn;
        uint256 sideOut = param.sideOut;
        require(sideIn != sideOut, 'PoolLogic: SAME_SIDE');
        require(
            sideIn == SIDE_R ||
            sideIn == SIDE_A ||
            sideIn == SIDE_B ||
            sideIn == SIDE_C,
            'PoolLogic: INVALID_SIDE_IN'
        );
        require(
            sideOut == SIDE_R ||
            sideOut == SIDE_A ||
            sideOut == SIDE_B ||
            sideOut == SIDE_C,
            'PoolLogic: INVALID_SIDE_OUT'
        );
        State memory state = State(_reserve(config.TOKEN_R), s_a, s_b);
        // [PRICE SELECTION]
        uint256 xk; uint256 rA; uint256 rB;
        (xk, rA, rB, result.price) = _selectPrice(config, state, sideIn, sideOut);
        unchecked {
            // track the rC before interest and premium for fee calculation
            uint256 rC = state.R - rA - rB;
            // [INTEREST]
            uint32 elapsed = uint32(block.timestamp) - s_lastInterestTime;
            if (elapsed > 0) {
                uint256 rate = _decayRate(elapsed, config.INTEREST_HL);
                if (rate < Q64) {
                    uint256 rAF = FullMath.mulDivRoundingUp(rA, rate, Q64);
                    uint256 rBF = FullMath.mulDivRoundingUp(rB, rate, Q64);
                    if (rA + rB > rAF + rBF) {
                        (rA, rB) = (rAF, rBF);
                        s_lastInterestTime = uint32(block.timestamp);
                    }
                }
            }
            // [PREMIUM]
            elapsed = uint32(block.timestamp & F_MASK) - (s_lastPremiumTime & F_MASK);
            if (elapsed > 0) {
                uint256 rate = _decayRate(elapsed, config.PREMIUM_HL);
                if (rate < Q64) {
                    uint256 premium = rA > rB
                        ? FullMath.mulDiv(rA - rB, rA, state.R)
                        : FullMath.mulDiv(rB - rA, rB, state.R);
                    premium -= FullMath.mulDivRoundingUp(premium, rate, Q64);
                    if (premium > 0) {
                        if (rA > rB) {
                            rB += FullMath.mulDivRoundingUp(premium, rB, state.R - rA);
                            rA -= premium;
                        } else {
                            rA += FullMath.mulDivRoundingUp(premium, rA, state.R - rB);
                            rB -= premium;
                        }
                        s_lastPremiumTime += elapsed;
                    }
                }
            }
            // [FEE]
            if (FEE_RATE > 0) {
                // rA and rB cannot be increased by interest and premium
                uint256 fee = (state.R - rA - rB - rC) / FEE_RATE;
                if (fee > 0) {
                    TransferHelper.safeTransfer(config.TOKEN_R, FEE_TO, fee);
                    state.R -= fee;
                }
            }
        }
        // [SANITIZATION]
        unchecked {
            uint256 rAB = rA + rB;
            uint256 half = rAB >> 1;
            if (half < MINIMUM_RESERVE) {
                rA = half;
                rB = rAB - rA;
            } else if (rA < MINIMUM_RESERVE) {
                rA = MINIMUM_RESERVE;
                rB = rAB - rA;
            } else if (rB < MINIMUM_RESERVE) {
                rB = MINIMUM_RESERVE;
                rA = rAB - rB;
            }
        }
        // [CALCULATION]
        State memory state1 = IHelper(param.helper).swapToState(
            Slippable(xk, state.R, rA, rB),
            param.payload
        );
        require(state1.a <= type(uint224).max, "PoolLogic: STATE1_OVERFLOW_A");
        require(state1.b <= type(uint224).max, "PoolLogic: STATE1_OVERFLOW_B");
        // [TRANSITION]
        (uint256 rA1, uint256 rB1) = _evaluate(xk, state1);
        if (sideIn == SIDE_R) {
            require(rA1 >= rA && rB1 >= rB, "PoolLogic: INVALID_STATE1_R");
            result.amountIn = state1.R - state.R;
        } else {
            require(state.R >= state1.R, "PoolLogic: INVALID_STATE1_NR");
            uint256 s = _supply(sideIn);
            if (sideIn == SIDE_A) {
                require(rB1 >= rB, "PoolLogic: INVALID_STATE1_A");
                result.amountIn = FullMath.mulDivRoundingUp(s, rA - rA1, rA);
            } else {
                require(rA1 >= rA, "PoolLogic: INVALID_STATE1_NA");
                if (sideIn == SIDE_B) {
                    result.amountIn = FullMath.mulDivRoundingUp(s, rB - rB1, rB);
                } else {
                    require(rB1 >= rB, "PoolLogic: INVALID_STATE1_NB");
                    uint256 rC = state.R - rA - rB;
                    uint256 rC1 = state1.R - rA1 - rB1;
                    result.amountIn = FullMath.mulDivRoundingUp(s, rC - rC1, rC);
                }
            }
            unchecked {
                // rX >= rX - rX1, so s >= amountIn
                require(MINIMUM_SUPPLY <= s - result.amountIn, 'PoolLogic: MINIMUM_SUPPLY');
            }
        }
        if (sideOut == SIDE_R) {
            result.amountOut = state.R - state1.R;
        } else {
            if (sideOut == SIDE_C) {
                uint256 rC = state.R - rA - rB;
                uint256 rC1 = state1.R - rA1 - rB1;
                require(rC1 >= MINIMUM_RESERVE, 'PoolLogic: MINIMUM_RESERVE_C');
                result.amountOut = FullMath.mulDiv(_supply(sideOut), rC1 - rC, rC);
            } else {
                if (sideOut == SIDE_A) {
                    require(rA1 >= MINIMUM_RESERVE, 'PoolLogic: MINIMUM_RESERVE_A');
                    result.amountOut = FullMath.mulDiv(_supply(sideOut), rA1 - rA, rA);
                } else {
                    require(rB1 >= MINIMUM_RESERVE, 'PoolLogic: MINIMUM_RESERVE_B');
                    result.amountOut = FullMath.mulDiv(_supply(sideOut), rB1 - rB, rB);
                }
                if (config.OPEN_RATE != Q128) {
                    result.amountIn = FullMath.mulDiv(result.amountIn, Q128, config.OPEN_RATE);
                }
            }
        }
        s_a = uint224(state1.a);
        s_b = uint224(state1.b);
    }

    function _selectPrice(
        Config memory config,
        State memory state,
        uint256 sideIn,
        uint256 sideOut
    ) internal returns (uint256 xk, uint256 rA, uint256 rB, uint256 price) {
        (uint256 min, uint256 max) = _fetch(config.FETCHER, uint256(config.ORACLE));
        if (min > max) {
            (min, max) = (max, min);
        }
        if (sideOut == SIDE_A || sideIn == SIDE_B) {
            xk = _xk(config, price = max);
            (rA, rB) = _evaluate(xk, state);
        } else if (sideOut == SIDE_B || sideIn == SIDE_A) {
            xk = _xk(config, price = min);
            (rA, rB) = _evaluate(xk, state);
        } else {
            xk = _xk(config, price = min);
            (rA, rB) = _evaluate(xk, state);
            if ((sideIn == SIDE_R) == rB > rA) {
                xk = _xk(config, price = max);
                (rA, rB) = _evaluate(xk, state);
            }
        }
    }

    function _fetch(address fetcher, uint256 ORACLE) internal returns (uint256 twap, uint256 spot) {
        if (fetcher == address(0)) {
            return fetch(ORACLE);
        } else {
            return IFetcher(fetcher).fetch(ORACLE);
        }
    }

    function _maturityPayoff(
        Config memory config, uint256 maturity, uint256 amountOut
    ) internal view override returns (uint256) {
        unchecked {
            if (maturity <= block.timestamp) {
                return amountOut;
            }
            uint256 remain = maturity - block.timestamp;
            if (config.MATURITY <= remain) {
                return 0;
            }
            uint256 elapsed = config.MATURITY - remain;
            if (elapsed < config.MATURITY_VEST) {
                amountOut = amountOut * elapsed / config.MATURITY_VEST;
            }
            return FullMath.mulDiv(amountOut, config.MATURITY_RATE, Q128);
        }
    }

    function _supply(uint256 side) internal view returns (uint256 s) {
        return IERC1155Supply(TOKEN).totalSupply(_packID(address(this), side));
    }

    function _reserve(address TOKEN_R) internal view returns (uint256 R) {
        return IERC20(TOKEN_R).balanceOf(address(this));
    }

    function _decayRate (
        uint256 elapsed,
        uint256 halfLife
    ) internal pure returns (uint256 rateX64) {
        if (halfLife == 0) {
            return Q64;
        }
        int128 rate = ABDKMath64x64.exp_2(-int128(int((elapsed << 64) / halfLife)));
        return uint256(int(rate));
    }

    function _xk(Config memory config, uint256 price) internal pure returns (uint256 xk) {
        xk = _powu(FullMath.mulDiv(Q128, price, config.MARK), config.K);
    }

    function _powu(uint256 x, uint256 y) internal pure returns (uint256 z) {
        // Calculate the first iteration of the loop in advance.
        z = y & 1 > 0 ? x : Q128;
        // Equivalent to "for(y /= 2; y > 0; y /= 2)" but faster.
        for (y >>= 1; y > 0; y >>= 1) {
            x = FullMath.mulDiv(x, x, Q128);
            // Equivalent to "y % 2 == 1" but faster.
            if (y & 1 > 0) {
                z = FullMath.mulDiv(z, x, Q128);
            }
        }
    }

    function _evaluate(uint256 xk, State memory state) internal pure returns (uint256 rA, uint256 rB) {
        rA = _r(xk, state.a, state.R);
        rB = _r(Q256M/xk, state.b, state.R);
    }

    function _r(uint256 xk, uint256 v, uint256 R) internal pure returns (uint256 r) {
        r = FullMath.mulDiv(v, xk, Q128);
        if (r > R >> 1) {
            uint256 denominator = FullMath.mulDiv(v, xk << 2, Q128);
            uint256 minuend = FullMath.mulDiv(R, R, denominator);
            r = R - minuend;
        }
    }
}

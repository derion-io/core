// SPDX-License-Identifier: BSL-1.1
pragma solidity ^0.8.0;

import "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";

import "../Pool.sol";
import "../libs/OracleLibrary.sol";
import "../interfaces/IHelper.sol";
import "../libs/abdk-consulting/abdk-libraries-solidity/ABDKMath64x64.sol";


contract AsymptoticPerpetual is Pool {
    function _powu(uint x, uint y) internal pure returns (uint z) {
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
        // require(z <= type(uint).max, "Pool: upper overflow");
    }

    function _fetch() internal view returns (uint twap, uint spot) {
        address pool = address(uint160(uint(ORACLE)));
        (uint160 sqrtSpotX96,,,,,,) = IUniswapV3Pool(pool).slot0();

        (int24 arithmeticMeanTick,) = OracleLibrary.consult(pool, uint32(uint(ORACLE) >> 192));
        uint sqrtTwapX96 = TickMath.getSqrtRatioAtTick(arithmeticMeanTick);

        spot = sqrtSpotX96 << 32;
        twap = sqrtTwapX96 << 32;

        if (uint(ORACLE) & Q255 == 0) {
            spot = Q256M / spot;
            twap = Q256M / twap;
        }
    }

    // r(v)
    function _r(uint xk, uint v, uint R) internal pure returns (uint r) {
        r = FullMath.mulDiv(v, xk, Q128);
        if (r > R >> 1) {
            uint denominator = FullMath.mulDiv(v, xk << 2, Q128);
            uint minuend = FullMath.mulDiv(R, R, denominator);
            r = R - minuend;
        }
    }

    function _supply(address TOKEN, uint side) internal view returns (uint s) {
        return IERC1155Supply(TOKEN).totalSupply(_packID(address(this), side));
    }

    function _reserve() internal view returns (uint R) {
        return IERC20(TOKEN_R).balanceOf(address(this));
    }

    function _evaluate(uint xk, State memory state) internal pure returns (uint rA, uint rB) {
        rA = _r(xk, state.a, state.R);
        rB = _r(Q256M/xk, state.b, state.R);
    }

    function _maturityPayoff(uint maturity, uint amountOut) internal view override returns (uint) {
        unchecked {
            if (maturity <= block.timestamp) {
                return amountOut;
            }
            uint remain = maturity - block.timestamp;
            if (MATURITY <= remain) {
                return 0;
            }
            uint elapsed = MATURITY - remain;
            if (elapsed < MATURITY_VEST) {
                amountOut = amountOut * elapsed / MATURITY_VEST;
            }
            return FullMath.mulDiv(amountOut, MATURITY_RATE, Q128);
        }
    }

    function _decayRate (
        uint elapsed,
        uint halfLife
    ) internal pure returns (uint rateX64) {
        if (halfLife == 0) {
            return Q64;
        }
        int128 rate = ABDKMath64x64.exp_2(int128(int((elapsed << 64) / halfLife)));
        return uint(int(rate));
    }

    function _xk(uint price) internal view returns (uint xk) {
        xk = _powu(FullMath.mulDiv(Q128, price, MARK), K);
    }

    function _selectPrice(
        State memory state,
        uint sideIn,
        uint sideOut
    ) internal view returns (uint xk, uint rA, uint rB) {
        (uint min, uint max) = _fetch();
        if (min > max) {
            (min, max) = (max, min);
        }
        if (sideOut == SIDE_A || sideIn == SIDE_B) {
            xk = _xk(max);
            (rA, rB) = _evaluate(xk, state);
        } else if (sideOut == SIDE_B || sideIn == SIDE_A) {
            xk = _xk(min);
            (rA, rB) = _evaluate(xk, state);
        } else {
            // TODO: assisting flag for min/max
            xk = _xk(min);
            (rA, rB) = _evaluate(xk, state);
            if ((sideIn == SIDE_R) == rB > rA) {
                // TODO: unit test for this case
                xk = _xk(max);
                (rA, rB) = _evaluate(xk, state);
            }
        }
    }

    function _swap(
        uint sideIn,
        uint sideOut,
        SwapParam memory param
    ) internal override returns(uint amountIn, uint amountOut) {
        require(sideIn != sideOut, 'SS');
        State memory state = State(_reserve(), s_a, s_b);
        // [INTEREST DECAY]
        {
            uint decayRateX64 = _decayRate(block.timestamp - s_i, HALF_LIFE);
            // TODO: transaction frequency effect
            uint a = FullMath.mulDivRoundingUp(state.a, Q64, decayRateX64);
            uint b = FullMath.mulDivRoundingUp(state.b, Q64, decayRateX64);
            if (a < state.a || b < state.b) {
                state.a = a;
                state.b = b;
                s_i = uint32(block.timestamp);
            }
        }
        // [PRICE SELECTION]
        (uint xk, uint rA, uint rB) = _selectPrice(state, sideIn, sideOut);
        // [PROTOCOL FEE]
        {
            uint feeRateX64 = _decayRate(block.timestamp - s_f, HL_FEE);
            uint rAF = FullMath.mulDivRoundingUp(rA, Q64, feeRateX64);
            uint rBF = FullMath.mulDivRoundingUp(rB, Q64, feeRateX64);
            if (rAF < rA || rBF < rB) {
                uint fee = rA - rAF + rB - rBF;
                TransferHelper.safeTransfer(TOKEN_R, FEE_TO, fee);
                (rA, rB) = (rAF, rBF);
                state.R -= fee;
                s_f = uint32(block.timestamp);
            }
        }
        // [CALCULATION]
        State memory state1 = IHelper(param.helper).swapToState(
            Slippable(xk, state.R, rA, rB),
            param.payload
        );
        // [TRANSITION]
        (uint rA1, uint rB1) = _evaluate(xk, state1);
        if (sideIn == SIDE_R) {
            require(rA1 >= rA && rB1 >= rB, "MI:R");
            amountIn = state1.R - state.R;
        } else {
            require(state.R >= state1.R, "MI:NR");
            uint s = _supply(TOKEN, sideIn);
            if (sideIn == SIDE_A) {
                require(rB1 >= rB, "MI:A");
                amountIn = FullMath.mulDivRoundingUp(s, rA - rA1, rA);
            } else {
                require(rA1 >= rA, "MI:NA");
                if (sideIn == SIDE_B) {
                    amountIn = FullMath.mulDivRoundingUp(s, rB - rB1, rB);
                } else if (sideIn == SIDE_C) {
                    require(rB1 >= rB, "MI:NB");
                    uint rC = state.R - rA - rB;
                    uint rC1 = state1.R - rA1 - rB1;
                    amountIn = FullMath.mulDivRoundingUp(s, rC - rC1, rC);
                }
            }
        }
        if (sideOut == SIDE_R) {
            amountOut = state.R - state1.R;
        } else {
            uint s = _supply(TOKEN, sideOut);
            if (sideOut == SIDE_C) {
                uint rC = state.R - rA - rB;
                uint rC1 = state1.R - rA1 - rB1;
                amountOut = FullMath.mulDiv(s, rC1 - rC, rC);
            } else {
                amountOut = PREMIUM_RATE;
                if (sideOut == SIDE_A) {
                    sideOut = OPEN_RATE;
                    if (amountOut > 0 && rA1 > rB1) {
                        uint rC1 = state1.R - rA1 - rB1;
                        uint imbaRate = FullMath.mulDiv(Q128, rA1 - rB1, rC1);
                        if (imbaRate > amountOut) {
                            sideOut = FullMath.mulDiv(sideOut, amountOut, imbaRate);
                        }
                    }
                    if (param.zeroInterestTime > 0) {
                        amountOut = _decayRate(param.zeroInterestTime, HALF_LIFE);
                        sideOut = FullMath.mulDiv(sideOut, amountOut, Q64);
                    }
                    if (sideOut != Q128) {
                        amountIn = FullMath.mulDiv(amountIn, Q128, sideOut);
                    }
                    amountOut = FullMath.mulDiv(s, rA1 - rA, rA);
                } else if (sideOut == SIDE_B) {
                    sideOut = OPEN_RATE;
                    if (amountOut > 0 && rB1 > rA1) {
                        uint rC1 = state1.R - rA1 - rB1;
                        uint imbaRate = FullMath.mulDiv(Q128, rB1 - rA1, rC1);
                        if (imbaRate > amountOut) {
                            sideOut = FullMath.mulDiv(sideOut, amountOut, imbaRate);
                        }
                    }
                    if (param.zeroInterestTime > 0) {
                        amountOut = _decayRate(param.zeroInterestTime, HALF_LIFE);
                        sideOut = FullMath.mulDiv(sideOut, amountOut, Q64);
                    }
                    if (sideOut != Q128) {
                        amountIn = FullMath.mulDiv(amountIn, Q128, sideOut);
                    }
                    amountOut = FullMath.mulDiv(s, rB1 - rB, rB);
                }
            }
        }
        require(state1.a <= type(uint224).max, "OA");
        s_a = uint224(state1.a);
        require(state1.b <= type(uint224).max, "OB");
        s_b = uint224(state1.b);
    }
}

// SPDX-License-Identifier: BSL-1.1
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@derivable/oracle/contracts/@uniswap/lib/contracts/libraries/FixedPoint.sol";
import "@derivable/oracle/contracts/Math.sol";
import "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";

import "../libraries/OracleLibrary.sol";
import "./Constants.sol";
import "./Storage.sol";
import "../interfaces/IERC1155Supply.sol";
import "../interfaces/IAsymptoticPerpetual.sol";
import "../libraries/ABDKMath64x64.sol";


contract AsymptoticPerpetual is Storage, Constants, IAsymptoticPerpetual {
    function init(
        Config memory config,
        uint a,
        uint b
    ) external override returns (uint rA, uint rB, uint rC) {
        require(s_a == 0, "ALREADY_INITIALIZED");
        (uint224 twap, ) = _fetch(config.ORACLE);
        uint decayRateX64 = _decayRate(block.timestamp - config.TIMESTAMP, config.HALF_LIFE);
        State memory state = State(_reserve(config.TOKEN_R), a, b);
        Market memory market = _market(config.K, config.MARK, decayRateX64, twap);
        (rA, rB) = _evaluate(market, state);
        rC = state.R - rA - rB;
        // uint R = IERC20(TOKEN_R).balanceOf(address(this));
        // require(4 * a * b <= R, "INVALID_PARAM");
        s_a = a;
        s_b = b;
    }

    function _powu(uint x, uint y) internal pure returns (uint z) {
        // Calculate the first iteration of the loop in advance.
        z = y & 1 > 0 ? x : FixedPoint.Q112;
        // Equivalent to "for(y /= 2; y > 0; y /= 2)" but faster.
        for (y >>= 1; y > 0; y >>= 1) {
            x = FullMath.mulDiv(x, x, FixedPoint.Q112);
            // Equivalent to "y % 2 == 1" but faster.
            if (y & 1 > 0) {
                z = FullMath.mulDiv(z, x, FixedPoint.Q112);
            }
        }
        require(z <= type(uint224).max, "Pool: upper overflow");
    }

    function _packID(address pool, uint side) internal pure returns (uint id) {
        id = (side << 160) + uint160(pool);
    }

    function _fetch(
        bytes32 ORACLE // 1bit QTI, 31bit reserve, 32bit WINDOW, ... PAIR ADDRESS
    ) internal view returns (uint224 twap, uint224 spot) {
        address pool = address(uint160(uint(ORACLE)));
        (uint160 sqrtSpotX96,,,,,,) = IUniswapV3Pool(pool).slot0();

        (int24 arithmeticMeanTick,) = OracleLibrary.consult(pool, uint32(uint(ORACLE) >> 192));
        uint160 sqrtTwapX96 = TickMath.getSqrtRatioAtTick(arithmeticMeanTick);

        spot = uint224(sqrtSpotX96) << 16;
        twap = uint224(sqrtTwapX96) << 16;

        if (uint(ORACLE) & Q255 > 0) {
            spot = uint224(FixedPoint.Q224 / spot);
            twap = uint224(FixedPoint.Q224 / twap);
        }
    }

    // r(v)
    function _r(uint xk, uint v, uint R) internal pure returns (uint r) {
        r = FullMath.mulDiv(v, xk, FixedPoint.Q112);
        if (r > R >> 1) {
            uint denominator = FullMath.mulDiv(v, xk << 2, FixedPoint.Q112);
            uint minuend = FullMath.mulDiv(R, R, denominator);
            r = R - minuend;
        }
    }

    // v(r)
    function _v(uint xk, uint r, uint R) internal pure returns (uint v) {
        if (r <= R / 2) {
            return FullMath.mulDiv(r, FixedPoint.Q112, xk);
        }
        uint denominator = FullMath.mulDiv(R - r, xk << 2, FixedPoint.Q112);
        return FullMath.mulDiv(R, R, denominator);
    }

    function _supply(address TOKEN, uint side) internal view returns (uint s) {
        return IERC1155Supply(TOKEN).totalSupply(_packID(address(this), side));
    }

    function _reserve(address TOKEN_R) internal view returns (uint R) {
        return IERC20(TOKEN_R).balanceOf(address(this));
    }

    function _evaluate(Market memory market, State memory state) internal pure returns (uint rA, uint rB) {
        rA = _r(market.xkA, state.a, state.R);
        rB = _r(market.xkB, state.b, state.R);
    }

    function _market(
        uint K,
        uint MARK,
        uint decayRateX64,
        uint224 price
    ) internal pure returns (Market memory market) {
        market.xkA = _powu(FixedPoint.fraction(price, MARK)._x, K);
        market.xkB = uint224(FullMath.mulDiv(FixedPoint.Q224/market.xkA, Q64, decayRateX64));
        market.xkA = uint224(FullMath.mulDiv(market.xkA, Q64, decayRateX64));
    }

    function _decayRate (
        uint elapsed,
        uint HALF_LIFE
    ) internal pure returns (uint rateX64) {
        if (HALF_LIFE == 0) {
            return Q64;
        }
        int128 rate = ABDKMath64x64.exp_2(int128(int((elapsed << 64) / HALF_LIFE)));
        return uint(int(rate));
    } 

    function _selectPrice(
        Config memory config,
        State memory state,
        uint sideIn,
        uint sideOut
    ) internal view returns (Market memory market, uint rA, uint rB) {
        uint decayRateX64 = _decayRate(block.timestamp - config.TIMESTAMP, config.HALF_LIFE);
        (uint224 min, uint224 max) = _fetch(config.ORACLE);
        if (min > max) {
            (min, max) = (max, min);
        }
        if (sideOut == SIDE_A || sideIn == SIDE_B) {
            market = _market(config.K, config.MARK, decayRateX64, max);
            (rA, rB) = _evaluate(market, state);
        } else if (sideOut == SIDE_B || sideIn == SIDE_A) {
            market = _market(config.K, config.MARK, decayRateX64, min);
            (rA, rB) = _evaluate(market, state);
        } else {
            // TODO: assisting flag for min/max
            market = _market(config.K, config.MARK, decayRateX64, min);
            (rA, rB) = _evaluate(market, state);
            if ((sideIn == SIDE_R) == rB > rA) {
                // TODO: unit test for this case
                market = _market(config.K, config.MARK, decayRateX64, max);
                (rA, rB) = _evaluate(market, state);
            }
        }
    }

    function exactIn(
        Config memory config,
        uint sideIn,
        uint amountInDesired,
        uint sideOut
    ) external override returns(uint amountIn, uint amountOut) {
        // [PREPARATION]
        require(sideIn != sideOut, 'SAME_SIDE');
        State memory state = State(_reserve(config.TOKEN_R), s_a, s_b);
        (Market memory market, uint rA, uint rB) = _selectPrice(config, state, sideIn, sideOut);
        uint rC = state.R - rA - rB;
        uint s; // use for sIn then sOut
        // [CALCULATION]
        // TODO: move this part to Helper
        State memory state1 = State(state.R, state.a, state.b);
        if (sideIn == SIDE_R) {
            state1.R += amountInDesired;
            if (sideOut == SIDE_A) {
                state1.a = _v(market.xkA, rA + amountInDesired, state1.R);
            } else if (sideOut == SIDE_B) {
                state1.b = _v(market.xkB, rB + amountInDesired, state1.R);
            }
        } else {
            s = _supply(config.TOKEN, sideIn);
            if (sideIn == SIDE_A) {
                uint rOut = FullMath.mulDiv(rA, amountInDesired, s);
                if (sideOut == SIDE_R) {
                    state1.R -= rOut;
                }
                state1.a = _v(market.xkA, rA - rOut, state1.R);
            } else if (sideIn == SIDE_B) {
                uint rOut = FullMath.mulDiv(rB, amountInDesired, s);
                if (sideOut == SIDE_R) {
                    state1.R -= rOut;
                }
                state1.b = _v(market.xkB, rB - rOut, state1.R);
            } else /*if (sideIn == SIDE_C)*/ {
                if (sideOut == SIDE_R) {
                    uint rOut = FullMath.mulDiv(rC, amountInDesired, s);
                    state1.R -= rOut;
                }
                // state1.c
            }
        }
        // [TRANSITION]
        (uint rA1, uint rB1) = _evaluate(market, state1);
        if (sideIn == SIDE_R) {
            amountIn = state1.R - state.R;
        } else {
            // s = _supply(config.TOKEN, sideIn);
            if (sideIn == SIDE_A) {
                amountIn = FullMath.mulDiv(rA - rA1, s, rA);
                s_a = state1.a;
            } else if (sideIn == SIDE_B) {
                amountIn = FullMath.mulDiv(rB - rB1, s, rB);
                s_b = state1.b;
            } else if (sideIn == SIDE_C) {
                uint rC1 = state1.R - rA1 - rB1;
                amountIn = FullMath.mulDiv(rC - rC1, s, rC);
            }
        }
        if (sideOut == SIDE_R) {
            amountOut = state.R - state1.R;
        } else {
            s = _supply(config.TOKEN, sideOut);
            if (sideOut == SIDE_A) {
                amountOut = FullMath.mulDiv(rA1 - rA, s, rA);
                s_a = state1.a;
            } else if (sideOut == SIDE_B) {
                amountOut = FullMath.mulDiv(rB1 - rB, s, rB);
                s_b = state1.b;
            } else if (sideOut == SIDE_C) {
                uint rC1 = state1.R - rA1 - rB1;
                amountOut = FullMath.mulDiv(rC1 - rC, s, rC);
            }
        }
    }
}

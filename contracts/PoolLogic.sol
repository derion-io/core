// SPDX-License-Identifier: BSL-1.1
pragma solidity ^0.8.0;

import "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";

import "./PoolBase.sol";
import "./libs/abdk-consulting/abdk-libraries-solidity/ABDKMath64x64.sol";
import "./libs/OracleLibrary.sol";
import "./interfaces/IHelper.sol";

contract PoolLogic is PoolBase {
    address immutable internal FEE_TO;
    uint immutable internal FEE_RATE;

    constructor(
        address token,
        address feeTo,
        uint feeRate
    ) PoolBase(token) {
        FEE_TO = feeTo;
        FEE_RATE = feeRate;
    }

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

    function _fetch(uint ORACLE) internal view returns (uint twap, uint spot) {
        address pool = address(uint160(ORACLE));
        (uint160 sqrtSpotX96,,,,,,) = IUniswapV3Pool(pool).slot0();

        (int24 arithmeticMeanTick,) = OracleLibrary.consult(pool, uint32(ORACLE >> 192));
        uint sqrtTwapX96 = TickMath.getSqrtRatioAtTick(arithmeticMeanTick);

        spot = sqrtSpotX96 << 32;
        twap = sqrtTwapX96 << 32;

        if (ORACLE & Q255 == 0) {
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

    function _supply(uint side) internal view returns (uint s) {
        return IERC1155Supply(TOKEN).totalSupply(_packID(address(this), side));
    }

    function _reserve(address TOKEN_R) internal view returns (uint R) {
        return IERC20(TOKEN_R).balanceOf(address(this));
    }

    function _evaluate(uint xk, State memory state) internal pure returns (uint rA, uint rB) {
        rA = _r(xk, state.a, state.R);
        rB = _r(Q256M/xk, state.b, state.R);
    }

    function _maturityPayoff(Config memory config, uint maturity, uint amountOut) internal view override returns (uint) {
        unchecked {
            if (maturity <= block.timestamp) {
                return amountOut;
            }
            uint remain = maturity - block.timestamp;
            if (config.MATURITY <= remain) {
                return 0;
            }
            uint elapsed = config.MATURITY - remain;
            if (elapsed < config.MATURITY_VEST) {
                amountOut = amountOut * elapsed / config.MATURITY_VEST;
            }
            return FullMath.mulDiv(amountOut, config.MATURITY_RATE, Q128);
        }
    }

    function _expRate (
        uint elapsed,
        uint halfLife
    ) internal pure returns (uint rateX64) {
        if (halfLife == 0) {
            return Q64;
        }
        int128 rate = ABDKMath64x64.exp_2(int128(int((elapsed << 64) / halfLife)));
        return uint(int(rate));
    }

    function _xk(Config memory config, uint price) internal pure returns (uint xk) {
        xk = _powu(FullMath.mulDiv(Q128, price, config.MARK), config.K);
    }

    function _selectPrice(
        Config memory config,
        State memory state,
        uint sideIn,
        uint sideOut
    ) internal returns (uint xk, uint rA, uint rB, uint price) {
        (uint min, uint max) = _fetch(uint(config.ORACLE));
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
            xk = _xk(config, min);
            (rA, rB) = _evaluate(xk, state);
            uint rCMin = state.R - rA - rB;
            uint xkMax = _xk(config, max);
            (uint rAMax, uint rBMax) = _evaluate(xkMax, state);
            uint rCMax = state.R - rAMax - rBMax;
            if ((sideIn == SIDE_C) == rCMax < rCMin) {
                xk = xkMax;
                rA = rAMax;
                rB = rBMax;
                price = max;
            } else {
                price = min;
            }
            if (rCLast > 0) {
                rCMin = rCLastIn ? rCMax : rCMin;
                if (rCMin > rCLast) {
                    rCMin = FullMath.mulDiv(rCMin - rCLast, FEE_RATE, Q128);
                    if (rCMin > 0) {
                        TransferHelper.safeTransfer(config.TOKEN_R, FEE_TO, rCMin);
                        state.R -= rCMin; // TODO: UT for this line
                    }
                }
            }
        }
    }

    function _swap(
        Config memory config,
        Param memory param
    ) internal override returns(Result memory result) {
        uint sideIn = param.sideIn;
        uint sideOut = param.sideOut;
        require(sideIn != sideOut, 'SS');
        State memory state = State(_reserve(config.TOKEN_R), s_a, s_b);
        // [INTEREST DECAY]
        unchecked {
            uint elapsed = block.timestamp - s_i;
            if (elapsed > 0) {
                uint interestRateX64 = _expRate(elapsed, config.INTEREST_HL);
                if (interestRateX64 > Q64) {
                    uint a = FullMath.mulDivRoundingUp(state.a, Q64, interestRateX64);
                    uint b = FullMath.mulDivRoundingUp(state.b, Q64, interestRateX64);
                    if (a < state.a || b < state.b) {
                        state.a = a;
                        state.b = b;
                        s_i = uint32(block.timestamp);
                    }
                }
            }
        }
        // [PRICE SELECTION]
        uint xk; uint rA; uint rB;
        (xk, rA, rB, result.price) = _selectPrice(config, state, sideIn, sideOut);
        // [CALCULATION]
        State memory state1 = IHelper(param.helper).swapToState(
            Slippable(xk, state.R, rA, rB),
            param.payload
        );
        require(state1.a <= type(uint224).max, "OA");
        require(state1.b <= type(uint224).max, "OB");
        // [TRANSITION]
        (uint rA1, uint rB1) = _evaluate(xk, state1);
        if (sideIn == SIDE_R) {
            require(rA1 >= rA && rB1 >= rB, "MI:R");
            result.amountIn = state1.R - state.R;
        } else {
            require(state.R >= state1.R, "MI:NR");
            uint s = _supply(sideIn);
            if (sideIn == SIDE_A) {
                require(rB1 >= rB, "MI:A");
                result.amountIn = FullMath.mulDivRoundingUp(s, rA - rA1, rA);
            } else {
                require(rA1 >= rA, "MI:NA");
                if (sideIn == SIDE_B) {
                    result.amountIn = FullMath.mulDivRoundingUp(s, rB - rB1, rB);
                } else if (sideIn == SIDE_C) {
                    require(rB1 >= rB, "MI:NB");
                    uint rC = state.R - rA - rB;
                    uint rC1 = state1.R - rA1 - rB1;
                    result.amountIn = FullMath.mulDivRoundingUp(s, rC - rC1, rC);
                    rCLast = uint240(rC1);
                    rCLastIn = true;
                }
            }
            unchecked {
                // rX >= rX - rX1, so s >= amountIn
                require(MINIMUM_SUPPLY <= s - result.amountIn, 'MS');
            }
        }
        if (sideOut == SIDE_R) {
            result.amountOut = state.R - state1.R;
        } else {
            if (sideOut == SIDE_C) {
                uint rC = state.R - rA - rB;
                uint rC1 = state1.R - rA1 - rB1;
                require(rC1 >= MINIMUM_RESERVE, 'MR:C');
                result.amountOut = FullMath.mulDiv(_supply(sideOut), rC1 - rC, rC);
                rCLast = uint240(rC1);
                rCLastIn = false;
            } else {
                uint inputRate = Q128;
                if (sideOut == SIDE_A) {
                    require(rA1 >= MINIMUM_RESERVE, 'MR:A');
                    result.amountOut = FullMath.mulDiv(_supply(sideOut), rA1 - rA, rA);
                    inputRate = _inputRate(config, state1, rA1, rB1);
                } else if (sideOut == SIDE_B) {
                    require(rB1 >= MINIMUM_RESERVE, 'MR:B');
                    result.amountOut = FullMath.mulDiv(_supply(sideOut), rB1 - rB, rB);
                    inputRate = _inputRate(config, state1, rB1, rA1);
                }
                if (inputRate != Q128) {
                    result.amountIn = FullMath.mulDiv(result.amountIn, Q128, inputRate);
                }
            }
        }
        s_a = uint224(state1.a);
        s_b = uint224(state1.b);
    }

    function _inputRate(
        Config memory config,
        State memory state,
        uint rOut,
        uint rTuo
    ) internal pure returns (uint rate) {
        rate = config.OPEN_RATE;
        if (config.PREMIUM_RATE > 0 && rOut > rTuo) {
            uint rC1 = state.R - rOut - rTuo;
            unchecked {
                uint imbaRate = FullMath.mulDiv(Q128, rOut - rTuo, rC1);
                if (imbaRate > config.PREMIUM_RATE) {
                    rate = FullMath.mulDiv(rate, config.PREMIUM_RATE, imbaRate);
                }
            }
        }
    }
}

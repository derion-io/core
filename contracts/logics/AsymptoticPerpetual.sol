// SPDX-License-Identifier: BSL-1.1
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";

import "../libs/OracleLibrary.sol";
import "../libs/SimpleMath.sol";
import "./Constants.sol";
import "./Storage.sol";
import "../interfaces/IHelper.sol";
import "../interfaces/IERC1155Supply.sol";
import "../interfaces/IAsymptoticPerpetual.sol";
import "../libs/abdk-consulting/abdk-libraries-solidity/ABDKMath64x64.sol";


contract AsymptoticPerpetual is Storage, Constants, IAsymptoticPerpetual {
    uint internal constant FEE_RATE = 12;    // takes 1/12 cut of LP interest rate

    function init(
        Config memory config,
        uint a,
        uint b
    ) external override returns (uint rA, uint rB, uint rC) {
        require(s_a == 0 && s_b == 0, "ALREADY_INITIALIZED");
        (uint twap, ) = _fetch(config.ORACLE);
        uint t = block.timestamp - config.INIT_TIME;
        uint decayRateX64 = _decayRate(t, config.HALF_LIFE);
        State memory state = State(_reserve(config.TOKEN_R), a, b);
        Market memory market = _market(config.K, config.MARK, decayRateX64, twap);
        (rA, rB) = _evaluate(market, state);
        rC = state.R - rA - rB;
        // uint R = IERC20(TOKEN_R).balanceOf(address(this));
        // require(4 * a * b <= R, "INVALID_PARAM");
        uint feeDecayRateX64 = _decayRate(t, config.HALF_LIFE * FEE_RATE);
        s_R = FullMath.mulDivRoundingUp(state.R, feeDecayRateX64, Q64);
        s_a = a;
        s_b = b;
    }

    function getR(uint R, uint INIT_TIME, uint HALF_LIFE) external view override returns (uint) {
        uint feeRateX64 = _decayRate(block.timestamp - INIT_TIME, HALF_LIFE * FEE_RATE);
        return FullMath.mulDiv(R, Q64, feeRateX64);
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

    function _packID(address pool, uint side) internal pure returns (uint id) {
        id = (side << 160) + uint160(pool);
    }

    function _fetch(
        bytes32 ORACLE // 1bit QTI, 31bit reserve, 32bit WINDOW, ... PAIR ADDRESS
    ) internal view returns (uint twap, uint spot) {
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
        uint price
    ) internal pure returns (Market memory market) {
        market.xkA = _powu(FullMath.mulDiv(price, Q128, MARK), K);
        market.xkB = uint(FullMath.mulDiv(Q256M/market.xkA, Q64, decayRateX64));
        market.xkA = uint(FullMath.mulDiv(market.xkA, Q64, decayRateX64));
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
        uint decayRateX64 = _decayRate(block.timestamp - config.INIT_TIME, config.HALF_LIFE);
        (uint min, uint max) = _fetch(config.ORACLE);
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

    function swap(
        Config memory config,
        uint sideIn,
        uint sideOut,
        address helper,
        bytes memory payload
    ) external override returns(uint amountIn, uint amountOut) {
        require(sideIn != sideOut, 'SAME_SIDE');
        // [PRICE SELECTION]
        amountIn = _decayRate(block.timestamp - config.INIT_TIME, config.HALF_LIFE * FEE_RATE);
        State memory state = State(
            FullMath.mulDiv(s_R, Q64, amountIn),
            s_a,
            s_b
        );
        (Market memory market, uint rA, uint rB) = _selectPrice(config, state, sideIn, sideOut);
        // [CALCULATION]
        State memory state1 = IHelper(helper).swapToState(market, state, rA, rB, payload);
        if (state.R != state1.R) {
            uint R = FullMath.mulDivRoundingUp(state1.R, amountIn, Q64);
            s_R = R;
            // TODO: do we need this?
            state1.R = FullMath.mulDiv(R, Q64, amountIn);
        }
        // [TRANSITION]
        (uint rA1, uint rB1) = _evaluate(market, state1);
        if (sideIn == SIDE_R) {
            amountIn = state1.R - state.R;
        } else {
            uint s = _supply(config.TOKEN, sideIn);
            if (sideIn == SIDE_A) {
                amountIn = FullMath.mulDivRoundingUp(rA - rA1, s, rA);
                s_a = state1.a;
            } else if (sideIn == SIDE_B) {
                amountIn = FullMath.mulDivRoundingUp(rB - rB1, s, rB);
                s_b = state1.b;
            } else if (sideIn == SIDE_C) {
                uint rC = state.R - rA - rB;
                uint rC1 = state1.R - rA1 - rB1;
                amountIn = FullMath.mulDivRoundingUp(rC - rC1, s, rC);
            }
        }
        if (sideOut == SIDE_R) {
            amountOut = state.R - state1.R;
        } else {
            uint s = _supply(config.TOKEN, sideOut);
            if (sideOut == SIDE_A) {
                amountOut = FullMath.mulDiv(rA1 - rA, s, rA);
                s_a = state1.a;
            } else if (sideOut == SIDE_B) {
                amountOut = FullMath.mulDiv(rB1 - rB, s, rB);
                s_b = state1.b;
            } else if (sideOut == SIDE_C) {
                uint rC = state.R - rA - rB;
                uint rC1 = state1.R - rA1 - rB1;
                amountOut = FullMath.mulDiv(rC1 - rC, s, rC);
            }
        }
    }
}

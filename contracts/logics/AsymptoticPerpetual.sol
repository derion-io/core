// SPDX-License-Identifier: BSL-1.1
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@derivable/oracle/contracts/@uniswap/lib/contracts/libraries/FixedPoint.sol";
import "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";

import "../libraries/OracleLibrary.sol";
import "./Constants.sol";
import "./Storage.sol";
import "../interfaces/IERC1155Supply.sol";
import "../interfaces/IAsymptoticPerpetual.sol";
import "../libraries/ABDKMath64x64.sol";


contract AsymptoticPerpetual is Storage, Constants, IAsymptoticPerpetual {
    using ABDKMath64x64 for int128;

    function init(
        address TOKEN_R,
        bytes32 ORACLE,
        uint224 MARK,
        uint k,
        uint a,
        uint b
    ) external override returns (uint rA, uint rB, uint rC) {
        require(s_k == 0, "ALREADY_INITIALIZED");
        s_k = k;
        ___ memory __;
        (uint224 twap, ) = _fetch(ORACLE);
        __.xkA = _xk(twap, MARK);
        __.xkB = uint224(FixedPoint.Q224/__.xkA);
        __.R = IERC20(TOKEN_R).balanceOf(address(this));
        s_a = __.a = a;
        s_b = __.b = b;
        (rA, rB, rC) = _evaluate(__);
        // uint R = IERC20(TOKEN_R).balanceOf(address(this));
        // require(4 * a * b <= R, "INVALID_PARAM");
    }

    function _xk(
        uint224 price,
        uint224 mark
    ) internal view returns (uint224) {
        uint224 p = FixedPoint.fraction(price, mark)._x;
        return uint224(_powu(p, s_k));
    }

    // TODO: move to price-lib
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
    function _r(uint224 xk, uint v, uint R) internal pure returns (uint r) {
        r = FullMath.mulDiv(v, xk, FixedPoint.Q112);
        if (r > R >> 1) {
            uint denominator = FullMath.mulDiv(v, uint(xk) << 2, FixedPoint.Q112);
            uint minuend = FullMath.mulDiv(R, R, denominator);
            r = R - minuend;
        }
    }

    // v(r)
    function _v(uint224 xk, uint r, uint R) internal pure returns (uint v) {
        if (r <= R / 2) {
            return FullMath.mulDiv(r, FixedPoint.Q112, xk);
        }
        uint denominator = FullMath.mulDiv(R - r, uint(xk) << 2, FixedPoint.Q112);
        return FullMath.mulDiv(R, R, denominator);
    }

    function _supply(address TOKEN, uint side) internal view returns (uint s) {
        return IERC1155Supply(TOKEN).totalSupply(_packID(address(this), side));
    }

    function _evaluate(___ memory __) internal pure returns (uint rA, uint rB, uint rC) {
        rA = _r(__.xkA, __.a, __.R);
        rB = _r(__.xkB, __.b, __.R);
        rC = __.R - rA - rB;
    }

    struct ___ {
        uint224 xkA;
        uint224 xkB;
        uint R;
        uint a;
        uint b;
    }

    function _tryPrice (
        ___ memory __,
        Config memory config,
        uint224 price
    ) internal view returns (uint rA, uint rB, uint rC) {
        __.xkA = _xk(price, config.MARK);
        __.xkB = uint224(FixedPoint.Q224/__.xkA);
        uint rateX64 = _decayRate(block.timestamp - config.TIMESTAMP, config.HALF_LIFE);
        __.xkA = uint224(FullMath.mulDiv(__.xkA, Q64, rateX64));
        __.xkB = uint224(FullMath.mulDiv(__.xkB, Q64, rateX64));
        (rA, rB, rC) = _evaluate(__);
    }

    function _decayRate (
        uint elapsed,
        uint HALF_LIFE
    ) internal pure returns (uint rateX64) {
        int128 rate = int128(int((elapsed << 64) / HALF_LIFE)).exp_2();
        return uint(int(rate));
    } 

    function _selectPrice(
        ___ memory __,
        Config memory config,
        uint sideIn,
        uint sideOut
    ) internal view returns (uint rA, uint rB, uint rC) {
        (uint224 min, uint224 max) = _fetch(config.ORACLE);
        if (min > max) {
            (min, max) = (max, min);
        }
        if (sideOut == SIDE_A || sideIn == SIDE_B) {
            return _tryPrice(__, config, max);
        }
        if (sideOut == SIDE_B || sideIn == SIDE_A) {
            return _tryPrice(__, config, min);
        }
        // TODO: assisting flag for min/max
        (rA, rB, rC) = _tryPrice(__, config, min);
        if ((sideIn == SIDE_R) == rB > rA) {
            // TODO: unit test for this case
            return _tryPrice(__, config, max);
        }
    }

    function exactIn(
        Config memory config,
        uint sideIn,
        uint amountIn,
        uint sideOut
    ) external override returns(uint amountOut) {
        require(sideIn != sideOut, 'SAME_SIDE');
        ___ memory __;
        __.R = IERC20(config.TOKEN_R).balanceOf(address(this));
        __.a = s_a;
        __.b = s_b;
        (uint rA, uint rB, uint rC) = _selectPrice(__, config, sideIn, sideOut);
        if (sideIn == SIDE_R) {
            require(sideOut != SIDE_R, "INVALID_SIDE");
            __.R += amountIn;
            if (sideOut == SIDE_A) {
                s_a = __.a = _v(__.xkA, rA + amountIn, __.R);
            } else if (sideOut == SIDE_B) {
                s_b = __.b = _v(__.xkB, rB + amountIn, __.R);
            }
        } else {
            uint sIn = _supply(config.TOKEN, sideIn);
            if (sideIn == SIDE_A) {
                amountOut = rA * amountIn / sIn;
                if (sideOut == SIDE_R) {
                    __.R -= amountOut;
                }
                s_a = __.a = _v(__.xkA, rA - amountOut, __.R);
            } else if (sideIn == SIDE_B) {
                amountOut = rB * amountIn / sIn;
                if (sideOut == SIDE_R) {
                    __.R -= amountOut;
                }
                s_b = __.b = _v(__.xkB, rB - amountOut, __.R);
            } else /*if (sideIn == SIDE_C)*/ {
                amountOut = rC * amountIn / sIn;
                if (sideOut == SIDE_R) {
                    __.R -= amountOut;
                }
                // s_c is not a storage
            }
        }
        if (sideOut != SIDE_R) {
            // TODO: optimize this specific to each case
            uint sOut = _supply(config.TOKEN, sideOut);
            (uint rA1, uint rB1, uint rC1) = _evaluate(__);
            if (sideOut == SIDE_A) {
                amountOut = (rA1 - rA) * sOut / rA;
            } else if (sideOut == SIDE_B) {
                amountOut = (rB1 - rB) * sOut / rB;
            } else if (sideOut == SIDE_C) {
                amountOut = (rC1 - rC) * sOut / rC;
            }
        }
    }
}

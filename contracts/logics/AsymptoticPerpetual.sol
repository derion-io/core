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

contract AsymptoticPerpetual is Storage, Constants, IAsymptoticPerpetual {
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

    function _packID(address pool, uint kind) internal pure returns (uint id) {
        id = (kind << 160) + uint160(pool);
    }

    function _fetch(
        bytes32 ORACLE // 1bit QTI, 31bit reserve, 32bit WINDOW, ... PAIR ADDRESS
    ) internal view returns (uint224 twap, uint224 spot) {
        address pool = address(uint160(uint(ORACLE)));
        (uint160 sqrtSpotX96,,,,,,) = IUniswapV3Pool(pool).slot0();

        (int24 arithmeticMeanTick,) = OracleLibrary.consult(pool, uint32(uint(ORACLE) >> 192));
        uint160 sqrtTwapX96 = TickMath.getSqrtRatioAtTick(arithmeticMeanTick);

        if (uint(ORACLE) >> 224 == 0) {
            sqrtSpotX96 = uint160((1 << 192) / uint(sqrtSpotX96));
            sqrtTwapX96 = uint160((1 << 192) / uint(sqrtTwapX96));
        }
        twap = uint224(FullMath.mulDiv(uint(sqrtTwapX96), uint(sqrtTwapX96), 1 << 80));
        spot = uint224(FullMath.mulDiv(uint(sqrtSpotX96), uint(sqrtSpotX96), 1 << 80));
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

    function exactIn(
        Config memory config,
        uint sideIn,
        uint amountIn,
        uint sideOut
    ) external override returns(uint amountOut) {
        require(sideIn != sideOut, 'SAME_SIDE');
        ___ memory __;
        {
            (uint224 price, ) = _fetch(config.ORACLE);
            // TODO: select spot vs twap here
            __.xkA = _xk(price, config.MARK);
            __.xkB = uint224(FixedPoint.Q224/__.xkA);
            // TODO: decay
        }
        __.R = IERC20(config.TOKEN_R).balanceOf(address(this));
        __.a = s_a;
        __.b = s_b;
        (uint rA, uint rB, uint rC) = _evaluate(__);
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

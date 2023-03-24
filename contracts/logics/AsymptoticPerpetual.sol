// SPDX-License-Identifier: BSL-1.1
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@derivable/oracle/contracts/@uniswap/lib/contracts/libraries/FixedPoint.sol";
import "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";

import "../libraries/OracleLibrary.sol";
import "./DerivableLibrary.sol";
import "./Constants.sol";
import "./Storage.sol";
import "../interfaces/IERC1155Supply.sol";
import "../interfaces/IPoolFactory.sol";
import "../interfaces/IAsymptoticPerpetual.sol";

contract AsymptoticPerpetual is Storage, Constants, IAsymptoticPerpetual {
    using FixedPoint for FixedPoint.uq112x112;

    address internal immutable TOKEN;

    constructor(
        address token
    ) {
        TOKEN = token;
    }

    function init(
        address TOKEN_COLLATERAL,
        uint power,
        uint a,
        uint b
    ) external returns (uint rA, uint rB, uint rC) {
        require(s_priceScaleTimestamp == 0, "already initialized");
        s_power = power;
        uint224 xk = uint224(FixedPoint.Q112);
        Param memory param;
        param.R = IERC20(TOKEN_COLLATERAL).balanceOf(address(this));
        param.a = a;
        param.b = b;
        (rA, rB, rC) = DerivableLibrary.evaluate(xk, param);
        s_priceScaleTimestamp = uint32(block.timestamp);
    }

    function _xk(
        uint224 price,
        uint224 mark
    ) internal view returns (uint224) {
        uint224 p = FixedPoint.fraction(price, mark)._x;
        return uint224(_powu(p, s_power));
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

    function transition(
        address TOKEN_COLLATERAL,
        uint224 xk,
        Param memory param1
    ) external returns (int dsA, int dsB, int dsC) {
        Param memory param0 = Param(IERC20(TOKEN_COLLATERAL).balanceOf(address(this)), s_a, s_b);
        State memory state = State(
            xk,
            IERC1155Supply(TOKEN).totalSupply(_packID(address(this), KIND_LONG)),
            IERC1155Supply(TOKEN).totalSupply(_packID(address(this), KIND_SHORT)),
            IERC1155Supply(TOKEN).totalSupply(_packID(address(this), KIND_LP))
        );
        (dsA, dsB, dsC) = DerivableLibrary.transition(state, param0, param1);
    }

    // TODO: pack all 3 params into an uint
    // ORACLE = 
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

    function exactIn(
        address TOKEN_COLLATERAL,
        bytes32 ORACLE,
        uint224 MARK,
        uint kindIn,
        uint amountIn,
        uint kindOut
    ) external returns(int dsA, int dsB, int dsC) {
        Param memory param0 = Param(IERC20(TOKEN_COLLATERAL).balanceOf(address(this)), s_a, s_b);
        (uint224 price, ) = _fetch(ORACLE);
        // TODO: select spot vs twap here
        State memory state = State(
            _xk(price, MARK),
            IERC1155Supply(TOKEN).totalSupply(_packID(address(this), KIND_LONG)),
            IERC1155Supply(TOKEN).totalSupply(_packID(address(this), KIND_SHORT)),
            IERC1155Supply(TOKEN).totalSupply(_packID(address(this), KIND_LP))
        );
        // TODO: 1/xk and decay here
        Param memory param1 = Param(param0.R, param0.a, param0.b);
        (uint rA, uint rB, uint rC) = DerivableLibrary.evaluate(state.xk, param0);
        if (kindIn == KIND_LONG) {
            uint drA = rA * amountIn / state.sA;
            if (kindOut == KIND_C) {
                param1.R -= drA;
            }
            param1.a = DerivableLibrary.solve(state.xk, rA - drA, param1.R);
        } else if (kindIn == KIND_SHORT) {
            uint drB = rB * amountIn / state.sB;
            if (kindOut == KIND_C) {
                param1.R -= drB;
            }
            param1.b = DerivableLibrary.solve(state.xk, rB - drB, param1.R);
        } else if (kindIn == KIND_LP) {
            uint drC = rC * amountIn / state.sC;
            if (kindOut == KIND_C) {
                param1.R -= drC;
            }
        } else { // anything else is R (cToken)
            require(kindIn == KIND_C && kindOut != KIND_C, "Unknown kind");
            param1.R += amountIn;
            if (kindOut == KIND_LONG) {
                param1.a = DerivableLibrary.solve(state.xk, rA + amountIn, param1.R);
            } else if (kindOut == KIND_SHORT) {
                param1.b = DerivableLibrary.solve(state.xk, rB + amountIn, param1.R);
            }
        }
        // TODO: not all token supply is needed here
        (dsA, dsB, dsC) = DerivableLibrary.transition(state, param0, param1);
    }
}

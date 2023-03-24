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

contract AsymptoticPerpetual is Storage, Constants {
    using FixedPoint for FixedPoint.uq112x112;

    function init(
        address TOKEN_COLLATERAL,
        uint power,
        uint a,
        uint b
    ) external returns (uint rA, uint rB, uint rC) {
        require(s_priceScaleTimestamp == 0, "already initialized");
        s_power = power;
        uint224 xk = uint224(FixedPoint.Q112);
        DerivableLibrary.Param memory param;
        param.R = IERC20(TOKEN_COLLATERAL).balanceOf(address(this));
        param.a = a;
        param.b = b;
        (rA, rB, rC) = DerivableLibrary.evaluate(xk, param);
        s_priceScaleTimestamp = uint32(block.timestamp);
    }

    function _xk(
        uint224 price,
        uint224 mark
    ) internal view returns (FixedPoint.uq112x112 memory p) {
        p = FixedPoint.fraction(price, mark);
        p._x = uint224(_powu(p._x, s_power));
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
        address ORACLE,
        address TOKEN,
        uint QUOTE_TOKEN_INDEX,
        uint32 TIME,
        uint224 markPrice,
        DerivableLibrary.Param memory param0,
        DerivableLibrary.Param memory param1
    ) external returns (int dsA, int dsB, int dsC) {
        DerivableLibrary.State memory state;
        (uint224 twap, ) = fetch(
            ORACLE,
            QUOTE_TOKEN_INDEX,
            TIME
        );
        state.xk = _xk(twap, markPrice)._x;
        state.sA = IERC1155Supply(TOKEN).totalSupply(_packID(address(this), KIND_LONG));
        state.sB = IERC1155Supply(TOKEN).totalSupply(_packID(address(this), KIND_SHORT));
        state.sC = IERC1155Supply(TOKEN).totalSupply(_packID(address(this), KIND_LP));
        (dsA, dsB, dsC) = DerivableLibrary.transition(state, param0, param1);
    }

    function fetch(address pool, uint quoteTokenIndex, uint32 secondAgo) 
    internal view 
    returns (uint224 twap, uint224 spot) {
        (uint160 sqrtSpotX96,,,,,,) = IUniswapV3Pool(pool).slot0();

        (int24 arithmeticMeanTick,) = OracleLibrary.consult(pool, secondAgo);
        uint160 sqrtTwapX96 = TickMath.getSqrtRatioAtTick(arithmeticMeanTick);

        if (quoteTokenIndex == 0) {
            sqrtSpotX96 = uint160((1 << 192) / uint(sqrtSpotX96));
            sqrtTwapX96 = uint160((1 << 192) / uint(sqrtTwapX96));
        }
        twap = uint224(FullMath.mulDiv(uint(sqrtTwapX96), uint(sqrtTwapX96), 1 << 80));
        spot = uint224(FullMath.mulDiv(uint(sqrtSpotX96), uint(sqrtSpotX96), 1 << 80));
    }
}

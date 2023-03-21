// SPDX-License-Identifier: BSL-1.1
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@derivable/oracle/contracts/@uniswap/lib/contracts/libraries/FixedPoint.sol";
import "@derivable/oracle/contracts/PriceLibrary.sol";
import "@derivable/oracle/contracts/OracleLibrary.sol";
import "@derivable/oracle/contracts/OracleStore.sol";
import "./DerivableLibrary.sol";
import "./Constants.sol";
import "./Storage.sol";
import "../interfaces/IERC1155Supply.sol";
import "../interfaces/IPoolFactory.sol";

contract AsymptoticPerpetual is Storage, Constants {
    using FixedPoint for FixedPoint.uq112x112;
    using PriceLibrary for OraclePrice;
    using OracleLibrary for OracleStore;

    function init(
        address TOKEN_ORACLE,
        address TOKEN_COLLATERAL,
        bool BASE_TOKEN_0,
        uint224 markPrice,
        uint power,
        uint a,
        uint b
    ) external returns (uint rA, uint rB, uint rC) {
        require(s_priceScaleTimestamp == 0, "already initialized");
        s_oracleStore.init(TOKEN_ORACLE, BASE_TOKEN_0);
        s_markPrice = markPrice;
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
        OraclePrice memory price
    ) internal view returns (FixedPoint.uq112x112 memory p) {
        p = price.base.divuq(FixedPoint.uq112x112(s_markPrice));
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
        require(z <= type(uint224).max, "DerivablePool: upper overflow");
    }

    function _packID(address pool, uint kind) internal pure returns (uint id) {
        id = (kind << 160) + uint160(pool);
    }

    function transition(
        address TOKEN_ORACLE,
        bool BASE_TOKEN_0,
        DerivableLibrary.Param memory param0,
        DerivableLibrary.Param memory param1
    ) external returns (int dsA, int dsB, int dsC) {
        DerivableLibrary.State memory state;
        (OraclePrice memory twap, ) = s_oracleStore.fetchPrice(
            TOKEN_ORACLE,
            BASE_TOKEN_0
        );
        state.xk = _xk(twap)._x;
        state.sA = IERC1155Supply(s_token1155).totalSupply(_packID(address(this), KIND_LONG));
        state.sB = IERC1155Supply(s_token1155).totalSupply(_packID(address(this), KIND_SHORT));
        state.sC = IERC1155Supply(s_token1155).totalSupply(_packID(address(this), KIND_LP));
        (dsA, dsB, dsC) = DerivableLibrary.transition(state, param0, param1);
    }
}

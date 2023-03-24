// SPDX-License-Identifier: BSL-1.1
pragma solidity ^0.8.9;

import "@derivable/oracle/contracts/@uniswap/lib/contracts/libraries/FixedPoint.sol";
import "@derivable/oracle/contracts/@uniswap/lib/contracts/libraries/FullMath.sol";
import "hardhat/console.sol";

library DerivableLibrary {
    using FixedPoint for FixedPoint.uq112x112;

    struct Param {
        uint R; // current reserve of cToken (base, quote or LP)
        uint a; // a param for long derivative
        uint b; // b param for short derivative
    }

    struct State {
        uint224 xk; // (base / mark)^k
        uint sA; // current supply of 1155 id A
        uint sB; // current supply of 1155 id B
        uint sC; // current supply of 1155 id C (LP token)
    }

    function transition(
        State memory state,
        Param memory param0,
        Param memory param1
    ) public pure returns (int dsA, int dsB, int dsC) {
        (uint rA0, uint rB0, uint rC0) = evaluate(state.xk, param0);
        (uint rA1, uint rB1, uint rC1) = evaluate(state.xk, param1);
        dsA = ((int(rA1) - int(rA0)) * int(state.sA)) / int(rA0);
        dsB = ((int(rB1) - int(rB0)) * int(state.sB)) / int(rB0);
        dsC = ((int(rC1) - int(rC0)) * int(state.sC)) / int(rC0);
    }

    function evaluate(
        uint224 xk,
        Param memory param
    ) public pure returns (uint rA, uint rB, uint rC) {
        // TODO: pass an assisting flag to decide f or g should be calculated first
        rA = r(xk, param.a, param.R);
        rB = r(uint224(FixedPoint.Q224/ xk), param.b, param.R);
        rC = param.R - rA - rB; // revert on overflow
    }

    function r(uint224 xk, uint v, uint R) internal pure returns (uint) {
        uint fResult = _f(xk, v);
        if (fResult <= R / 2) {
            return fResult;
        }
        return _g(xk, v, R);
    }

    function _f(uint224 xk, uint v) internal pure returns (uint) {
        return FullMath.mulDiv(v, uint(xk), FixedPoint.Q112);
    }

    function _g(uint224 xk, uint v, uint R) internal pure returns (uint) {
        uint denonminator = FullMath.mulDiv(4 * v, uint(xk), FixedPoint.Q112);
        uint minuend = FullMath.mulDiv(R, R, denonminator);
        return R - minuend;
    }
}

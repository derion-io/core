// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155Supply.sol";
import "./logics/Constants.sol";
import "./logics/Storage.sol";
import "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";
import "./libs/OracleLibrary.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./libs/abdk-consulting/abdk-libraries-solidity/ABDKMath64x64.sol";

interface IERC1155Supply {
    /**
     * @dev Total amount of tokens in with a given id.
     */
    function totalSupply(uint256 id) external view returns (uint256);

    /**
     * @dev Indicates whether any token exist with a given id, or not.
     */
    function exists(uint256 id) external view returns (bool);

    function balanceOf(address account, uint256 id) external view returns (uint256);
}

contract View is Storage, Constants {
    // address internal UTR;
    // address internal LOGIC;
    // address internal TOKEN;
    // address internal TOKEN_R;
    // uint internal MARK;

    struct StateView {
        uint sA;
        uint sB;
        uint sC;
        uint R;
        uint rA;
        uint rB;
        uint rC;
        uint a;
        uint b;
        uint xk;
        uint xkA;
//        uint xkB;
        uint twap;
        uint spot;
        bytes32 ORACLE;
    }

    struct State {
        uint R;
        uint a;
        uint b;
    }


    struct Market {
        uint xkA;
        uint xkB;
    }

    function test() external pure returns (uint) {
        return 1000;
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

    function getStates(bytes32 ORACLE, uint MARK, address TOKEN_R, uint k, address TOKEN, uint INIT_TIME, uint HALF_LIFE) external view returns (StateView memory states) {
        states.R = IERC20(TOKEN_R).balanceOf(address(this));
        states.a = s_a;
        states.b = s_b;
        {
            State memory state = State(states.R, states.a, states.b = s_b);
            uint decayRateX64 = _decayRate(block.timestamp - INIT_TIME, HALF_LIFE);
            (uint min, uint max) = _fetch(ORACLE);
            if (min > max) {
                (min, max) = (max, min);
            }
            uint rAMax;
            uint rBMax;
            (states.rA, rBMax) = _evaluate(_market(k, MARK, decayRateX64, min), state);
            (rAMax, states.rB) = _evaluate(_market(k, MARK, decayRateX64, max), state);
            states.rC = states.R - rAMax - rBMax;
            // states.xkA = market.xkA;
            // states.xKB = market.xkB;
        }
        states.sA = IERC1155Supply(TOKEN).totalSupply(_packID(address(this), SIDE_A));
        states.sB = IERC1155Supply(TOKEN).totalSupply(_packID(address(this), SIDE_B));
        states.sC = IERC1155Supply(TOKEN).totalSupply(_packID(address(this), SIDE_C));
    }

    function _evaluate(Market memory market, State memory state) internal pure returns (uint rA, uint rB) {
        rA = _r(market.xkA, state.a, state.R);
        rB = _r(market.xkB, state.b, state.R);
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

    function _packID(address pool, uint side) internal pure returns (uint id) {
        id = (side << 160) + uint160(pool);
    }

    function _xk(
        uint price,
        uint mark,
        uint k
    ) internal pure returns (uint) {
        uint p = FullMath.mulDiv(price, Q128, mark);
        return uint(_powu(p, k));
    }

    function _r(uint xk, uint v, uint R) internal pure returns (uint r) {
        r = FullMath.mulDiv(v, xk, Q128);
        if (r > R >> 1) {
            uint denominator = FullMath.mulDiv(v, xk << 2, Q128);
            uint minuend = FullMath.mulDiv(R, R, denominator);
            r = R - minuend;
        }
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
}

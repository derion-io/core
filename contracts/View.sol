// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155Supply.sol";
import "./logics/Constants.sol";
import "./logics/Storage.sol";
import "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";
import "./libraries/OracleLibrary.sol";
import "@derivable/oracle/contracts/@uniswap/lib/contracts/libraries/FixedPoint.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

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
    address internal UTR;
    address internal LOGIC;
    address internal TOKEN;
    address internal TOKEN_R;
    uint224 internal MARK;

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
        uint224 xk;
        uint224 twap;
        uint224 spot;
        bytes32 ORACLE;
    }

    function test() external view returns (uint test) {
        test = 1000;
    }

    function getStates(bytes32 ORACLE, uint224 MARK, address TOKEN_R, uint k, address TOKEN) external view returns (StateView memory states) {
        (states.twap, states.spot) = _fetch(ORACLE);

        uint idA = _packID(address(this), SIDE_A);
        uint idB = _packID(address(this), SIDE_B);
        uint idC = _packID(address(this), SIDE_C);

        states.a = s_a;
        states.b = s_b;

        uint224 xk = _xk(states.twap, MARK, k);
        states.xk = xk;

        states.R = IERC20(TOKEN_R).balanceOf(address(this));
        states.rA = _r(xk, s_a, states.R);
        states.rB = _r(xk, s_b, states.R);

        states.sA = IERC1155Supply(TOKEN).totalSupply(idA);
        states.sB = IERC1155Supply(TOKEN).totalSupply(idB);
        states.sC = IERC1155Supply(TOKEN).totalSupply(idC);
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

    function _packID(address pool, uint side) internal pure returns (uint id) {
        id = (side << 160) + uint160(pool);
    }

    function _xk(
        uint224 price,
        uint224 mark,
        uint k
    ) internal view returns (uint224) {
        uint224 p = FixedPoint.fraction(price, mark)._x;
        return uint224(_powu(p, k));
    }

    function _r(uint224 xk, uint v, uint R) internal pure returns (uint r) {
        r = FullMath.mulDiv(v, xk, FixedPoint.Q112);
        if (r > R >> 1) {
            uint denominator = FullMath.mulDiv(v, uint(xk) << 2, FixedPoint.Q112);
            uint minuend = FullMath.mulDiv(R, R, denominator);
            r = R - minuend;
        }
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
}

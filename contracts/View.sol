// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155Supply.sol";
import "./logics/Constants.sol";
import "./logics/Storage.sol";
import "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";
import "./libraries/OracleLibrary.sol";

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
        uint sK;
        uint rA;
        uint rB;
        uint rC;
        uint224 twap;
        uint224 spot;
        bytes32 ORACLE;
    }

    function test() external view returns (uint test) {
        test = 1000;
    }

    function getStates(bytes32 ORACLE, address TOKEN) external view returns (StateView memory states) {
        (states.twap, states.spot) = _fetch(ORACLE);

        uint idA = _packID(address(this), SIDE_A);
        uint idB = _packID(address(this), SIDE_B);
        uint idC = _packID(address(this), SIDE_C);

        states.rA =  IERC1155Supply(TOKEN).balanceOf(address(this), idA);
        states.rC = IERC1155Supply(TOKEN).balanceOf(address(this), idB);
        states.rB = IERC1155Supply(TOKEN).balanceOf(address(this), idC);

        states.sA = s_a;
        states.sB = s_b;
        states.sK = s_k;
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

    function _packID(address pool, uint side) internal pure returns (uint id) {
        id = (side << 160) + uint160(pool);
    }
}

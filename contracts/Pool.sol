// SPDX-License-Identifier: BSL-1.1
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@uniswap/lib/contracts/libraries/TransferHelper.sol";
import "@derivable/oracle/contracts/@uniswap/v2-core/contracts/interfaces/IUniswapV2Pair.sol";
import "./interfaces/IPoolFactory.sol";
import "./logics/Constants.sol";
import "./interfaces/IERC1155Supply.sol";
import "./logics/Storage.sol";
import "hardhat/console.sol";

contract Pool is Storage, Constants {
    uint public constant MINIMUM_LIQUIDITY = 10 ** 3;

    /// Immutables
    address internal immutable LOGIC;
    address internal immutable ORACLE;
    address internal immutable TOKEN;
    address internal immutable TOKEN_COLLATERAL;
    uint internal immutable QUOTE_TOKEN_INDEX;
    uint224 internal immutable MARK_PRICE;
    uint32 internal immutable TIME;

    struct Param {
        uint R; // current reserve of cToken (base, quote or LP)
        uint a; // a param for long derivative
        uint b; // b param for short derivative
    }

    constructor() {
        Params memory params = IPoolFactory(msg.sender).getParams();
        // TODO: require(4*params.a*params.b <= params.R, "invalid (R,a,b)");
        TOKEN = IPoolFactory(msg.sender).TOKEN();
        LOGIC = params.logic;
        ORACLE = params.tokenOracle;
        address t0 = IUniswapV2Pair(ORACLE).token0();
        TOKEN_COLLATERAL = params.tokenCollateral;
        QUOTE_TOKEN_INDEX = (TOKEN_COLLATERAL == t0) ? 1 : 0;
        MARK_PRICE = params.markPrice;
        TIME = params.time;

        s_a = params.a;
        s_b = params.b;

        (bool success, bytes memory result) = LOGIC.delegatecall(
            abi.encodeWithSignature(
                "init(address,uint256,uint256,uint256)",
                TOKEN_COLLATERAL,
                params.power,
                params.a,
                params.b
            )
        );
        if (!success) {
            assembly {
                revert(add(result, 32), mload(result))
            }
        }
        (uint rA, uint rB, uint rC) = abi.decode(result, (uint, uint, uint));

        IERC1155Supply(TOKEN).mint(
            params.recipient,
            _packID(address(this), KIND_LONG),
            rA,
            ""
        );
        IERC1155Supply(TOKEN).mint(
            params.recipient,
            _packID(address(this), KIND_SHORT),
            rB,
            ""
        );
        // TODO: remove this
        IERC1155Supply(TOKEN).mint(
            address(1),
            _packID(address(this), KIND_LP),
            MINIMUM_LIQUIDITY,
            ""
        );
        IERC1155Supply(TOKEN).mint(
            params.recipient,
            _packID(address(this), KIND_LP),
            rC - MINIMUM_LIQUIDITY,
            ""
        );
    }

    function _packID(address pool, uint kind) internal pure returns (uint id) {
        id = (kind << 160) + uint160(pool);
    }

    // function swap(
    //     int dr,
    //     int dra,
    //     int drb
    // ) external {
    //     Param memory param0 = Param(
    //         IERC20(TOKEN_COLLATERAL).balanceOf(address(this)),
    //         s_a,
    //         s_b
    //     );
    // }

    function transition(Param memory param1, address recipient) public {
        Param memory param0 = Param(IERC20(TOKEN_COLLATERAL).balanceOf(address(this)), s_a, s_b);

        (bool success, bytes memory result) = LOGIC.delegatecall(
            abi.encodeWithSignature(
                "transition(address,address,uint256,uint32,uint224,(uint256,uint256,uint256),(uint256,uint256,uint256))",
                ORACLE,
                TOKEN,
                QUOTE_TOKEN_INDEX,
                TIME,
                MARK_PRICE,
                param0,
                param1
            )
        );
        if (!success) {
            assembly {
                revert(add(result, 32), mload(result))
            }
        }
        (int dsA, int dsB, int dsC) = abi.decode(result, (int, int, int));

        s_a = param1.a;
        s_b = param1.b;

        if (param0.R < param1.R) {
            uint dR = param1.R - param0.R;
            TransferHelper.safeTransferFrom(
                TOKEN_COLLATERAL,
                msg.sender,
                address(this),
                dR
            );
        } else if (param0.R > param1.R) {
            uint dR = param0.R - param1.R;
            TransferHelper.safeTransfer(TOKEN_COLLATERAL, msg.sender, dR);
        }

        if (dsA > 0) {
            IERC1155Supply(TOKEN).mint(
                recipient,
                _packID(address(this), KIND_LONG),
                uint(dsA),
                ""
            );
        } else if (dsA < 0) {
            IERC1155Supply(TOKEN).burn(
                msg.sender,
                _packID(address(this), KIND_LONG),
                uint(-dsA)
            );
        }

        if (dsB > 0) {
            IERC1155Supply(TOKEN).mint(
                recipient,
                _packID(address(this), KIND_SHORT),
                uint(dsB),
                ""
            );
        } else if (dsB < 0) {
            IERC1155Supply(TOKEN).burn(
                msg.sender,
                _packID(address(this), KIND_SHORT),
                uint(-dsB)
            );
        }

        if (dsC > 0) {
            IERC1155Supply(TOKEN).mint(
                recipient,
                _packID(address(this), KIND_LP),
                uint(dsC),
                ""
            );
        } else if (dsC < 0) {
            IERC1155Supply(TOKEN).burn(
                msg.sender,
                _packID(address(this), KIND_LP),
                uint(-dsC)
            );
        }
    }
}

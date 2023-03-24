// SPDX-License-Identifier: BSL-1.1
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@uniswap/lib/contracts/libraries/TransferHelper.sol";
import "./interfaces/IPoolFactory.sol";
import "./logics/Constants.sol";
import "./interfaces/IERC1155Supply.sol";
import "./interfaces/IAsymptoticPerpetual.sol";
import "./logics/Storage.sol";
import "hardhat/console.sol";

contract Pool is Storage, Constants {
    uint public constant MINIMUM_LIQUIDITY = 10 ** 3;

    /// Immutables
    address internal immutable LOGIC;
    bytes32 internal immutable ORACLE;
    address internal immutable TOKEN;
    address internal immutable TOKEN_COLLATERAL;
    uint224 internal immutable MARK_PRICE;

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
        ORACLE = params.oracle;
        TOKEN_COLLATERAL = params.tokenCollateral;
        MARK_PRICE = params.markPrice;

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
            _packID(address(this), SIDE_A),
            rA,
            ""
        );
        IERC1155Supply(TOKEN).mint(
            params.recipient,
            _packID(address(this), SIDE_B),
            rB,
            ""
        );
        // TODO: remove this
        IERC1155Supply(TOKEN).mint(
            address(1),
            _packID(address(this), SIDE_C),
            MINIMUM_LIQUIDITY,
            ""
        );
        IERC1155Supply(TOKEN).mint(
            params.recipient,
            _packID(address(this), SIDE_C),
            rC - MINIMUM_LIQUIDITY,
            ""
        );
    }

    function _packID(address pool, uint kind) internal pure returns (uint id) {
        id = (kind << 160) + uint160(pool);
    }

    function exactIn(
        uint sideIn,
        uint amountIn,
        uint sideOut,
        address recipient
    ) external returns(uint amountOut) {
        (bool success, bytes memory result) = LOGIC.delegatecall(
            abi.encodeWithSelector(
                IAsymptoticPerpetual.exactIn.selector,
                TOKEN_COLLATERAL,
                ORACLE,
                MARK_PRICE,
                sideIn,
                amountIn,
                sideOut,
                recipient
            )
        );
        if (!success) {
            assembly {
                revert(add(result, 32), mload(result))
            }
        }
        amountOut = abi.decode(result, (uint));
    }
}

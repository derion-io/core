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
    address internal immutable TOKEN_R;
    uint224 internal immutable MARK;

    constructor() {
        Params memory params = IPoolFactory(msg.sender).getParams();
        // TODO: require(4*params.a*params.b <= params.R, "invalid (R,a,b)");
        TOKEN = params.token;
        LOGIC = params.logic;
        ORACLE = params.oracle;
        TOKEN_R = params.reserveToken;
        MARK = params.mark;

        (bool success, bytes memory result) = LOGIC.delegatecall(
            abi.encodeWithSelector(
                IAsymptoticPerpetual.init.selector,
                TOKEN_R,
                ORACLE,
                MARK,
                params.k,
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
        uint idA = _packID(address(this), SIDE_A);
        uint idB = _packID(address(this), SIDE_B);
        uint idC = _packID(address(this), SIDE_C);

        // permanently lock MINIMUM_LIQUIDITY for each side
        // TODO: handle the 0x1 address minting
        IERC1155Supply(TOKEN).mint(address(1), idA, MINIMUM_LIQUIDITY, "");
        IERC1155Supply(TOKEN).mint(address(1), idB, MINIMUM_LIQUIDITY, "");
        IERC1155Supply(TOKEN).mint(address(1), idC, MINIMUM_LIQUIDITY, "");

        // mint tokens to recipient
        IERC1155Supply(TOKEN).mint(params.recipient, idA, rA - MINIMUM_LIQUIDITY, "");
        IERC1155Supply(TOKEN).mint(params.recipient, idB, rB - MINIMUM_LIQUIDITY, "");
        IERC1155Supply(TOKEN).mint(params.recipient, idC, rC - MINIMUM_LIQUIDITY, "");
    }

    function _packID(address pool, uint side) internal pure returns (uint id) {
        id = (side << 160) + uint160(pool);
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
                Config(TOKEN, TOKEN_R, ORACLE, MARK),
                sideIn,
                amountIn,
                sideOut
            )
        );
        if (!success) {
            assembly {
                revert(add(result, 32), mload(result))
            }
        }
        amountOut = abi.decode(result, (uint));
        // TODO: reentrancy guard
        if (sideOut == SIDE_R) {
            TransferHelper.safeTransfer(TOKEN_R, recipient, amountOut);
        } else {
            IERC1155Supply(TOKEN).mint(recipient, _packID(address(this), sideOut), amountOut, "");
        }
        // TODO: flash callback here
        if (sideIn == SIDE_R) {
            TransferHelper.safeTransferFrom(TOKEN_R, msg.sender, recipient, amountIn);
        } else {
            IERC1155Supply(TOKEN).burn(msg.sender, _packID(address(this), sideIn), amountIn);
        }
    }
}

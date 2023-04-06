// SPDX-License-Identifier: BSL-1.1
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import "@derivable/utr/contracts/interfaces/IUniversalTokenRouter.sol";
import "@uniswap/lib/contracts/libraries/TransferHelper.sol";
import "./interfaces/IPoolFactory.sol";
import "./logics/Constants.sol";
import "./interfaces/IERC1155Supply.sol";
import "./interfaces/IAsymptoticPerpetual.sol";
import "./logics/Storage.sol";

contract Pool is Storage, Constants {
    uint public constant MINIMUM_LIQUIDITY = 10 ** 3;

    /// Immutables
    address internal immutable UTR;
    address internal immutable LOGIC;
    bytes32 internal immutable ORACLE;
    address internal immutable TOKEN;
    address internal immutable TOKEN_R;
    uint224 internal immutable MARK;
    uint internal immutable TIMESTAMP;
    uint internal immutable HALF_LIFE;

    constructor() {
        Params memory params = IPoolFactory(msg.sender).getParams();
        // TODO: require(4*params.a*params.b <= params.R, "invalid (R,a,b)");
        UTR = params.utr;
        TOKEN = params.token;
        LOGIC = params.logic;
        ORACLE = params.oracle;
        TOKEN_R = params.reserveToken;
        MARK = params.mark;
        HALF_LIFE = params.halfLife;
        TIMESTAMP = block.timestamp;

        (bool success, bytes memory result) = LOGIC.delegatecall(
            abi.encodeWithSelector(
                IAsymptoticPerpetual.init.selector,
                Config(
                    TOKEN,
                    TOKEN_R,
                    ORACLE,
                    MARK,
                    TIMESTAMP,
                    HALF_LIFE
                ),
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
        IERC1155Supply(TOKEN).mintVirtual(idA, MINIMUM_LIQUIDITY);
        IERC1155Supply(TOKEN).mintVirtual(idB, MINIMUM_LIQUIDITY);
        IERC1155Supply(TOKEN).mintVirtual(idC, MINIMUM_LIQUIDITY);

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
        address payer,
        address recipient
    ) external returns(uint amountOut) {
        (bool success, bytes memory result) = LOGIC.delegatecall(
            abi.encodeWithSelector(
                IAsymptoticPerpetual.exactIn.selector,
                Config(TOKEN, TOKEN_R, ORACLE, MARK, TIMESTAMP, HALF_LIFE),
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
            if (payer == address(0)) {
                TransferHelper.safeTransferFrom(TOKEN_R, msg.sender, address(this), amountIn);
            } else {
                IUniversalTokenRouter(UTR).pay(payer, address(this), 20, TOKEN_R, 0, amountIn);
            }
        } else {
            if (payer != address(0) && IERC1155(TOKEN).isApprovedForAll(payer, msg.sender)) {
                IERC1155Supply(TOKEN).burn(payer, _packID(address(this), sideIn), amountIn);
            } else {
                IERC1155Supply(TOKEN).burn(msg.sender, _packID(address(this), sideIn), amountIn);
            }
        }
    }
}

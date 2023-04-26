// SPDX-License-Identifier: BSL-1.1
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@derivable/utr/contracts/interfaces/IUniversalTokenRouter.sol";
import "@uniswap/lib/contracts/libraries/TransferHelper.sol";
import "./interfaces/IPoolFactory.sol";
import "./logics/Constants.sol";
import "./interfaces/IERC1155Supply.sol";
import "./interfaces/IAsymptoticPerpetual.sol";
import "./interfaces/IPool.sol";
import "./logics/Storage.sol";
import "./logics/Events.sol";

contract Pool is IPool, Storage, Events, Constants {
    uint public constant MINIMUM_LIQUIDITY = 10 ** 3;

    /// Immutables
    address internal immutable UTR;
    address internal immutable LOGIC;
    bytes32 internal immutable ORACLE;
    uint internal immutable K;
    address internal immutable TOKEN;
    address public immutable TOKEN_R;
    uint internal immutable MARK;
    uint internal immutable INIT_TIME;
    uint internal immutable HALF_LIFE;
    uint32 internal immutable MIN_EXPIRATION;
    uint32 internal immutable C_MIN_EXPIRATION;

    constructor() {
        Params memory params = IPoolFactory(msg.sender).getParams();
        // TODO: require(4*params.a*params.b <= params.R, "invalid (R,a,b)");
        UTR = params.utr;
        TOKEN = params.token;
        LOGIC = params.logic;
        ORACLE = params.oracle;
        TOKEN_R = params.reserveToken;
        K = params.k;
        MARK = params.mark;
        HALF_LIFE = params.halfLife;
        MIN_EXPIRATION = params.minExpiration;
        C_MIN_EXPIRATION = params.cMinExpiration;
        INIT_TIME = params.initTime > 0 ? params.initTime : block.timestamp;
        require(block.timestamp >= INIT_TIME, "PAST_INIT_TIME");

        (bool success, bytes memory result) = LOGIC.delegatecall(
            abi.encodeWithSelector(
                IAsymptoticPerpetual.init.selector,
                Config(
                    TOKEN,
                    TOKEN_R,
                    ORACLE,
                    K,
                    MARK,
                    INIT_TIME,
                    HALF_LIFE
                ),
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
        IERC1155Supply(TOKEN).mintVirtualSupply(idA, MINIMUM_LIQUIDITY);
        IERC1155Supply(TOKEN).mintVirtualSupply(idB, MINIMUM_LIQUIDITY);
        IERC1155Supply(TOKEN).mintVirtualSupply(idC, MINIMUM_LIQUIDITY);

        // mint tokens to recipient
        IERC1155Supply(TOKEN).mint(params.recipient, idA, rA - MINIMUM_LIQUIDITY, MIN_EXPIRATION, "");
        IERC1155Supply(TOKEN).mint(params.recipient, idB, rB - MINIMUM_LIQUIDITY, MIN_EXPIRATION, "");
        IERC1155Supply(TOKEN).mint(params.recipient, idC, rC - MINIMUM_LIQUIDITY, C_MIN_EXPIRATION, "");


        emit Derivable(
            'PoolCreated',                 // topic1: eventName
            _addressToBytes32(msg.sender), // topic2: factory
            _addressToBytes32(LOGIC),      // topic3: logic
            abi.encode(PoolCreated(
                UTR,
                TOKEN,
                LOGIC,
                ORACLE,
                TOKEN_R,
                MARK,
                INIT_TIME,
                HALF_LIFE,
                params.k
            ))
        );
    }

    function _packID(address pool, uint side) internal pure returns (uint id) {
        id = (side << 160) + uint160(pool);
    }

    function swap(
        uint sideIn,
        uint sideOut,
        address helper,
        bytes calldata payload,
        uint32 expiration,
        address payer,
        address recipient
    ) external override returns(uint amountIn, uint amountOut) {
        if (sideOut == SIDE_C) {
            require(expiration >= C_MIN_EXPIRATION, "Pool: expiration too small");
        }
        if (sideOut == SIDE_A || sideOut == SIDE_B) {
            require(expiration >= MIN_EXPIRATION, "Pool: expiration too small");
        }
        (bool success, bytes memory result) = LOGIC.delegatecall(
            abi.encodeWithSelector(
                IAsymptoticPerpetual.swap.selector,
                Config(TOKEN, TOKEN_R, ORACLE, K, MARK, INIT_TIME, HALF_LIFE),
                sideIn,
                sideOut,
                helper,
                payload
            )
        );
        if (!success) {
            assembly {
                revert(add(result, 32), mload(result))
            }
        }
        (amountIn, amountOut) = abi.decode(result, (uint, uint));
        // TODO: reentrancy guard
        if (sideOut == SIDE_R) {
            TransferHelper.safeTransfer(TOKEN_R, recipient, amountOut);
        } else {
            IERC1155Supply(TOKEN).mint(recipient, _packID(address(this), sideOut), amountOut, expiration, "");
        }
        // TODO: flash callback here
        if (sideIn == SIDE_R) {
            if (payer != address(0)) {
                IUniversalTokenRouter(UTR).pay(payer, address(this), 20, TOKEN_R, 0, amountIn);
            } else {
                TransferHelper.safeTransferFrom(TOKEN_R, msg.sender, address(this), amountIn);
            }
        } else {
            uint idIn = _packID(address(this), sideIn);
            if (payer != address(0)) {
                IUniversalTokenRouter(UTR).discard(payer, 1155, TOKEN, idIn, amountIn);
                IERC1155Supply(TOKEN).burn(payer, idIn, amountIn);
            } else {
                IERC1155Supply(TOKEN).burn(msg.sender, idIn, amountIn);
            }
        }
    }
}

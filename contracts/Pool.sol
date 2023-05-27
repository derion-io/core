// SPDX-License-Identifier: BSL-1.1
pragma solidity ^0.8.0;

import "@derivable/utr/contracts/interfaces/IUniversalTokenRouter.sol";
import "@uniswap/lib/contracts/libraries/TransferHelper.sol";

import "./logics/AsymptoticPerpetual.sol";
import "./interfaces/IERC1155Supply.sol";
import "./interfaces/IPool.sol";
import "./logics/Events.sol";

contract Pool is AsymptoticPerpetual, IPool, Events {
    uint public constant MINIMUM_LIQUIDITY = 10 ** 3;

    IPoolFactory internal immutable FACTORY;

    constructor() AsymptoticPerpetual() {
        FACTORY = IPoolFactory(msg.sender);
        Params memory params = IPoolFactory(msg.sender).getParams();

        (uint rA, uint rB, uint rC) = _init(params.a, params.b);
        uint idA = _packID(address(this), SIDE_A);
        uint idB = _packID(address(this), SIDE_B);
        uint idC = _packID(address(this), SIDE_C);

        // permanently lock MINIMUM_LIQUIDITY for each side
        IERC1155Supply(TOKEN).mintVirtualSupply(idA, MINIMUM_LIQUIDITY);
        IERC1155Supply(TOKEN).mintVirtualSupply(idB, MINIMUM_LIQUIDITY);
        IERC1155Supply(TOKEN).mintVirtualSupply(idC, MINIMUM_LIQUIDITY);

        // mint tokens to recipient
        IERC1155Supply(TOKEN).mintLock(params.recipient, idA, rA - MINIMUM_LIQUIDITY, MIN_EXPIRATION_D, "");
        IERC1155Supply(TOKEN).mintLock(params.recipient, idB, rB - MINIMUM_LIQUIDITY, MIN_EXPIRATION_D, "");
        IERC1155Supply(TOKEN).mintLock(params.recipient, idC, rC - MINIMUM_LIQUIDITY, MIN_EXPIRATION_C, "");

        emit Derivable(
            'PoolCreated',                 // topic1: eventName
            _addressToBytes32(msg.sender), // topic2: factory
            abi.encode(PoolCreated(
                UTR,
                TOKEN,
                ORACLE,
                TOKEN_R,
                MARK,
                INIT_TIME,
                HALF_LIFE,
                PREMIUM_RATE,
                params.k
            ))
        );
    }

    function getStates() external view returns (uint R, uint a, uint b) {
        R = _getR(s_R);
        a = s_a;
        b = s_b;
    }

    function collect() external returns (uint amount) {
        uint R = _getR(s_R);
        amount = IERC20(TOKEN_R).balanceOf(address(this)) - R;
        address feeTo = FACTORY.getFeeTo();
        require(feeTo != address(0), "FTNS");
        TransferHelper.safeTransfer(TOKEN_R, feeTo, amount);
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
            require(expiration >= MIN_EXPIRATION_C, "IEC");
        }
        {
            SwapParam memory param = SwapParam(0, helper, payload);
            if (sideOut == SIDE_A || sideOut == SIDE_B) {
                require(expiration >= MIN_EXPIRATION_D, "IED");
                if (DISCOUNT_RATE > 0) {
                    param.zeroInterestTime = (expiration - MIN_EXPIRATION_D) * DISCOUNT_RATE / Q128;
                }
            }
            (amountIn, amountOut) = _swap(sideIn, sideOut, param);
        }
        // TODO: reentrancy guard
        if (sideOut == SIDE_R) {
            TransferHelper.safeTransfer(TOKEN_R, recipient, amountOut);
        } else {
            if (sideOut == SIDE_C) {
                if (expiration == 0) {
                    expiration = MIN_EXPIRATION_C;
                } else {
                    require(expiration >= MIN_EXPIRATION_C, "IEC");
                }
            }
            if (sideOut == SIDE_A || sideOut == SIDE_B) {
                if (expiration == 0) {
                    expiration = MIN_EXPIRATION_D;
                } else {
                    require(expiration >= MIN_EXPIRATION_D, "IED");
                }
            }
            IERC1155Supply(TOKEN).mintLock(recipient, _packID(address(this), sideOut), amountOut, expiration, "");
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

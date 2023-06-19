// SPDX-License-Identifier: BSL-1.1
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@derivable/utr/contracts/interfaces/IUniversalTokenRouter.sol";
import "@uniswap/lib/contracts/libraries/TransferHelper.sol";

import "./interfaces/IPoolFactory.sol";
import "./logics/Constants.sol";
import "./interfaces/IERC1155Supply.sol";
import "./interfaces/IPool.sol";
import "./logics/Storage.sol";
import "./logics/Events.sol";

abstract contract Pool is IPool, Storage, Events, Constants {
    /// Immutables
    address internal immutable UTR;
    bytes32 public immutable ORACLE; // QTI(1) reserve(32) WINDOW(32) PAIR(160)
    uint public immutable K;
    address internal immutable TOKEN;
    address public immutable TOKEN_R;
    uint internal immutable MARK;
    uint internal immutable INIT_TIME;
    uint internal immutable HALF_LIFE;

    uint internal immutable PREMIUM_RATE;
    uint32 internal immutable MATURITY;
    uint internal immutable MATURITY_COEF;
    uint internal immutable MATURITY_EXP;
    uint internal immutable DISCOUNT_RATE;
    uint internal immutable OPEN_RATE;

    constructor() {
        Params memory params = IPoolFactory(msg.sender).getParams();
        UTR = params.utr;
        TOKEN = params.token;
        ORACLE = params.oracle;
        TOKEN_R = params.reserveToken;
        K = params.k;
        MARK = params.mark;
        HALF_LIFE = params.halfLife;
        MATURITY = params.maturity;
        MATURITY_EXP = params.maturityExp;
        MATURITY_COEF = params.maturityCoef;
        DISCOUNT_RATE = params.discountRate;
        PREMIUM_RATE = params.premiumRate;
        INIT_TIME = params.initTime > 0 ? params.initTime : block.timestamp;
        OPEN_RATE = params.openRate;
        require(block.timestamp >= INIT_TIME, "PIT");

        uint R = IERC20(TOKEN_R).balanceOf(address(this));
        require(params.a <= R >> 1 && params.b <= R >> 1, "IP");

        s_a = params.a;
        s_b = params.b;

        uint idA = _packID(address(this), SIDE_A);
        uint idB = _packID(address(this), SIDE_B);
        uint idC = _packID(address(this), SIDE_C);

        // mint tokens to recipient
        uint R3 = R/3;
        IERC1155Supply(TOKEN).mintLock(params.recipient, idA, R3, MATURITY, "");
        IERC1155Supply(TOKEN).mintLock(params.recipient, idB, R3, MATURITY, "");
        IERC1155Supply(TOKEN).mintLock(params.recipient, idC, R - (R3<<1), MATURITY, "");

        emit Derivable(
            'PoolCreated',                 // topic1: eventName
            _addressToBytes32(msg.sender), // topic2: factory
            bytes32(bytes20(TOKEN_R)),     // topic3: reserve token
            abi.encode(PoolCreated(
                UTR,
                TOKEN,
                ORACLE,
                TOKEN_R,
                MARK,
                INIT_TIME,
                HALF_LIFE,
                PREMIUM_RATE,
                K
            ))
        );
    }

    function _packID(address pool, uint side) internal pure returns (uint id) {
        id = (side << 160) + uint160(pool);
    }

    function getStates() external view returns (uint R, uint a, uint b) {
        R = IERC20(TOKEN_R).balanceOf(address(this));
        a = s_a;
        b = s_b;
    }

    function swap(
        uint sideIn,
        uint sideOut,
        address helper,
        bytes calldata payload,
        uint32 maturity,
        address payer,
        address recipient
    ) external override returns(uint amountIn, uint amountOut) {
        SwapParam memory param = SwapParam(0, helper, payload);
        if (sideOut != SIDE_R) {
            require(maturity >= MATURITY, "IE");
        }
        if (sideOut == SIDE_A || sideOut == SIDE_B) {
            if (DISCOUNT_RATE > 0) {
                param.zeroInterestTime = (maturity - MATURITY) * DISCOUNT_RATE / Q128;
            }
        }
        (amountIn, amountOut) = _swap(sideIn, sideOut, param);
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
                payer = msg.sender;
            }
            uint maturityOut = IERC1155Supply(TOKEN).locktimeOf(payer, idIn);
            amountOut = _maturityPayoff(maturityOut, amountOut);
        }
        if (sideOut == SIDE_R) {
            TransferHelper.safeTransfer(TOKEN_R, recipient, amountOut);
        } else {
            IERC1155Supply(TOKEN).mintLock(recipient, _packID(address(this), sideOut), amountOut, maturity, "");
        }
    }

    function _swap(
        uint sideIn,
        uint sideOut,
        SwapParam memory param
    ) internal virtual returns(uint amountIn, uint amountOut);

    function _maturityPayoff(uint maturity, uint amountOut) internal view virtual returns (uint);
}

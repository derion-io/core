// SPDX-License-Identifier: BSL-1.1
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";
import "@derivable/utr/contracts/interfaces/IUniversalTokenRouter.sol";
import "@uniswap/lib/contracts/libraries/TransferHelper.sol";

import "./interfaces/IPoolFactory.sol";
import "./logics/Constants.sol";
import "./interfaces/IERC1155Supply.sol";
import "./interfaces/IPool.sol";
import "./logics/Storage.sol";

abstract contract Pool is IPool, ERC1155Holder, Storage, Constants {
    /// immutables
    address internal immutable FEE_TO;

    bytes32 public immutable ORACLE; // QTI(1) reserve(32) WINDOW(32) PAIR(160)
    uint public immutable K;
    address internal immutable TOKEN;
    address public immutable TOKEN_R;
    uint internal immutable MARK;
    uint internal immutable HL_INTEREST;
    uint internal immutable HL_FEE;

    uint internal immutable PREMIUM_RATE;
    uint32 internal immutable MATURITY;
    uint32 internal immutable MATURITY_VEST;
    uint internal immutable MATURITY_RATE;
    uint internal immutable DISCOUNT_RATE;
    uint internal immutable OPEN_RATE;

    constructor() {
        FEE_TO = IPoolFactory(msg.sender).FEE_TO();

        Params memory params = IPoolFactory(msg.sender).getParams();
        TOKEN = params.token;
        ORACLE = params.oracle;
        TOKEN_R = params.reserveToken;
        K = params.k;
        MARK = params.mark;
        HL_INTEREST = params.halfLife;
        HL_FEE = HL_INTEREST * IPoolFactory(msg.sender).FEE_RATE();
        MATURITY = params.maturity;
        MATURITY_VEST = params.maturityVest;
        MATURITY_RATE = params.maturityRate;
        DISCOUNT_RATE = params.discountRate;
        PREMIUM_RATE = params.premiumRate;
        OPEN_RATE = params.openRate;

        uint R = IERC20(TOKEN_R).balanceOf(address(this));
        require(params.a <= R >> 1 && params.b <= R >> 1, "IP");

        s_i = uint32(block.timestamp);
        s_a = uint224(params.a);
        s_f = uint32(block.timestamp);
        s_b = uint224(params.b);

        uint idA = _packID(address(this), SIDE_A);
        uint idB = _packID(address(this), SIDE_B);
        uint idC = _packID(address(this), SIDE_C);

        // mint tokens to recipient
        uint R3 = R/3;
        uint32 maturity = uint32(block.timestamp) + MATURITY;
        IERC1155Supply(TOKEN).mintLock(params.recipient, idA, R3, maturity, "");
        IERC1155Supply(TOKEN).mintLock(params.recipient, idB, R3, maturity, "");
        IERC1155Supply(TOKEN).mintLock(params.recipient, idC, R - (R3<<1), maturity, "");
    }

    function _packID(address pool, uint side) internal pure returns (uint id) {
        id = (side << 160) + uint160(pool);
    }

    function getStates() external view returns (uint R, uint a, uint b, uint32 i, uint32 f) {
        R = IERC20(TOKEN_R).balanceOf(address(this));
        i = s_i;
        a = s_a;
        f = s_f;
        b = s_b;
    }

    function swap(
        uint sideIn,
        uint sideOut,
        address helper,
        bytes calldata payload,
        uint32 maturity,
        address utr,
        address payer,
        address recipient
    ) external override returns(uint amountIn, uint amountOut) {
        SwapParam memory param = SwapParam(0, helper, payload);
        if (sideOut != SIDE_R) {
            if (maturity == 0) {
                maturity = uint32(block.timestamp) + MATURITY;
            } else {
                require(maturity - block.timestamp >= MATURITY, "IE");
            }
        }
        if (sideOut == SIDE_A || sideOut == SIDE_B) {
            if (DISCOUNT_RATE > 0) {
                // TODO: maturity
                param.zeroInterestTime = (maturity - block.timestamp - MATURITY) * DISCOUNT_RATE / Q128;
            }
        }
        (amountIn, amountOut) = _swap(sideIn, sideOut, param);
        if (sideIn == SIDE_R) {
            if (utr != address(0)) {
                uint expected = amountIn + IERC20(TOKEN_R).balanceOf(address(this));
                IUniversalTokenRouter(utr).pay(payer, address(this), 20, TOKEN_R, 0, amountIn);
                require(expected <= IERC20(TOKEN_R).balanceOf(address(this)), "BP");
            } else {
                TransferHelper.safeTransferFrom(TOKEN_R, msg.sender, address(this), amountIn);
            }
        } else {
            uint idIn = _packID(address(this), sideIn);
            if (utr != address(0)) {
                IUniversalTokenRouter(utr).pay(payer, address(this), 1155, TOKEN, idIn, amountIn);
                IERC1155Supply(TOKEN).burn(address(this), idIn, amountIn);
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

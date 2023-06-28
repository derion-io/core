// SPDX-License-Identifier: BSL-1.1
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";
import "@derivable/utr/contracts/interfaces/IUniversalTokenRouter.sol";
import "@uniswap/lib/contracts/libraries/TransferHelper.sol";

import "./interfaces/IPoolFactory.sol";
import "./logics/Constants.sol";
import "./interfaces/IToken.sol";
import "./interfaces/IPool.sol";
import "./logics/Storage.sol";

abstract contract Pool is IPool, ERC1155Holder, Storage, Constants {
    event Swap(
        address indexed payer,
        address indexed recipient,
        uint indexed sideMax,
        uint sideIn,
        uint sideOut,
        uint maturity,
        uint amountIn,
        uint amountOut
    );

    /// @notice Returns the metadata of this (MetaProxy) contract.
    /// Only relevant with contracts created via the MetaProxy standard.
    /// @dev This function is aimed to be invoked with- & without a call.
    function loadConfig() public pure returns (Config memory config) {
        bytes memory data;
        assembly {
            let posOfMetadataSize := sub(calldatasize(), 32)
            let size := calldataload(posOfMetadataSize)
            let dataPtr := sub(posOfMetadataSize, size)
            data := mload(64)
            // increment free memory pointer by metadata size + 32 bytes (length)
            mstore(64, add(data, add(size, 32)))
            mstore(data, size)
            let memPtr := add(data, 32)
            calldatacopy(memPtr, dataPtr, size)
        }
        return abi.decode(data, (Config));
    }

    function init(Params memory params, SwapPayment memory payment) external {
        require(s_i == 0, "AI");
        uint R = params.R;
        uint a = params.a;
        uint b = params.b;
        require(R > 0 && a > 0 && b > 0, "ZP");
        require(a <= R >> 1 && b <= R >> 1, "IP");

        Config memory config = loadConfig();

        if (payment.payer != address(0)) {
            uint expected = R + IERC20(config.TOKEN_R).balanceOf(address(this));
            IUniversalTokenRouter(payment.utr).pay(payment.payer, address(this), 20, config.TOKEN_R, 0, R);
            require(expected <= IERC20(config.TOKEN_R).balanceOf(address(this)), "BP");
        } else {
            TransferHelper.safeTransferFrom(config.TOKEN_R, msg.sender, address(this), R);
        }

        s_i = uint32(block.timestamp);
        s_a = uint224(a);
        s_f = uint32(block.timestamp);
        s_b = uint224(b);

        uint idA = _packID(address(this), SIDE_A);
        uint idB = _packID(address(this), SIDE_B);
        uint idC = _packID(address(this), SIDE_C);

        // mint tokens to recipient
        uint R3 = R / 3;
        uint32 maturity = uint32(block.timestamp) + config.MATURITY;
        IToken(config.TOKEN).mintLock(payment.recipient, idA, R3, maturity, "");
        IToken(config.TOKEN).mintLock(payment.recipient, idB, R3, maturity, "");
        IToken(config.TOKEN).mintLock(payment.recipient, idC, R - (R3 << 1), maturity, "");
    }

    function _packID(address pool, uint side) internal pure returns (uint id) {
        id = (side << 160) + uint160(pool);
    }

    function getStates()
        external
        view
        returns (uint R, uint a, uint b, uint32 i, uint32 f)
    {
        Config memory config = loadConfig();
        R = IERC20(config.TOKEN_R).balanceOf(address(this));
        i = s_i;
        a = s_a;
        f = s_f;
        b = s_b;
    }

    function swap(
        SwapParam memory param,
        SwapPayment memory payment
    ) external override returns (uint amountIn, uint amountOut) {
        Config memory config = loadConfig();
        if (param.sideOut != SIDE_R) {
            uint maturityMin = uint32(block.timestamp) + config.MATURITY;
            if (param.maturity == 0) {
                param.maturity = maturityMin;
            } else {
                require(param.maturity <= type(uint32).max, "MO");
                require(param.maturity >= maturityMin, "MM");
            }
        }
        (amountIn, amountOut) = _swap(config, param);
        if (param.sideIn == SIDE_R) {
            if (payment.payer != address(0)) {
                uint expected = amountIn + IERC20(config.TOKEN_R).balanceOf(address(this));
                IUniversalTokenRouter(payment.utr).pay(payment.payer, address(this), 20, config.TOKEN_R, 0, amountIn);
                require(expected <= IERC20(config.TOKEN_R).balanceOf(address(this)), "BP");
            } else {
                TransferHelper.safeTransferFrom(config.TOKEN_R, msg.sender, address(this), amountIn);
                payment.payer = msg.sender;
            }
        } else {
            uint idIn = _packID(address(this), param.sideIn);
            if (payment.payer != address(0)) {
                IUniversalTokenRouter(payment.utr).pay(payment.payer, address(this), 1155, config.TOKEN, idIn, amountIn);
                IToken(config.TOKEN).burn(address(this), idIn, amountIn);
            } else {
                IToken(config.TOKEN).burn(msg.sender, idIn, amountIn);
                payment.payer = msg.sender;
            }
            uint inputMaturity = IToken(config.TOKEN).maturityOf(payment.payer, idIn);
            amountOut = _maturityPayoff(config, inputMaturity, amountOut);
        }
        if (param.sideOut == SIDE_R) {
            TransferHelper.safeTransfer(config.TOKEN_R, payment.recipient, amountOut);
        } else {
            uint idOut = _packID(address(this), param.sideOut);
            IToken(config.TOKEN).mintLock(payment.recipient, idOut, amountOut, uint32(param.maturity), "");
        }

        emit Swap(
            payment.payer,
            payment.recipient,
            _max(param.sideIn, param.sideOut),
            param.sideIn,
            param.sideOut,
            param.maturity,
            amountIn,
            amountOut
        );
    }

    function _max(uint a, uint b) internal pure returns (uint) {
        return a > b ? a : b;
    }

    function _swap(Config memory config, SwapParam memory param) internal virtual returns (uint amountIn, uint amountOut);
    function _maturityPayoff(Config memory config, uint maturity, uint amountOut) internal view virtual returns (uint);
}

// SPDX-License-Identifier: BSL-1.1
pragma solidity 0.8.20;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";
import "@uniswap/lib/contracts/libraries/TransferHelper.sol";

import "@derivable/utr/contracts/interfaces/IUniversalTokenRouter.sol";

import "./interfaces/IPoolFactory.sol";
import "./interfaces/IToken.sol";
import "./interfaces/IPool.sol";
import "./subs/Constants.sol";
import "./subs/Storage.sol";

abstract contract PoolBase is IPool, ERC1155Holder, Storage, Constants {
    struct Result {
        uint256 amountIn;
        uint256 amountOut;
        uint256 price;
    }
    
    uint32 constant internal F_MASK = ~uint32(1);
    address immutable internal TOKEN;

    event Swap(
        address indexed payer,
        address indexed recipient,
        uint256 indexed sideMax,
        uint256 sideIn,
        uint256 sideOut,
        uint256 maturity,
        uint256 amountIn,
        uint256 amountOut,
        uint256 price
    );

    /**
     * @dev Prevents a contract from calling itself, directly or indirectly.
     * Calling a `nonReentrant` function from another `nonReentrant`
     * function is not supported. It is possible to prevent this from happening
     * by making the `nonReentrant` function external, and making it call a
     * `private` function that does the actual work.
     */
    modifier nonReentrant() {
        ensureStateIntegrity();
        s_lastPremiumTime |= 1;
        _;
        s_lastPremiumTime &= F_MASK;
    }

    constructor(address token) {
        require(token != address(0), "PoolBase: ZERO_ADDRESS");
        TOKEN = token;
    }

    function init(State memory state, Payment memory payment) external {
        require(s_lastInterestTime == 0, "PoolBase: ALREADY_INITIALIZED");
        uint256 R = state.R;
        uint256 a = state.a;
        uint256 b = state.b;
        require(R > 0 && a > 0 && b > 0, "PoolBase: ZERO_PARAM");
        require(a <= R >> 1 && b <= R >> 1, "PoolBase: INVALID_PARAM");

        s_lastInterestTime = uint32(block.timestamp);
        s_a = uint224(a);
        s_lastPremiumTime = uint32(block.timestamp & F_MASK);
        s_b = uint224(b);

        Config memory config = loadConfig();

        if (payment.payer != address(0)) {
            uint256 expected = R + IERC20(config.TOKEN_R).balanceOf(address(this));
            IUniversalTokenRouter(payment.utr).pay(payment.payer, address(this), 20, config.TOKEN_R, 0, R);
            require(expected <= IERC20(config.TOKEN_R).balanceOf(address(this)), "PoolBase: INSUFFICIENT_PAYMENT");
        } else {
            TransferHelper.safeTransferFrom(config.TOKEN_R, msg.sender, address(this), R);
        }

        uint256 idA = _packID(address(this), SIDE_A);
        uint256 idB = _packID(address(this), SIDE_B);
        uint256 idC = _packID(address(this), SIDE_C);

        // mint tokens to recipient
        uint256 R3 = R / 3;
        uint32 maturity = uint32(block.timestamp + config.MATURITY);
        IToken(TOKEN).mintLock(payment.recipient, idA, R3, maturity, "");
        IToken(TOKEN).mintLock(payment.recipient, idB, R3, maturity, "");
        IToken(TOKEN).mintLock(payment.recipient, idC, R - (R3 << 1), maturity, "");
    }

    function swap(
        Param memory param,
        Payment memory payment
    ) external override nonReentrant returns (uint256 amountIn, uint256 amountOut, uint256 price) {
        Config memory config = loadConfig();

        Result memory result = _swap(config, param);
        (amountIn, amountOut, price) = (result.amountIn, result.amountOut, result.price);
        if (param.sideIn == SIDE_R) {
            if (payment.payer != address(0)) {
                uint256 expected = amountIn + IERC20(config.TOKEN_R).balanceOf(address(this));
                IUniversalTokenRouter(payment.utr).pay(payment.payer, address(this), 20, config.TOKEN_R, 0, amountIn);
                require(expected <= IERC20(config.TOKEN_R).balanceOf(address(this)), "PoolBase: INSUFFICIENT_PAYMENT");
            } else {
                TransferHelper.safeTransferFrom(config.TOKEN_R, msg.sender, address(this), amountIn);
                payment.payer = msg.sender;
            }
        } else {
            uint256 idIn = _packID(address(this), param.sideIn);
            uint256 inputMaturity;
            if (payment.payer != address(0)) {
                inputMaturity = IToken(TOKEN).maturityOf(payment.payer, idIn);
                uint256 expectedSupply = IERC1155Supply(TOKEN).totalSupply(idIn) - amountIn;
                IUniversalTokenRouter(payment.utr).pay(payment.payer, address(this), 1155, TOKEN, idIn, amountIn);
                require(IERC1155Supply(TOKEN).totalSupply(idIn) <= expectedSupply, 'PoolBase: INSUFFICIENT_PAYMENT');
            } else {
                inputMaturity = IToken(TOKEN).maturityOf(msg.sender, idIn);
                IToken(TOKEN).burn(msg.sender, idIn, amountIn);
                payment.payer = msg.sender;
            }
            amountOut = _maturityPayoff(config, inputMaturity, amountOut);
        }

        uint256 maturity;
        if (param.sideOut == SIDE_R) {
            TransferHelper.safeTransfer(config.TOKEN_R, payment.recipient, amountOut);
        } else {
            uint256 idOut = _packID(address(this), param.sideOut);
            maturity = uint32(block.timestamp) + config.MATURITY;
            IToken(TOKEN).mintLock(payment.recipient, idOut, amountOut, uint32(maturity), "");
        }

        emit Swap(
            payment.payer,
            payment.recipient,
            Math.max(param.sideIn, param.sideOut),
            param.sideIn,
            param.sideOut,
            maturity,
            amountIn,
            amountOut,
            price
        );
    }

    function getStates()
        external
        view
        returns (uint256 R, uint256 a, uint256 b, uint32 i, uint32 f)
    {
        Config memory config = loadConfig();
        R = IERC20(config.TOKEN_R).balanceOf(address(this));
        i = s_lastInterestTime;
        a = s_a;
        f = s_lastPremiumTime & F_MASK;
        b = s_b;
    }

    /**
     * @dev against read-only reentrancy
     */
    function ensureStateIntegrity() public view {
        uint256 f = s_lastPremiumTime;
        require(f & 1 == 0 && f > 0, 'PoolBase: STATE_INTEGRITY');
    }

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

    function _packID(address pool, uint256 side) internal pure returns (uint256 id) {
        id = (side << 160) | uint160(pool);
    }

    function _swap(Config memory config, Param memory param) internal virtual returns (Result memory);
    function _maturityPayoff(Config memory config, uint256 maturity, uint256 amountOut) internal view virtual returns (uint256);
}

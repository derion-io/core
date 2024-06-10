// SPDX-License-Identifier: BSL-1.1
pragma solidity 0.8.20;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";
import "@uniswap/lib/contracts/libraries/TransferHelper.sol";
import "solidity-bytes-utils/contracts/BytesLib.sol";

import "@derivable/utr/contracts/interfaces/IUniversalTokenRouter.sol";

import "./interfaces/IPoolFactory.sol";
import "./interfaces/IToken.sol";
import "./interfaces/IPool.sol";
import "./subs/Constants.sol";
import "./subs/Storage.sol";

/// @title The base logic code for state initialization and token payment. 
/// @author Derivable Labs
/// @notice PoolBase is extended by PoolLogic to form the Pool contract.
abstract contract PoolBase is IPool, ERC1155Holder, Storage, Constants {
    struct Result {
        uint256 amountIn;
        uint256 amountOut;
        uint256 price;
    }
    
    uint32 constant internal F_MASK = ~uint32(1);
    address immutable internal TOKEN;

    /// Position event for each postion mint/burn
    event Position(
        address indexed payer,
        address indexed recipient,
        address indexed index,
        uint256 id,
        uint256 amount,
        uint256 maturity,
        uint256 indexPrice,
        uint256 valueR
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

    /// @param token Token 1155 for pool's derivatives
    constructor(address token) {
        require(token != address(0), "PoolBase: ZERO_ADDRESS");
        TOKEN = token;
    }

    /// Initializes the pool state before any interaction can be made.
    /// @param state initial state of the pool
    /// @param payment payment info
    function init(State memory state, Payment memory payment) external {
        require(s_lastInterestTime == 0, "PoolBase: ALREADY_INITIALIZED");
        uint256 R = state.R;
        uint256 a = state.a;
        uint256 b = state.b;
        require(R > 0 && a > 0 && b > 0, "PoolBase: ZERO_PARAM");

        s_lastInterestTime = uint32(block.timestamp);
        s_a = uint224(a);
        s_lastPremiumTime = uint32(block.timestamp & F_MASK);
        s_b = uint224(b);

        Config memory config = loadConfig();
        address payer;

        if (payment.payer.length > 0) {
            uint256 expected = R + IERC20(config.TOKEN_R).balanceOf(address(this));
            payer = BytesLib.toAddress(payment.payer, 0);
            if (payment.payer.length == 20) {
                payment.payer = abi.encode(payer, address(this), 20, config.TOKEN_R, 0);
            }
            IUniversalTokenRouter(payment.utr).pay(payment.payer, R);
            require(expected <= IERC20(config.TOKEN_R).balanceOf(address(this)), "PoolBase: INSUFFICIENT_PAYMENT");
        } else {
            TransferHelper.safeTransferFrom(config.TOKEN_R, msg.sender, address(this), R);
            payer = msg.sender;
        }

        uint256 idA = _packID(address(this), SIDE_A);
        uint256 idB = _packID(address(this), SIDE_B);
        uint256 idC = _packID(address(this), SIDE_C);

        (uint256 price,) = _fetch(config.FETCHER, uint256(config.ORACLE));
        (uint256 rA, uint256 rB) = _evaluate(_xk(config, price), state);
        require(rA >= MINIMUM_RESERVE, 'PoolBase: MINIMUM_RESERVE_A');
        require(rB >= MINIMUM_RESERVE, 'PoolBase: MINIMUM_RESERVE_B');
        uint256 rC = R - rA - rB;
        require(rC >= MINIMUM_RESERVE, 'PoolBase: MINIMUM_RESERVE_C');

        // mint tokens to recipient
        uint32 maturity = uint32(block.timestamp + config.MATURITY);
        IToken(TOKEN).mint(payment.recipient, idA, rA, maturity, "");
        IToken(TOKEN).mint(payment.recipient, idB, rB, maturity, "");
        IToken(TOKEN).mint(payment.recipient, idC, rC, maturity, "");
        address index = address(uint160(uint256(config.ORACLE)));
        emit Position(payer, payment.recipient, index, idA, rA, maturity, price, rA);
        emit Position(payer, payment.recipient, index, idB, rB, maturity, price, rB);
        emit Position(payer, payment.recipient, index, idC, rC, maturity, price, rC);
    }

    /// Performs single direction (1 side in, 1 side out) state transistion
    /// @param param swap param
    /// @param payment payment param
    /// @return amountIn the actual amount in
    /// @return amountOut the actual amount out
    /// @return price the price fetched and selected from oracle
    function swap(
        Param memory param,
        Payment memory payment
    ) external override nonReentrant returns (uint256 amountIn, uint256 amountOut, uint256 price) {
        Config memory config = loadConfig();

        Result memory result = _swap(config, param);
        (amountIn, amountOut, price) = (result.amountIn, result.amountOut, result.price);

        address payer;
        if (param.sideIn == SIDE_R) {
            if (payment.payer.length > 0) {
                payer = BytesLib.toAddress(payment.payer, 0);
                // prepare the utr payload
                if (payment.payer.length == 20) {
                    payment.payer = abi.encode(payer, address(this), 20, config.TOKEN_R, 0);
                }
                uint256 expected = amountIn + IERC20(config.TOKEN_R).balanceOf(address(this));
                // pull payment
                IUniversalTokenRouter(payment.utr).pay(payment.payer, amountIn);
                require(expected <= IERC20(config.TOKEN_R).balanceOf(address(this)), "PoolBase: INSUFFICIENT_PAYMENT");
            } else {
                TransferHelper.safeTransferFrom(config.TOKEN_R, msg.sender, address(this), amountIn);
                payer = msg.sender;
            }
        } else {
            uint256 idIn = _packID(address(this), param.sideIn);
            uint256 inputMaturity;
            if (payment.payer.length > 0) {
                // clear the pool first to prevent maturity griefing attacks
                uint256 balance = IERC1155Supply(TOKEN).balanceOf(address(this), idIn);
                if (balance > 0) {
                    IToken(TOKEN).burn(address(this), idIn, balance);
                }
                payer = BytesLib.toAddress(payment.payer, 0);
                // prepare the utr payload
                if (payment.payer.length == 20) {
                    payment.payer = abi.encode(payer, address(this), 1155, TOKEN, idIn);
                }
                // pull payment
                IUniversalTokenRouter(payment.utr).pay(payment.payer, amountIn);
                balance = IERC1155Supply(TOKEN).balanceOf(address(this), idIn);
                require(amountIn <= balance, "PoolBase: INSUFFICIENT_PAYMENT");
                // query the maturity first before burning
                inputMaturity = IToken(TOKEN).maturityOf(address(this), idIn);
                // burn the 1155 token
                IToken(TOKEN).burn(address(this), idIn, balance);
            } else {
                // query the maturity first before burning
                inputMaturity = IToken(TOKEN).maturityOf(msg.sender, idIn);
                // burn the 1155 token directly from msg.sender
                IToken(TOKEN).burn(msg.sender, idIn, amountIn);
                payer = msg.sender;
            }
            uint256 valueR = param.sideOut == SIDE_R ? amountOut : 0;
            emit Position(
                payer,
                address(0),  // burn from payer
                address(uint160(uint256(config.ORACLE))),
                idIn,
                amountIn,
                inputMaturity,
                price,
                valueR
            );
            amountOut = _maturityPayoff(config, inputMaturity, amountOut);
        }

        uint256 maturity;
        if (param.sideOut == SIDE_R) {
            TransferHelper.safeTransfer(config.TOKEN_R, payment.recipient, amountOut);
        } else {
            uint256 idOut = _packID(address(this), param.sideOut);
            maturity = uint32(block.timestamp) + config.MATURITY;
            IToken(TOKEN).mint(payment.recipient, idOut, amountOut, uint32(maturity), "");
            uint256 valueR = param.sideIn == SIDE_R ? amountIn : 0;
            emit Position(
                payer,
                payment.recipient,
                address(uint160(uint256(config.ORACLE))),
                idOut,
                amountOut,
                maturity,
                price,
                valueR
            );
        }
    }

    /// @return R pool reserve
    /// @return a LONG coefficient
    /// @return b SHORT coefficient
    /// @return i lastInterestTime
    /// @return f lastPremiumTime
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

    // IERC165-supportsInterface
    function supportsInterface(bytes4 interfaceId) public view virtual override returns (bool) {
        return
            interfaceId == 0x61206120 ||
            super.supportsInterface(interfaceId);
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

    function _swap(Config memory config, Param memory param) internal virtual returns (Result memory);
    function _fetch(address fetcher, uint256 ORACLE) internal virtual returns (uint256 twap, uint256 spot);
    function _evaluate(uint256 xk, State memory state) internal pure virtual returns (uint256 rA, uint256 rB);
    function _xk(Config memory config, uint256 price) internal pure virtual returns (uint256 xk);

    function _maturityPayoff(
        Config memory config, uint256 maturity, uint256 amountOut
    ) internal view virtual returns (uint256);

    function _packID(address pool, uint256 side) internal pure returns (uint256 id) {
        id = (side << 160) | uint160(pool);
    }
}

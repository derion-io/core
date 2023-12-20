// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.20;

import {TickMath} from "@uniswap/v3-core/contracts/libraries/TickMath.sol";
import {FullMath} from "@uniswap/v3-core/contracts/libraries/FullMath.sol";
import {IUniswapV3Factory} from "@uniswap/v3-core/contracts/interfaces/IUniswapV3Factory.sol";

import {SelfPermit} from "@uniswap/v3-periphery/contracts/base/SelfPermit.sol";
import {LiquidityAmounts} from "@uniswap/v3-periphery/contracts/libraries/LiquidityAmounts.sol";
import "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {UniKey, LiquidityManagement} from "./LiquidityManagement.sol";
import "./interfaces/IUniV3ERC20WrapperFactory.sol";
import "@openzeppelin/contracts/utils/Create2.sol";
import "./UniV3ERC20Wrapper.sol";


contract UniV3ERC20WrapperFactory is
    SelfPermit,
    LiquidityManagement,
    IUniV3ERC20WrapperFactory,
    ERC1155Holder
{
    uint256 internal constant MIN_INITIAL_SHARES = 1e9;

    /// -----------------------------------------------------------
    /// Storage variables
    /// -----------------------------------------------------------


    /// -----------------------------------------------------------
    /// Modifiers
    /// -----------------------------------------------------------

    modifier checkDeadline(uint256 deadline) {
        require(block.timestamp <= deadline, "OLD");
        _;
    }

    /// -----------------------------------------------------------
    /// Constructor
    /// -----------------------------------------------------------

    constructor(
        IUniswapV3Factory factory_,
        address utr_
    ) LiquidityManagement(factory_, utr_) {}

    /// -----------------------------------------------------------
    /// External functions
    /// -----------------------------------------------------------

    function deposit(DepositParams calldata params)
        external
        payable
        virtual
        override
        checkDeadline(params.deadline)
        returns (
            uint256 shares,
            uint128 addedLiquidity,
            uint256 amount0,
            uint256 amount1
        )
    {
        (uint128 existingLiquidity, , , , ) = params.key.pool.positions(
            keccak256(
                abi.encodePacked(
                    address(this),
                    params.key.tickLower,
                    params.key.tickUpper
                )
            )
        );
        (addedLiquidity, amount0, amount1) = _addLiquidity(
            LiquidityManagement.AddLiquidityParams({
                key: params.key,
                recipient: address(this),
                payer: params.payer,
                amount0Desired: params.amount0Desired,
                amount1Desired: params.amount1Desired,
                amount0Min: params.amount0Min,
                amount1Min: params.amount1Min
            })
        );
        shares = _mintShares(
            params.key,
            params.recipient,
            addedLiquidity,
            existingLiquidity
        );

        emit Deposit(
            params.payer,
            params.recipient,
            keccak256(abi.encode(params.key)),
            addedLiquidity,
            amount0,
            amount1,
            shares
        );
    }

    function withdraw(WithdrawParams calldata params)
        external
        virtual
        override
        checkDeadline(params.deadline)
        returns (
            uint128 removedLiquidity,
            uint256 amount0,
            uint256 amount1
        )
    {
        IUniV3ERC20Wrapper shareToken = getToken(params.key);
        require(address(shareToken) != address(0), "WHAT");

        uint256 currentTotalSupply = shareToken.totalSupply();
        (uint128 existingLiquidity, , , , ) = params.key.pool.positions(
            keccak256(
                abi.encodePacked(
                    address(this),
                    params.key.tickLower,
                    params.key.tickUpper
                )
            )
        );

        // burn shares
        require(params.shares > 0, "0");
        shareToken.burn(msg.sender, params.shares);
        // at this point of execution we know param.shares <= currentTotalSupply
        // since otherwise the burn() call would've reverted

        // burn liquidity from pool
        // type cast is safe because we know removedLiquidity <= existingLiquidity
        removedLiquidity = uint128(
            FullMath.mulDiv(
                existingLiquidity,
                params.shares,
                currentTotalSupply
            )
        );
        // burn liquidity
        // tokens are now collectable in the pool
        (amount0, amount1) = params.key.pool.burn(
            params.key.tickLower,
            params.key.tickUpper,
            removedLiquidity
        );
        // collect tokens and give to msg.sender
        (amount0, amount1) = params.key.pool.collect(
            params.recipient,
            params.key.tickLower,
            params.key.tickUpper,
            uint128(amount0),
            uint128(amount1)
        );
        require(
            amount0 >= params.amount0Min && amount1 >= params.amount1Min,
            "SLIP"
        );

        emit Withdraw(
            msg.sender,
            params.recipient,
            keccak256(abi.encode(params.key)),
            removedLiquidity,
            amount0,
            amount1,
            params.shares
        );
    }

    function compound(UniKey calldata key)
        external
        virtual
        override
        returns (
            uint128 addedLiquidity,
            uint256 amount0,
            uint256 amount1
        )
    {
        // trigger an update of the position fees owed snapshots if it has any liquidity
        key.pool.burn(key.tickLower, key.tickUpper, 0);
        (, , , uint128 cachedFeesOwed0, uint128 cachedFeesOwed1) = key
            .pool
            .positions(
                keccak256(
                    abi.encodePacked(
                        address(this),
                        key.tickLower,
                        key.tickUpper
                    )
                )
            );

        /// -----------------------------------------------------------
        /// amount0, amount1 are multi-purposed, see comments below
        /// -----------------------------------------------------------
        amount0 = cachedFeesOwed0;
        amount1 = cachedFeesOwed1;

        /// -----------------------------------------------------------
        /// amount0, amount1 now store the updated amounts of fee owed
        /// -----------------------------------------------------------

        // the fee is likely not balanced (i.e. tokens will be left over after adding liquidity)
        // so here we compute which token to fully claim and which token to partially claim
        // so that we only claim the amounts we need

        {
            (uint160 sqrtRatioX96, , , , , , ) = key.pool.slot0();
            uint160 sqrtRatioAX96 = TickMath.getSqrtRatioAtTick(key.tickLower);
            uint160 sqrtRatioBX96 = TickMath.getSqrtRatioAtTick(key.tickUpper);

            // compute the maximum liquidity addable using the accrued fees
            uint128 maxAddLiquidity = LiquidityAmounts.getLiquidityForAmounts(
                sqrtRatioX96,
                sqrtRatioAX96,
                sqrtRatioBX96,
                amount0,
                amount1
            );

            // compute the token amounts corresponding to the max addable liquidity
            (amount0, amount1) = LiquidityAmounts.getAmountsForLiquidity(
                sqrtRatioX96,
                sqrtRatioAX96,
                sqrtRatioBX96,
                maxAddLiquidity
            );
        }

        /// -----------------------------------------------------------
        /// amount0, amount1 now store the amount of fees to claim
        /// -----------------------------------------------------------

        // the actual amounts collected are returned
        // tokens are transferred to address(this)
        (amount0, amount1) = key.pool.collect(
            address(this),
            key.tickLower,
            key.tickUpper,
            uint128(amount0),
            uint128(amount1)
        );

        // add fees to Uniswap pool
        (addedLiquidity, amount0, amount1) = _addLiquidity(
            LiquidityManagement.AddLiquidityParams({
                key: key,
                recipient: address(this),
                payer: address(this),
                amount0Desired: amount0,
                amount1Desired: amount1,
                amount0Min: 0,
                amount1Min: 0
            })
        );

        emit Compound(
            msg.sender,
            keccak256(abi.encode(key)),
            addedLiquidity,
            amount0,
            amount1
        );
    }

    function deployWrapperToken(UniKey calldata key)
        public
        returns (IUniV3ERC20Wrapper token)
    {
       bytes32 keyHash = keccak256(abi.encode(key));

        token = new UniV3ERC20Wrapper{salt: keyHash}(address(this), key);

        emit NewToken(
            token,
            keyHash,
            key.pool,
            key.tickLower,
            key.tickUpper
        );
    }

    /// -----------------------------------------------------------------------
    /// View functions
    /// -----------------------------------------------------------------------

    // IERC165-supportsInterface
    function supportsInterface(bytes4 interfaceId) public view virtual override returns (bool) {
        return
            interfaceId == 0x61206120 ||
            super.supportsInterface(interfaceId);
    }

    function getToken(UniKey calldata key)
        public
        view
        returns (IUniV3ERC20Wrapper token)
    {
        bytes32 keyHash = keccak256(abi.encode(key));
        token = IUniV3ERC20Wrapper(address(uint160(uint(
            keccak256(
                abi.encodePacked(
                    bytes1(0xff),
                    address(this),
                    keyHash,
                    keccak256(abi.encodePacked(
                        type(UniV3ERC20Wrapper).creationCode,
                        abi.encode(address(this), key)
                    ))
                )
            )
        ))));

        uint256 tokenCodeLength;
        assembly {
            tokenCodeLength := extcodesize(token)
        }

        if (tokenCodeLength == 0) {
            return IUniV3ERC20Wrapper(address(0));
        }
    }

    /// -----------------------------------------------------------
    /// Internal functions
    /// -----------------------------------------------------------

    /// @notice Mints share tokens to the recipient based on the amount of liquidity added.
    /// @param key The Bunni position's key
    /// @param recipient The recipient of the share tokens
    /// @param addedLiquidity The amount of liquidity added
    /// @param existingLiquidity The amount of existing liquidity before the add
    /// @return shares The amount of share tokens minted to the sender.
    function _mintShares(
        UniKey calldata key,
        address recipient,
        uint128 addedLiquidity,
        uint128 existingLiquidity
    ) internal virtual returns (uint256 shares) {
        IUniV3ERC20Wrapper shareToken = getToken(key);
        require(address(shareToken) != address(0), "WHAT");

        uint256 existingShareSupply = shareToken.totalSupply();
        if (existingShareSupply == 0) {
            // no existing shares, bootstrap at rate 1:1
            shares = addedLiquidity;
            // prevent first staker from stealing funds of subsequent stakers
            // see https://code4rena.com/reports/2022-01-sherlock/#h-01-first-user-can-steal-everyone-elses-tokens
            require(shares > MIN_INITIAL_SHARES, "SMOL");
        } else {
            // shares = existingShareSupply * addedLiquidity / existingLiquidity;
            shares = FullMath.mulDiv(
                existingShareSupply,
                addedLiquidity,
                existingLiquidity
            );
            require(shares != 0, "0");
        }

        // mint shares to sender
        shareToken.mint(recipient, shares);
    }
}
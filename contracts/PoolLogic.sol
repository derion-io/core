// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "@uniswap/lib/contracts/libraries/TransferHelper.sol";
import '@uniswap/v3-core/contracts/libraries/FullMath.sol';
import "abdk-libraries-solidity/ABDKMath64x64.sol";
import "./interfaces/IHelper.sol";
import "./interfaces/IFetcher.sol";
import "./interfaces/IPositioner.sol";
import "./PoolBase.sol";
import "hardhat/console.sol";

/// @title Mathematic and finance logic of Derivable pool.
/// @author Derivable Labs
/// @notice Defines the state transistion calculation. The main logic is
///         implemented in _swap function which defines a single direction state
///         transistion (1 side in and 1 side out).
///         A Helper contract is used for target (after) state calculation.
///         This contract call is trustless, and provided by user.
contract PoolLogic is PoolBase {
    address immutable internal FEE_TO;
    uint256 immutable internal FEE_RATE;

    /// @param feeTo fee recipient address
    /// @param feeRate fee rate
    constructor(
        address feeTo,
        uint256 feeRate
    ) {
        require(feeTo != address(0), "ZERO_ADDRESS");
        FEE_TO = feeTo;
        FEE_RATE = feeRate;
    }

    /// Performs single direction (1 side in, 1 side out) state transistion
    /// @param param swap param
    /// @param payment payment param
    function transition(
        Param memory param,
        Payment memory payment
    ) external override {
        _nonReentrantBefore();
        Config memory config = loadConfig();
        Receipt memory receipt = _transition(config, param);
        (bool success, bytes memory result) = config.POSITIONER.delegatecall(
            abi.encodeWithSelector(
                IPositioner.handleTransition.selector,
                config,
                param.payload,
                payment,
                receipt
            )
        );
        if (!success) {
            assembly {
                revert(add(result,32),mload(result))
            }
        }
        _nonReentrantAfter();
        assembly {
            return(add(result,32),mload(result))
        }
    }

    function _transition(
        Config memory config,
        Param memory param
    ) internal returns (Receipt memory receipt) {
        State memory state = State(_reserve(config.TOKEN_R), s_a, s_b);
        // [PRICE SELECTION]
        uint256 xk; uint256 rA; uint256 rB;
        (xk, rA, rB, receipt.price) = _selectPrice(config, state, param.payload);
        // [RISK MANAGEMENT FEE]
        unchecked {
            // track the rC before interest and premium for fee calculation
            uint256 rC = state.R - rA - rB;
            // [INTEREST]
            if (config.INTEREST_HL > 0) {
                uint256 elapsed = uint32(block.timestamp) - s_lastInterestTime;
                if (elapsed > 0) {
                    uint256 rate = _decayRate(elapsed, config.INTEREST_HL);
                    uint256 rAF = FullMath.mulDivRoundingUp(rA, rate, Q64);
                    uint256 rBF = FullMath.mulDivRoundingUp(rB, rate, Q64);
                    if (rAF < rA || rBF < rB) {
                        // interest cannot exhaust an entire side
                        rA = Math.max(rAF, 1);
                        rB = Math.max(rBF, 1);
                        s_lastInterestTime = uint32(block.timestamp);
                    }
                }
            }
            // [PREMIUM]
            if (config.PREMIUM_HL > 0) {
                uint256 diff = rA > rB ? rA - rB : rB - rA;
                if (diff > 1) {
                    --diff; // premium cannot exhaust an entire side
                    uint256 R = state.R;
                    uint256 elapsed = uint32(block.timestamp) - (s_lastPremiumTime);
                    if (elapsed > 0) {
                        uint256 premiumHL = FullMath.mulDivRoundingUp(config.PREMIUM_HL >> 1, R, rA + rB);
                        uint256 rate = _decayRate(elapsed, premiumHL);
                        uint256 premium = diff >> 1;
                        premium -= FullMath.mulDivRoundingUp(premium, rate, Q64);
                        if (premium > 0) {
                            if (rA > rB) {
                                rB += premium;
                                rA -= premium;
                            } else {
                                rA += premium;
                                rB -= premium;
                            }
                            s_lastPremiumTime += uint32(elapsed);
                        }
                    }
                }
            }
            // [FEE]
            if (FEE_RATE > 0) {
                // rA and rB cannot be increased by interest and premium
                uint256 fee = (state.R - rA - rB - rC) / FEE_RATE;
                if (fee > 0) {
                    TransferHelper.safeTransfer(config.TOKEN_R, FEE_TO, fee);
                    state.R -= fee;
                }
            }
        }
        receipt.R = state.R;
        receipt.rA = rA;
        receipt.rB = rB;
        // [CALCULATION]
        State memory state1 = IHelper(param.helper).updateState(
            Slippable(xk, state.R, rA, rB),
            param.payload
        );
        // [STATE UPDATE]
        require(state1.a <= type(uint224).max, "STATE1_OVERFLOW_A");
        require(state1.b <= type(uint224).max, "STATE1_OVERFLOW_B");
        s_a = uint224(state1.a);
        s_b = uint224(state1.b);
        // [TRANSITION RECEIPT]
        (uint256 rA1, uint256 rB1) = _evaluate(xk, state1);
        receipt.R1 = state1.R;
        receipt.rA1 = rA1;
        receipt.rB1 = rB1;
    }

    function _selectPrice(
        Config memory config,
        State memory state,
        bytes memory payload
    ) internal view returns (uint256 xk, uint256 rA, uint256 rB, uint256 price) {
        (uint256 twap, uint256 spot) = IPositioner(config.POSITIONER).fetchPrices(
            uint256(config.ORACLE),
            payload
        );
        xk = _xk(config, price = twap);
        (rA, rB) = _evaluate(xk, state);
        if (twap != spot) {
            uint256 xkSpot = _xk(config, spot);
            (uint256 rASpot, uint256 rBSpot) = _evaluate(xkSpot, state);
            if (rASpot + rBSpot < rA + rB) {
                return (xkSpot, rASpot, rBSpot, spot);
            }
        }
    }

    function _reserve(address TOKEN_R) internal view returns (uint256 R) {
        return IERC20(TOKEN_R).balanceOf(address(this));
    }

    function _decayRate (
        uint256 elapsed,
        uint256 halfLife
    ) internal pure returns (uint256 rateX64) {
        int128 rate = ABDKMath64x64.exp_2(-int128(int((elapsed << 64) / halfLife)));
        return uint256(int(rate));
    }

    function _xk(Config memory config, uint256 price) internal pure returns (uint256 xk) {
        uint256 MARK = config.MARK;
        bool inverted = MARK < price;
        if (inverted) {
            // keep the price/MARK <= 1 to avoid overflow
            (MARK, price) = (price, MARK);
        }
        xk = _powu(FullMath.mulDiv(Q128, price, MARK), config.K);
        if (xk == 0) {
            // de-power the pool on underflow
            xk = _powUpTo(price, MARK, config.K);
        }
        if (inverted) {
            xk = Q256M / xk;
        }
    }

    /// find the largest number p in 0..y that (a/b)^p > 0,
    /// and return (a/b)^p
    function _powUpTo(uint256 a, uint256 b, uint256 y) internal pure returns (uint256 z) {
        z = Q128;
        while (y > 0) {
            uint256 zx = FullMath.mulDiv(z, a, b);
            if (zx == 0) {
                return z;
            }
            z = zx;
            --y;
        }
    }

    function _powu(uint256 x, uint256 y) internal pure returns (uint256 z) {
        // Calculate the first iteration of the loop in advance.
        z = y & 1 > 0 ? x : Q128;
        // Equivalent to "for(y /= 2; y > 0; y /= 2)" but faster.
        for (y >>= 1; y > 0; y >>= 1) {
            x = FullMath.mulDiv(x, x, Q128);
            // Equivalent to "y % 2 == 1" but faster.
            if (y & 1 > 0) {
                z = FullMath.mulDiv(z, x, Q128);
            }
        }
    }

    function _evaluate(uint256 xk, State memory state) internal pure returns (uint256 rA, uint256 rB) {
        rA = _r(xk, state.a, state.R);
        rB = _r(Q256M/xk, state.b, state.R);
    }

    function _r(uint256 xk, uint256 v, uint256 R) internal pure returns (uint256 r) {
        r = FullMath.mulDiv(v, xk, Q128);
        if (r > R >> 1) {
            uint256 denominator = FullMath.mulDiv(v, xk, Q126);
            uint256 minuend = FullMath.mulDivRoundingUp(R, R, denominator);
            r = R - minuend;
        }
    }
}

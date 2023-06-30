# Derivable Contracts

# Contracts
## Core Protocol
* `Token`: a single ERC-1155 token shared by all Derivable pools.
* `PoolFactory`: factory contract to deploy Derivable pool using ERC-3448.
* `PoolBase`: base implementation of Derivable pool.
* `PoolLogic`: mathematic and finance logic of Derivable pool.
* `subs/Constants`: shared constants between multiple contracts.
* `subs/Storage`: Derivable pool storage variables.

## Support and Peripheral
The following contracts are not part of the core protocol so user's funds should be completely safe even when they are malformed or malicious.
* `TokenDescriptor`: view-only, replacable, ERC-1155 metadata descriptor.
* `FeeReceiver`: protocol fee receiver and collector. Does not affect Derivable pool users, only affects protocol fee recipient, which initialy is Derivable Labs, and later will be replaced by a DAO.
* `Helper`: deal with market slippage to achieve the desired state transition. Provided by user in each state transition, and can be malformed and malicious.
* `View`: supporting contract for front-end code using state override for calculation.
* `Universal Token Router` ([ERC-6120](https://eips.ethereum.org/EIPS/eip-6120))  provided by user in each state transition. Can be malicious.

# Design

Derivable pool is a liquidity pool of perpetual derivatives for a single leverage. Participants come from 3 sides:
* long traders: exposed to the upside of its power perpetual
* short traders: exposed to the downside of its power perpetual
* liquidity providers: provide liquidity for the other 2 sides and earn the interest and spread

## Pool Configs

Each pool is identified by its immutable configs:
* ORACLE: UniswapV3 pool, QuoteTokenIndex, and TWAP's window.
* K: twice the leverage power.
* TOKEN_R: the reserve token (also the settlement currency).
* MARK: square-root of the mark (or referrent) price.
* INTEREST_HL: decay half-life for the LP interest rate (in seconds).
* PREMIUM_RATE: the input premium rate (x128).
* MATURITY: minimum maturity duration for new position (in seconds).
* MATURITY_VEST: the vesting duration of the maturity payoff (in seconds).
* MATURITY_RATE: the maximum payoff rate before the position is fully matured (x128).
* OPEN_RATE: the input rate when opening Long and Short position (x128).

## Pool Creation

Pool creation takes 2 steps:
* deployment (by anyone): clone the ERC-3448 contract with pool configurations. After this step, pool is in `non-integrity` state an cannot be interacted with without initialization first.
* initialization (by anyone): receive the first reserve token amount and init the pool states. After this, the pool is unlocked for liquidity and trading.

There's no special benefit or permission for pool deployer or initiator.

## Pool State
A valid state of a pool is $〈R,a,b〉$ where:
* R: token reserve of the pool (`TOKEN_R.balanceOf(pool)`)
* a: (storage) coefficient of the LONG side
* b: (storage) coefficient of the SHORT side

## Derivative Payoff
At any time or market state, the pool reserve is split between 3 sides: $r_A$, $r_B$ and $r_C$.

With $\sqrt{P}$ is the result of the double prices system selection, we have: $x = {\sqrt{P}\over MARK}$

Long payoff:
$$
r_A=\begin{cases}
    ax^K                    &\text{for }ax^K<{R\over 2} \\
    R-\dfrac{R^2}{4ax^K}    &\text{otherwise}
\end{cases}
$$

Short payoff:
$$
r_B=\begin{cases}
    bx^{-K}                 &\text{for }bx^{-K}<{R\over 2} \\
    R-\dfrac{R^2}{4bx^{-K}} &\text{otherwise}
\end{cases}
$$

LP payoff: $r_C = R - r_A - r_B$

Payoff for each position (balance) is calculated based on its total supply, pro-rata.

![Asymptotic Power Curve](https://files.gitbook.com/v0/b/gitbook-x-prod.appspot.com/o/spaces%2FpouuXNBk9RhrfwmGohvR%2Fuploads%2F5cmN7o3XYDdDn70iDtD7%2Fimage.png?alt=media&token=c30553d8-d073-4d40-9fbc-31c100890c30)

## Price Oracle and Selection
The first public version of Derivable protocol supports UniswapV3 oracle as the only price source. Both TWAP and SPOT prices are ultilized using the double price system, which enforces the state transitioner to use the less beneficial price of the two.

Pool's swap is a single direction state transition, so price can be selected before the actual transition happens. The rules are:
* if the output is Short, or input is Long: `price = min(twap, spot)`
* if the output is LP and $r_A > r_B$: `price = min(twap, spot)`
* if the output is R and $r_A < r_B$: `price = min(twap, spot)`
* otherwise, `price = max(twap, spot)`

## State Transition

In state transistions, all core calculation is peformed one side (from state to payoff) to prevent rounding error and exploits. Reverse calculations are off-loaded to client and Helper contract for user desirable input and output behavior.

**Note**: Helper contract call can be malicious, but the pool is expected to be safe regardless of what Helper contract returns.

**Note**: the entire state transition process is locked for reentrancy. 3rd-party application contracts querying Derivable pool must call `ensureStateIntegrity()` to prevent read-only reentrancy attacks.

1. Load the current state: $s_0 = 〈R_0,a_0,b_0〉$
2. Apply LP interest rate to current state ($s_0$)
3. Price selection based on swap direction
4. Calculate current payoff: $p_0 = 〈R_0, r_{A0}, r_{B0}〉$
5. Apply the protocol fee to current payoff $p_0$, and transfer the protocol fee out to `FeeReceiver`
6. Call `Helper.swapToState` with input `payload` to calculate the target state ($s_1$)
7. Calculate target payoff: $p_1 = 〈R_1, r_{A1}, r_{B1}〉$
8. Calculate the payoff deltas for `amountIn` and `amountOut`, and verify that there's only one side in.
9. Increase the `amountIn` for premium and open rate, decrease the `amountOut`  for maturity payoff rate
10. Update the pool state storage to $s_1$
11. Transfer the `amountIn` in, and transfer the `amountOut` out.

## Interest & Fee (Decay Rate)

**LP Interest** is charged from both Long and Short sides to the LP side, by applying the decay rate directly to the 2 coefficients $a_0$ and $b_0$ before the price is selected. **LP Interest** decay does not produce any token transfer, and the total pool reserve is unaffected.

**Protocol Fee** is also charged from both Long and Short sides to `FeeReceiver`, but by applying the decay rate to the current payoff reserves $r_{A0}$ and $r_{B0}$, (so it is not affected by the deleverage state of each curve like LP Interest). **Protocol Fee** decay does produce an token transfer to `FeeReceiver` in each transaction.

Protocol's decay halflife is not configured by pool creator, but is calculated from Interest's decay halflife and protocol configured `FeeRate`:
$$FeeHL = InterestHL \times FeeRate$$

![Interest and Fee](https://files.gitbook.com/v0/b/gitbook-x-prod.appspot.com/o/spaces%2FpouuXNBk9RhrfwmGohvR%2Fuploads%2FxePn9C1OhWNeLO6CihhH%2Ffee.gif?alt=media&token=15eb6b9e-7f07-4c33-89f7-1d8666427dd4)

## Input Rate

Input rates are rate applied to Long and Short opening state transition's input token amount, including **PremiumRate** and **OpenRate**.

**OpenRate** is a percentage-based rate to charge fee on Long and Short position opening.

**PremiumRate** is applied based pool risk factor of the target payoff after the state transition.

$$RiskFactor = \dfrac{r_{A1} - r_{B1}}{r_{C1}}$$

Input Rate to opening a Long position:
$$InputRate = OpenRate \times min(1, \dfrac{PremiumRate}{RiskFactor})$$

Input Rate to opening a Short position:
$$InputRate = OpenRate \times min(1, \dfrac{PremiumRate}{-RiskFactor})$$

The actual token amount transactor has to pay is: $amountIn / InputRate$

## Ouput Rate (Maturity)

Output rate is applied to all position closing state transition's output token amount, which is affected by maturity payoff.

Each pool position is opened with a maturity date recorded along with its balance. The mimimum maturity date for newly open position is `maturity = MATURITY + block.timestamp` with `MATURIY` is a pool configuration.

The Output Rate (payoff) before maturity date is calculated as follow:

$$Elapsed = max(0, MATURITY + now() - maturity)$$
$$OutputRate = min(1, {Elapsed\over {MATURITY\_VEST}})\times MATURITY\_RATE$$

![Maturity](https://files.gitbook.com/v0/b/gitbook-x-prod.appspot.com/o/spaces%2FpouuXNBk9RhrfwmGohvR%2Fuploads%2FfVXg9D2OP1YeJlWLSxUX%2Fimage.png?alt=media&token=45059a6c-0fac-4568-892c-3bd8b50a68d2)

## Token Payment
There are two methods to transfer token into Derivable pool for state transistion:
* `TransferHelper.safeTransferFrom(msg.sender, ...)` from the pool, which requires direct user token approval to each pool. This method is designed for inter-contract interaction, and not recommended for interactive users.
* [ERC-6120](https://eips.ethereum.org/EIPS/eip-6120) or its interface can be used for interactive token payment to the pools.

# 3rd-party Libs
* `ABDKMath64x64` by [ABDK Consulting](https://github.com/abdk-consulting).
* `FullMath` by [Uniswap](https://github.com/Uniswap)
* `OracleLibrary` by [Uniswap](https://github.com/Uniswap)
* `MetaProxyFactory` from [ERC-3448](https://eips.ethereum.org/EIPS/eip-3448)
* Various from [OpenZeppelin](https://github.com/OpenZeppelin)

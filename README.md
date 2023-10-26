# Derivable Contracts

# Contracts
## Core Protocol
* `Token`: a single ERC-1155 token shared by all Derivable pools.
* `PoolFactory`: factory contract to deploy Derivable pool using ERC-3448.
* `Fetcher`: fetcher logic for Uniswap V3 oracle.
* `PoolBase`: base implementation of Derivable pool.
* `PoolLogic`: mathematic and finance logic of Derivable pool.
* `subs/Constants`: shared constants between multiple contracts.
* `subs/Storage`: Derivable pool storage variables.

# 3rd-party Libs
The following contracts are either directly imported from third-party libraries or verbatim copies of the original code:
* `ABDKMath64x64` by [ABDK Consulting](https://github.com/abdk-consulting).
* `FullMath` by [Uniswap](https://github.com/Uniswap)
* `OracleLibrary` by [Uniswap](https://github.com/Uniswap)
* `MetaProxyFactory` from [ERC-3448](https://eips.ethereum.org/EIPS/eip-3448#reference-implementation)
* Various from [OpenZeppelin](https://github.com/OpenZeppelin)

## Support and Periphery
The following contracts are not part of the core protocol so user's funds should be completely safe even when they are malformed or malicious.

* `TokenDescriptor`: view-only, replacable, ERC-1155 metadata descriptor.
* `FeeReceiver`: protocol fee receiver and collector. Does not affect Derivable pool users, only affects protocol fee recipient, which initialy is Derivable Labs, and later will be replaced by a DAO.
* `Helper`: deal with market slippage to achieve the desired state transition. Provided by user in each state transition, and can be malformed and malicious.
* `View`: supporting contract for front-end code using state override for calculation.
* `Universal Token Router` ([ERC-6120](https://eips.ethereum.org/EIPS/eip-6120))  provided by user in each state transition.

## Deployment instructions
### Deployment sequence
Step 1: Deploy `Fetcher.sol` for fetching Oracle Price, configure when create a pool
```
npx hardhat deployFetcher --network <your-network>
```
Step 2: Deploy `FeeReceiver.sol`, use FeeReceiver address to set into the constructor of PoolLogic
```
npx hardhat deployFeeReceiver --network <your-network>
```
Step 3: Deploy `Token.sol`, use Token address to set into the constructor of PoolLogic
```
npx hardhat deployToken --network <your-network>
```
Step 4: Deploy `PoolLogic.sol` with FeeReceiver and Token address from the previous steps
```
npx hardhat deployLogic --network <your-network>
```
Step 5: Deploy `PoolFactory.sol` with Logic address from the previous step
```
npx hardhat deployFactory --network <your-network>
```
Step 6: Deploy `TokenDescriptor.sol`, use TokenDescriptor address to configure the description of Token on next step
```
npx hardhat deployDescriptor --network <your-network>
```
Step 7: Set TokenDescriptor on Token
```
npx hardhat setDescriptor --network <your-network>
```
Step 8: Deploy `Helper.sol`, set Token address get from step 3 and weth address of your network to the constructor
```
npx hardhat deployHelper --network <your-network>
```
Step 9: Deploy `PlayDerivable.sol`, set Token address get from step 3 and weth address of your network to the constructor
```
npx hardhat deployPlayToken --network <your-network>
```
Address list is stored at `./scripts/json/<network>.json`

# Design

Derivable pool is a liquidity pool of perpetual derivatives for a single leverage. Participants come from 3 sides:
* long traders: exposed to the upside of its power perpetual
* short traders: exposed to the downside of its power perpetual
* liquidity providers: provide liquidity for the other 2 sides and earn the interest and spread

## Pool Configs

Each pool is identified by its immutable configs:
* FETCHER: Custom oracle fetcher logic contract.
* ORACLE: UniswapV3 pool, QuoteTokenIndex, and TWAP's window.
* K: twice the leverage power.
* TOKEN_R: the reserve token (also the settlement currency).
* MARK: square-root of the mark (or referrent) price.
* INTEREST_HL: decay half-life for the LP interest rate (in seconds).
* PREMIUM_HL: decay half-life for the premium rate (in seconds).
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
    ax^K                    &\quad\text{for }ax^K\le{R\over 2} \\
    R-\dfrac{R^2}{4ax^K}    &\quad\text{otherwise}
\end{cases}
$$

Short payoff:

$$
r_B=\begin{cases}
    bx^{-K}                 &\quad\text{for }bx^{-K}\le{R\over 2} \\
    R-\dfrac{R^2}{4bx^{-K}} &\quad\text{otherwise}
\end{cases}
$$

LP payoff:

$$r_C = R - r_A - r_B$$

Payoff for each position (balance) is calculated based on its total supply, pro-rata.

<div align=center>
<img alt="Asymptotic Power Curves" width=600px src="https://github.com/derivable-labs/derivable-core/assets/37166829/4976af88-eb45-40b7-b041-4ed222f24ada"/>
</div>

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
2. Price selection based on swap direction
3. Calculate current payoff: $p_0 = 〈R_0, r_{A0}, r_{B0}〉$
4. Apply interest rate to current payoff $p_0$ ⇒ $p_0'$
5. Cut the protocol fee from the interest and transfer out to `FeeReceiver`
6. Apply Premium rate to current payoff $p_0'$ ⇒ $p_0''$
7. Call `Helper.swapToState` with input `payload` to calculate the target state ($s_1$)
8. Calculate target payoff: $p_1 = 〈R_1, r_{A1}, r_{B1}〉$
9. Verify that there's only one side in. (Multiple sides out are not verified as they only hurt the transitioner, not the pool.)
10. Calculate the payoff deltas from $p_0''$ to $p_1$ to get the `amountIn` and `amountOut` values.
11. Increase the `amountIn` for open rate, decrease the `amountOut`  for maturity payoff rate.
12. Update the pool state storage to $s_1$
13. Transfer the `amountIn` in, and transfer the `amountOut` out.

## Decay Rates

### Interest Rate
Interest Rate is charged from both Long and Short sides to the LP side, by applying the decay rate to the 2 payoff value $r_{A0}$ and $r_{B0}$. The interest decay does not produce any token transfer, and the total pool reserve is unaffected.

With $t$ is the elapsed time, $I$ is *INTEREST_HL* config, we have:

* $r_{A0}' = \lceil r_{A0} \times 2^{-t\over{I}} \rceil$
* $r_{B0}' = \lceil r_{B0} \times 2^{-t\over{I}} \rceil$
* $r_{C0}' = R_0 - r_{A0}' - r_{B0}'$

### Premium Rate
Premium Rate is charged from the larger side of Long and Short, and pay to the other two sides, pro-rata, give them the chance of negative funding rates. With $t$ is the elapsed time, $P$ is *PREMIUM_HL* config, we have:

If $r_{A0}' > r_{B0}'$, the premium is applied as:
* $premium = r_{A0}' \times (1-2^{-t\over{P}}) \times \dfrac{r_{A0}' - r_{B0}'}{R_0}$
* $r_{A0}'' = r_{A0}' - premium$
* $r_{B0}'' = r_{B0}' + premium \times {\dfrac{r_{B0}'}{r_{B0}'+r_{C0}'}}$
* $r_{C0}'' = r_{C0}' + premium \times {\dfrac{r_{C0}'}{r_{B0}'+r_{C0}'}}$

If $r_{B0}' > r_{A0}'$, the premium is applied as:
* $premium = r_{B0}' \times (1-2^{-t\over{P}}) \times \dfrac{r_{B0}' - r_{A0}'}{R_0}$
* $r_{B0}'' = r_{B0}' - premium$
* $r_{A0}'' = r_{A0}' + premium \times{\dfrac{r_{A0}'}{r_{A0}'+r_{C0}'}}$
* $r_{C0}'' = r_{C0}' + premium \times {\dfrac{r_{C0}'}{r_{A0}'+r_{C0}'}}$

### Protocol Fee
Protocol fee is cut from the interest and premium to LP (not Long and Short) by a fixed ratio, and produce an token transfer to `FeeReceiver` and directly reduce the pool reserve in each transaction.

* $fee = (r_{C0}'' - r_{C0}) \div 5$
* $R_0'' = R_0 - fee$

<div align=center>
<img alt="Interest and Fee" width=600px src="https://github.com/derivable-labs/derivable-core/assets/37166829/8d4826ef-9a1a-42ec-bd5e-b791b033b369"/>
</div>

## Transition Rates

### Open Rate
Open Rate is a percentage-based rate to charge fee on Long and Short position opening.

### Close Rate

Close rate is applied to all position closing state transition's output token amount, which is affected by maturity payoff.

Each pool position is opened with a maturity date recorded along with its balance. The mimimum maturity date for newly open position is `maturity = MATURITY + block.timestamp` with `MATURIY` is a pool configuration.

With $MV$ is `MATURITY_VEST` and $MR$ is the `MATURITY_RATE`, the Close Rate (payoff) before maturity date is calculated as follow:

$$t = max(0, MATURITY + now() - maturity)$$

$$CloseRate = min(1, {t\over{MV}})\times MR$$

<div align=center>
<img alt="Maturity" width=600px src="https://github.com/derivable-labs/derivable-core/assets/37166829/9ff13c77-78a1-4947-9774-c78408ea14c6"/>
</div>

## Token Payment
There are two methods to transfer token into Derivable pool for state transistion:
* `TransferHelper.safeTransferFrom(msg.sender, ...)` from the pool, which requires direct user token approval to each pool. This method is designed for inter-contract interaction, and not recommended for interactive users.
* [ERC-6120](https://eips.ethereum.org/EIPS/eip-6120) or its interface can be used for interactive token payment to the pools.

# Solidity Style Guide

The Solidity code follows the official [Solidity style guide](https://docs.soliditylang.org/en/latest/style-guide.html), except for the following conventions.

For the storage variables, we opt to use our own style to have a clear view of storage access, making the code much more readable and preventing almost all local variable name collisions. A similar naming style is partly used by Chainlink and documented [here](https://github.com/smartcontractkit/chainlink/blob/master/contracts/STYLE.md#naming-and-casing).

* Storage variables are prefixed with `s_` to indicate that they reside in storage and are expensive to read and write: `s_storageVariable`.
* Transient storage variables are prefixed with `t_` to indicate that they must be reset before the transaction ends: `t_transientStorageVariable`.

# GLITCH ROUTER V2 — MICRO GAS ENGINE

This build keeps the DEAD PIXELS holder gate and adds two extra gas-minimizing
Uniswap execution paths for native ETH input trades.

## Why V2 exists

In live comparison screenshots, the official Uniswap app sent an ETH → NVDA
transaction to Robinhood Chain's official **Universal Router**:

`0x8876789976decbfcbbbe364623c63652db8c0904`

GLITCH ROUTER V1 was sending its direct V3 execution to **SwapRouter02**:

`0xcaf681a66d020601342297493863e78c959e5cb2`

Those are different execution contracts. V2 now simulates both styles instead
of assuming SwapRouter02 is always the cheapest execution.

## V2 routing stack

Special case:

```text
ETH ↔ WETH
→ WETH deposit()/withdraw() directly
```

For native ETH input trades:

```text
UNISWAP UNIVERSAL ROUTER // V3 micro-route
UNISWAP V2 DIRECT
NORDSTERN DIRECT
UNISWAP V3 / SwapRouter02
LI.FI
        ↓
SIMULATE GAS + OUTPUT
        ↓
BEST NET OUTPUT
```

For ERC-20 input trades, V1 routes remain active. Universal Router native mode
is intentionally limited to ETH input because ERC-20 Universal Router flows
normally introduce Permit2 approval/signature semantics; adding that blindly
would defeat the gas-minimization goal.

## Additional gas optimization

Robinhood Chain uses first-come, first-served sequencing: paying a higher
priority fee cannot jump ahead in the queue.

For GLITCH ROUTER's own constructed transactions, V2 uses the RPC's current
accepted gas price plus a 1% safety cushion. This avoids intentionally bidding
an oversized priority margin. Provider-built transactions from LI.FI/Nordstern
keep their provider-supplied fee fields.

This does NOT guarantee a lower final network fee. The chain base fee, L1 data
cost, calldata size, route state and wallet behavior can change.

## Official Uniswap Robinhood Chain addresses used

```text
Universal Router
0x8876789976decbfcbbbe364623c63652db8c0904

V3 SwapRouter02
0xcaf681a66d020601342297493863e78c959e5cb2

V2 Router02
0x89e5db8b5aa49aa85ac63f691524311aeb649eba

V3 Quoter
0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7

WETH
0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73
```

## Holder gate

Unchanged:

- minimum 1 DEAD PIXELS NFT
- UI locked for non-holders
- `/api/quote` independently checks `balanceOf(taker)` before returning an
  executable transaction.

## Test target

The first regression test should be:

```text
0.001 ETH → NVDA
```

Compare the wallet confirmation fee against the official Uniswap app at nearly
the same time.

V2 should show extra candidates such as:

```text
UNISWAP UNIVERSAL
UNISWAP V2 DIRECT
NORDSTERN DIRECT
UNISWAP DIRECT
LI.FI
```

Only the best net candidate is selected by default.

## Important

No route can be guaranteed to always beat Uniswap's own app. Uniswap can use
V2, V3, V4, Universal Router and UniswapX depending on current market state.
V2 closes one concrete gap observed in the live screenshots: our previous
failure to simulate the official Universal Router execution family for native
ETH trades.

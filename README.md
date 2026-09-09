# GLITCH ROUTER V3.1 — FULL RANGE DIRECT POOL ENGINE

This version does **not** restrict gas optimization to small trades.

The custom `GLITCH DIRECT POOL` route competes on **every trade size** whenever
a canonical Uniswap V3 single-hop or WETH/USDG two-hop route exists.

## Architecture

```text
ANY TRADE SIZE
      ↓
FULL RANGE ENGINE
      ↓
DIRECT WRAP                ETH ↔ WETH
GLITCH DIRECT POOL         custom holder-gated executor
UNISWAP UNIVERSAL
UNISWAP V2 DIRECT
UNISWAP V3 DIRECT
NORDSTERN DIRECT
LI.FI
      ↓
SIMULATE OUTPUT + GAS
      ↓
BEST NET OUTPUT
```

There is no hardcoded `$50`, `$300`, or whale threshold. The engine lets the
actual quote and gas simulation decide.

## Why a custom executor can be cheaper

The generic routers must support many execution modes.

`GlitchDirectExecutor` is intentionally narrow:

```text
wallet
  ↓
GlitchDirectExecutor
  ↓
canonical Uniswap V3 pool
```

It supports only:

- exact-input single-pool V3 swap
- exact-input two-pool V3 swap
- native ETH wrap/unwrap when needed
- DEAD PIXELS holder check
- minimum-output protection

It has:

- no owner
- no admin
- no protocol fee
- no storage-based custody
- no generic command parser
- no arbitrary external calls

The route is only selected when its estimated **net result** actually beats the
other candidates.

## Holder restriction

Contract:
`0x27390fe7ae676fbfdb632e61cd4019996b07892c`

Minimum:
`1 DEAD PIXEL`

The portal still checks holder status server-side.

The custom executor also performs its own onchain `balanceOf(msg.sender)` check,
so non-holders cannot use the custom executor directly.

## Official Robinhood Chain Uniswap V3 addresses

```text
Factory
0x1f7d7550b1b028f7571e69a784071f0205fd2efa

QuoterV2
0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7

SwapRouter02
0xcaf681a66d020601342297493863e78c959e5cb2

Universal Router
0x8876789976decbfcbbbe364623c63652db8c0904

WETH
0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73
```

## Deploy the custom executor

The source is:

```text
contracts/GlitchDirectExecutor.sol
```

A Hardhat deployment package is included under:

```text
deployment/
```

On your Windows PC:

```text
cd deployment
npm install
copy .env.example .env
```

Edit `.env` locally:

```text
RH_RPC_URL=https://rpc.mainnet.chain.robinhood.com/
PRIVATE_KEY=YOUR_DEPLOYER_PRIVATE_KEY
```

Do not put that private key into ChatGPT, Vercel frontend code, GitHub, or a
public file.

Then:

```text
npm run compile
npm run deploy:mainnet
```

The deployment script prints:

```text
GLITCH DIRECT EXECUTOR DEPLOYED
Address: 0x...
```

Copy only the **public contract address**.

In Vercel add:

```text
GLITCH_EXECUTOR_ADDRESS=0x...
```

Redeploy the portal.

Then `/api/health` should show:

```text
directPoolEngine.configured = true
providers.glitchDirectPool = true
```

## First test

Do not start with meaningful capital.

Test the same route that exposed the previous gap:

```text
0.001 ETH → NVDA
```

The page should be able to show candidates including:

```text
GLITCH DIRECT POOL
UNISWAP UNIVERSAL
NORDSTERN DIRECT
UNISWAP DIRECT
LI.FI
```

Then compare the **actual OKX wallet confirmation network fee**, not only the
frontend estimate.

## ERC-20 input

For an ERC-20 sell, `GLITCH DIRECT POOL` requires allowance to the custom
executor.

The portal keeps the existing exact-to-trade approval behavior. It does not
request unlimited allowance.

Approval gas is included in route ranking when a new approval is required.

## Security note

This is a new custom execution contract. The source is deliberately small, but
small does not mean audited.

Before routing serious volume:

1. compile and inspect the bytecode/source;
2. deploy;
3. verify it on Blockscout;
4. run tiny live swaps for ETH → token, token → ETH, token → token and two-hop;
5. get an independent Solidity review/audit.

If the custom route is not cheaper, the engine simply lets another provider win.


## Remix compile fix

V3.1 refactors the internal V3 swap call into a `SwapRequest` memory struct.
This removes the previous `Stack too deep` compiler failure in Remix's legacy
code generator.

Recommended Remix settings:

```text
Compiler: 0.8.24
Optimization: ON
Runs: 1,000,000
viaIR: not required
```

If `Use configuration file` is enabled, use the included `remix.config.json`.

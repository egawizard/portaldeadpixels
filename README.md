# DEAD PIXELS PORTAL V3.5 — UNIFIED EXECUTION OS

This build combines the existing holder-gated GLITCH ROUTER with the Stock Token execution stack in one portal.

```text
V3.0  UNIFIED PORTAL UI
V3.1  STOCK TOKEN REGISTRY + MARKET SCANNER
V3.2  FAIR VALUE ENGINE + GLITCH SCORE
V3.3  STOCK-TO-STOCK
V3.4  PORTFOLIO BUILDER + REBALANCER
V3.5  WAIT FOR BETTER + EXECUTION ORDERS
```

GLITCH PAD remains visible as the next portal module and is still marked `COMING NEXT WEEK`.

## Existing core preserved

- Robinhood Chain `4663`
- 0% DEAD PIXELS protocol fee
- holder gate: 1+ DEAD PIXEL
- NFT contract: `0x27390fe7ae676fbfdb632e61cd4019996b07892c`
- official Uniswap BEST_PRICE baseline
- Nordstern Direct
- LI.FI
- direct ETH/WETH wrap
- non-custodial wallet execution

## V3.0 — Unified Portal UI

One interface now exposes:

```text
01 ROUTER
02 STOCK ENGINE
03 ROTATE
04 PORTFOLIO
05 ORDERS
06 GLITCH PAD
```

The same connected wallet and holder gate are reused across execution modules.

## V3.1 — Stock Token Registry + Market Scanner

New API:

```text
GET /api/stocks
GET /api/stock-scan?symbols=NVDA,AAPL,TSLA
GET /api/stock-detail?symbol=NVDA
```

Registry source:

```text
https://api.robinhood.com/rhj/assets
```

Market reference source:

```text
https://api.robinhood.com/rhj/prices/{symbol}
```

The registry filters active deployments on Robinhood Chain `4663` and exposes the current corporate-action multiplier.

The scanner defaults to a popular-symbol watchlist when those assets exist in the live registry. Search can scan any Stock Token returned by the registry.

## V3.2 — Fair Value Engine + GLITCH SCORE

Robinhood's REST bid/ask is the raw underlying-equity price. V3.5 converts it to a Stock Token-equivalent fair reference with:

```text
TOKEN FAIR VALUE = UNDERLYING MID × CURRENT MULTIPLIER
```

For actual execution analysis the portal then asks GLITCH ROUTER for an executable route and derives:

```text
EXECUTABLE PRICE
EXECUTION DEVIATION
USER GAS
MARKET SPREAD
ROUTE QUALITY
```

`/api/stock-execution` combines those signals into a `GLITCH SCORE` from `0–100`.

The score is an execution-quality heuristic, not a prediction of future asset performance and not investment advice.

### Fair Value Shield

Users can set a maximum adverse execution deviation. If the current route exceeds that threshold, the dedicated Stock Engine/Rotator action is blocked from loading into the Router.

The generic Router remains available separately; the shield is an execution-quality guard in the Stock modules, not an onchain transfer restriction.

## V3.3 — Stock-to-Stock

The Rotator accepts:

```text
SELL STOCK TOKEN
AMOUNT
BUY STOCK TOKEN
```

It calculates a fair cross-output from both Stock Token fair values, requests a direct executable GLITCH quote, compares actual output to fair cross-value, and applies Fair Value Shield.

When accepted, `LOAD ROTATION INTO ROUTER` transfers the exact Stock Token pair and amount into the existing Router execution flow.

No manual USDG hop is required in the UI. The underlying winning route may still use intermediate liquidity if the selected routing provider determines that is more efficient.

## V3.4 — Portfolio Builder + Rebalancer

### Build New

Enter USDG capital and target weights. The portal creates an execution queue:

```text
USDG → STOCK A
USDG → STOCK B
USDG → STOCK C
...
```

### Rebalance Wallet

For selected Stock Tokens the browser reads wallet ERC-20 balances, fetches current fair references, calculates current weights, then greedily matches overweight positions with underweight positions.

The queue prefers:

```text
OVERWEIGHT STOCK → UNDERWEIGHT STOCK
```

Each step is non-custodial and loaded into GLITCH ROUTER for wallet confirmation. V3.5 intentionally does not deploy a portfolio custody contract or silently execute a batch of trades.

## V3.5 — WAIT FOR BETTER + Execution Orders

This release implements non-custodial **client watch orders**.

Conditions can include:

```text
BUY / SELL
TARGET FAIR PRICE
MAX EXECUTION DEVIATION
MIN GLITCH SCORE
MAX USER GAS IN USD
```

Orders are stored in browser `localStorage` and checked roughly every 20 seconds while the portal is open and an eligible holder wallet is connected.

When all conditions pass:

```text
READY
→ LOAD & EXECUTE
→ WALLET CONFIRMATION
```

### Important execution-order limitation

V3.5 does **not** claim unattended/autonomous execution.

A normal browser wallet cannot be silently signed by a Vercel backend. The current design therefore keeps funds non-custodial and requires wallet confirmation when an order becomes ready.

Persistent 24/7 autonomous intent execution would require a separate signed-intent / settlement design and security review rather than pretending a browser watcher can do it safely.

## Stock Token integration sources

Robinhood documentation used for the integration:

- Stock Tokens: `https://docs.robinhood.com/chain/stock-tokens/`
- Stock Token APIs: `https://docs.robinhood.com/chain/stock-token-apis/`
- Token contracts: `https://docs.robinhood.com/chain/contracts/`
- Oracles & Price Feeds: `https://docs.robinhood.com/chain/oracles-and-price-feeds/`

Robinhood documents Stock Tokens as standard ERC-20 tokens with 18 decimals and a per-token corporate-action multiplier. It also documents that its REST price endpoint returns raw underlying bid/ask rather than multiplier-adjusted token value.

### Why the V3.2 fair reference currently uses RHJ REST instead of hard-coded Chainlink feed addresses

Robinhood documents that each Stock Token has a Chainlink feed and recommends treating Chainlink's current feed list as the source of truth rather than hard-coding feed proxy addresses.

This build therefore avoids shipping a potentially stale static list of ~all Stock Token feed proxies. The fair-value engine uses Robinhood's official REST market reference + live current multiplier, while the architecture leaves room for a later dynamic Chainlink-feed adapter.

## Deployment

Required Vercel environment variable:

```text
UNISWAP_API_KEY=
```

Optional:

```text
LIFI_API_KEY=
RH_RPC_URL=https://rpc.mainnet.chain.robinhood.com/
```

Do not put API keys in `index.html` or public GitHub source.

After deployment check:

```text
https://portal.deadpixelslabs.com/api/health
```

Expected app name:

```text
DEAD PIXELS PORTAL V3.5 // UNIFIED EXECUTION OS
```

Health also reports the live Stock Token registry count when Robinhood's RHJ endpoint is reachable.

## New files

```text
lib/stocks.js
api/stocks.js
api/stock-scan.js
api/stock-detail.js
api/stock-execution.js
```

`api/tokens.js` now merges Robinhood Stock Tokens into the Router token catalog.

`api/quote.js` now has a Stock Token fair-value fallback for output valuation. This allows BEST NET ranking to include gas even when an aggregator's token catalog does not provide a USD price for a Stock Token.

## Safety / rollout

Before announcing production execution:

1. deploy V3.5;
2. confirm `/api/health`;
3. verify Stock Token registry count;
4. run tiny USDG → Stock Token trades;
5. run tiny Stock Token → Stock Token rotations;
6. test portfolio queue with tiny balances;
7. test BUY and SELL watch orders;
8. confirm the wallet transaction recipient/calldata before signing;
9. keep the 0% protocol fee claim limited to the DEAD PIXELS protocol fee — external pools/routes may still have their own liquidity/provider costs.

Stock Tokens may be subject to issuer and jurisdiction restrictions. The portal displays an access notice but does not itself determine legal eligibility.


## V3.5.1 — Vercel-safe packaging

This build reduces the number of standalone Vercel Functions by merging:

- stock registry
- market scan
- stock detail
- stock execution analysis

into one `/api/stocks?action=...` function.

The application behavior is unchanged from the user's perspective.

Node is pinned to:

```text
22.x
```

instead of the floating `>=18` engine range.

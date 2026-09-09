# DEAD PIXELS // GLITCH ROUTER V6
## NORDSTERN + HOLDER GATE

**Only DEAD PIXELS holders can obtain executable swap quotes through this portal.**

DEAD PIXELS NFT:
`0x27390fe7ae676fbfdb632e61cd4019996b07892c`

Minimum:
`1 NFT`

## Routing stack

Special case:

```text
ETH ↔ WETH
→ direct WETH deposit()/withdraw()
```

All other routable pairs:

```text
NORDSTERN DIRECT
UNISWAP DIRECT V3
LI.FI
        ↓
compare output + estimated gas + provider fee
        ↓
BEST NET OUTPUT
```

DEAD PIXELS protocol fee:
`0 bps`

## Holder gate

The frontend checks `/api/holder` when a wallet connects.

More importantly, `/api/quote` performs its own onchain DEAD PIXELS `balanceOf(taker)` check before returning any executable transaction.

A non-holder therefore cannot bypass the UI by simply calling the portal quote endpoint directly.

This gate applies to GLITCH ROUTER itself. It obviously does not prevent a non-holder from using Uniswap, LI.FI, Nordstern, or another DEX outside our portal.

## Nordstern integration

The direct provider uses:

```text
GET https://api.nordstern.finance/aggregator/4663
?src=...
&dst=...
&amount=...
```

Robinhood native ETH is translated from the portal's internal native-token sentinel to the zero-address native representation for the Nordstern request.

The integration consumes the returned `toAmount` and executable `tx`.

For ERC-20 sells, the approval spender is selected from explicit Nordstern response fields when available, with the returned transaction destination used as a compatibility fallback. Approval remains exact-to-trade, never unlimited.

For safety, a native-input Nordstern quote is rejected if its returned transaction has no `tx.value`; the router does not guess or manufacture provider calldata.

## Token list

The `/api/tokens` endpoint now attempts to merge:

- LI.FI token catalog
- Nordstern token catalog

If one source is unavailable, the other can still populate the selector.

Users can still paste any ERC-20 contract manually.

## Gas ranking

When USD prices are available:

```text
gross output value
- estimated network gas
- reported provider fee
= estimated net value
```

When reliable USD pricing is missing, fallback ranking is:

1. highest token output
2. lower estimated gas as a tie-breaker

## Environment

Optional:

```text
LIFI_API_KEY=
RH_RPC_URL=https://rpc.mainnet.chain.robinhood.com/
```

No Nordstern API key is required by this build.

A dedicated RPC is recommended in production because every executable quote now includes:

- holder NFT balance check
- provider quote calls
- Uniswap onchain quote calls
- gas estimation
- allowance checks when applicable

## Test plan

1. Deploy to Vercel preview.
2. Open `/api/health`.
3. Connect a wallet with **0 DEAD PIXELS**.
   - page should show `ACCESS DENIED`
   - `/api/quote` should return HTTP 403.
4. Connect a wallet with **1+ DEAD PIXELS**.
   - page should show `HOLDER ACCESS GRANTED`
   - quote scanning should unlock.
5. Test `ETH → NVDA`.
   - Nordstern / Uniswap / LI.FI should compete when available.
6. Test `ETH → WETH`.
   - DIRECT WRAP should be used 1:1.
7. Start with tiny live transactions and inspect the destination in the wallet before confirming.

## Important

Nordstern, LI.FI and Uniswap are third-party execution/liquidity providers. GLITCH ROUTER remains non-custodial and does not deploy a DEAD PIXELS swap contract in this build.

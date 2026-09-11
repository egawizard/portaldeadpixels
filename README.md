# DEAD PIXELS PORTAL V3.7.7 — Intelligent Market Guard

V3.7.7 upgrades GLITCH ALPHA so its score behaves like market intelligence instead of a raw activity leaderboard. The rule is universal: a market that is collapsing cannot earn a strong Alpha score simply because volume or transaction count is high.

## V3.7.7 intelligence changes

- **Universal Crash Guard** applies to every token and every market pair. There is no whitelist or special score exemption for DEAD PIXELS / $GLITCH.
- **Price Survival** is now a first-class score component and carries major weight.
- **Catastrophic drawdown score caps** prevent activity from overriding destructive price action.
- **Anomaly Engine** detects extreme volume/liquidity churn, micro-liquidity with huge turnover, parabolic moves and one-sided order flow.
- **Turnover Quality** replaces the old behavior where ever-higher Volume/Liquidity could always improve Activity. Healthy turnover can score well; absurd turnover is downgraded.
- **Market Risk** is available directly in the feed model, while deep detail combines market risk with contract and holder signals.
- **Risk Radar** receives distressed/crashed markets even when they are excluded from the normal Trending board.
- **Gainers** now require a positive 24H change; a falling market cannot enter Gainers just because of other metrics.
- **Score explainability** shows strengths, warnings, anomaly score, market risk, turnover and any active score cap.
- **Rebound Watch** can recognize short-term recovery after a severe drawdown, but the crash cap remains active until the market actually recovers. A bounce does not erase the prior collapse.

## Universal crash policy

The following caps are applied before the final score is shown. Shorter-timeframe flash crashes can impose even stricter caps.

```text
24H <= -30%   max 72
24H <= -45%   max 60
24H <= -60%   max 48
24H <= -75%   max 36
24H <= -85%   max 26
24H <= -90%   max 18
24H <= -95%   max 10
```

Example: a token down ~96.7% in 24H with ~$5K liquidity and ~169x Volume/Liquidity can no longer show a score around 70. It is classified **CRITICAL**, Alpha is capped at 10, anomaly/risk are elevated, and it is routed to **RISK RADAR** instead of normal Trending.

## GLITCH ALPHA score components

```text
Momentum      14%
Liquidity     18%
Activity      13%
Flow          10%
Maturity      10%
Structure     10%
Price Survival 25%
```

Activity itself uses a turnover-quality curve. Extremely high churn no longer receives the same treatment as healthy activity.

## Security-safe holder gate preserved

- No provider request on page load.
- User must manually press **CONNECT WALLET**.
- Holder verification is a server-side read-only `balanceOf()` check on Robinhood Chain.
- No signature, approval, transaction or automatic network switch is required during holder verification.
- Full Portal UI remains restricted to wallets holding at least 1 DEAD PIXELS NFT.

DEAD PIXELS NFT contract:
`0x27390fe7ae676fbfdb632e61cd4019996b07892c`

## Other existing features preserved

- Universal token discovery / Just Born / historical search
- Pair-aware market identity and canonical list/detail score
- Holder count + HOLDER_MAP
- Liquidity lock intelligence
- DEX Screener paid / boosts / ads intelligence
- Same-origin SSRF-safe raster token image proxy
- Stock Engine, Portfolio, Orders and GLITCH Router
- Non-custodial routing with 0% protocol fee

## Environment variables

No new key is required.

```text
RH_RPC_URL=https://rpc.mainnet.chain.robinhood.com/
UNISWAP_API_KEY=your_existing_key
LIFI_API_KEY=your_existing_key_if_used
```

## Simple deployment

1. Extract this ZIP.
2. Replace the files in the current Vercel Portal project with the extracted files.
3. Keep the existing environment variables unchanged.
4. Deploy / Redeploy.
5. Open `/api/health` and confirm **DEAD PIXELS PORTAL V3.7.7** and `scoreModel: V3.7.7_INTELLIGENT_MARKET_GUARD`.
6. Connect a DEAD PIXELS holder wallet and open **02 ALPHA**.
7. Check **Trending** and **Risk Radar**. Distressed markets should no longer rank as normal high-alpha opportunities.

## Important

GLITCH ALPHA is decision-support intelligence. Risk, anomaly, holder, lock and score signals cannot guarantee that a token is safe, profitable, liquid or sellable. When evidence is unavailable the Portal should prefer UNKNOWN / reduced confidence over inventing a positive claim.

# DEAD PIXELS PORTAL V3.7.3 — GLITCH ALPHA

This is the Vercel-ready continuation of the V3.7.2 Portal. The corrupted-terminal / black + acid-green DEAD PIXELS UI and the V3.5.2 execution core are preserved.

## V3.7.3 changes

### Full DEAD PIXELS holder gate
The whole Portal interface is hidden until the connected wallet passes an onchain `balanceOf` check against:

`0x27390fe7ae676fbfdb632e61cd4019996b07892c`

Requirement: **1+ DEAD PIXELS NFT**. A non-holder sees only the HOLDER ACCESS screen. Market/Alpha loaders are not started until the check succeeds. No private key or seed phrase is requested. Execution remains non-custodial and wallet-confirmed.

### Holder count + HOLDER_MAP
Token detail now uses two Blockscout paths:
1. Blockscout V2 token info/counters/holders.
2. Blockscout Etherscan-compatible `getTokenHolders` fallback.

Holder responses are normalized across nested address formats. If Blockscout exposes an exact count it is displayed. If only a sampled list is available, the UI shows an honest `N+` sample rather than a fake zero. HOLDER_MAP visualizes the top holder sample and labels pool, burn/locker, deployer and normal-holder rows when detectable.

### Liquidity lock intelligence
Token detail now shows **LIQUIDITY LOCK**. The engine is deliberately conservative:
- V2: detects LP-token balances at the burn address or recognized locker addresses and calculates the detected locked share when possible.
- Recognized permanent-launch origins can report `PERMANENT` when there is positive onchain/source evidence.
- V3/V4 concentrated positions are not falsely declared unlocked. If the position owner/launcher cannot be proven, the status is `UNKNOWN`.

`UNKNOWN` means GLITCH ALPHA does not have enough positive evidence; it does **not** mean the liquidity is unlocked.

### DEX paid / promotion intelligence
Token detail checks DEX Screener's paid-orders endpoint and displays **DEXSCREENER PAID / PROMOTION** as `PAID`, `NOT PAID`, or `UNKNOWN`. It also shows the number of observed paid-order signals and active boosts when available. This is a marketing/promotion signal, not a token-quality score.

## Existing ALPHA features preserved
- pair-aware Trending / Just Born / Gainers / Volume / Risk Radar / All Tokens / Watchlist
- direct Robinhood Chain mint pulse
- GeckoTerminal + DEX Screener market data
- Blockscout historical token catalog
- canonical pair-level GLITCH score
- contract/source risk signals
- deployer intelligence
- OHLCV + whale tape
- direct Load Into Router
- official $GLITCH pinned without an artificial score bonus

## Environment variables
Keep your current Vercel variables. The free official Robinhood RPC is supported:

```text
RH_RPC_URL=https://rpc.mainnet.chain.robinhood.com/
UNISWAP_API_KEY=your_existing_key
LIFI_API_KEY=your_existing_key_if_used
```

## Simple deployment
1. Extract this ZIP.
2. Replace the current Portal project files with the extracted files.
3. Keep the same Vercel environment variables.
4. Deploy / Redeploy.
5. Open `/api/health` and confirm `DEAD PIXELS PORTAL V3.7.3`.
6. Open the site in a wallet/browser that does **not** hold DEAD PIXELS: only the HOLDER ACCESS screen should be visible.
7. Connect a wallet holding at least 1 DEAD PIXELS: the full Portal should unlock.
8. Open **02 ALPHA**, select several tokens, and confirm HOLDERS, HOLDER_MAP, LIQUIDITY LOCK, and DEXSCREENER PAID / PROMOTION are shown.

## Accuracy note
Holder indexing, DEX paid orders and liquidity-lock evidence come from external/indexed/onchain sources and can lag. The Portal intentionally uses `UNKNOWN`/`N+` when evidence is incomplete instead of inventing certainty.

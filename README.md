# DEAD PIXELS PORTAL V3.7.5 — Security-Safe Holder Gate

V3.7.5 keeps the V3.7.4 GLITCH ALPHA build and changes the wallet-access behavior to reduce unnecessary wallet/security signals while preserving full holder-only access.

## What changed

- **No wallet/provider request on page load.** The page does not call `eth_accounts`, `eth_requestAccounts`, `wallet_switchEthereumChain`, signing methods, approvals, or transaction methods automatically.
- **Explicit manual connect only.** The first wallet permission request happens only after the user presses **CONNECT WALLET**.
- **No network switch during the holder gate.** After account selection, the Portal sends only the public wallet address to `/api/holder`; the server verifies DEAD PIXELS ownership with a read-only `balanceOf()` call against Robinhood Chain.
- **No signature, approval or transaction during access verification.** Network switching is deferred until the holder deliberately starts an execution action that actually needs Robinhood Chain.
- **Full UI remains holder-only.** The Portal shell and Alpha loaders remain locked until the address holds at least 1 DEAD PIXELS NFT.
- **Passive wallet events are ignored before explicit consent.** Account/network events cannot silently unlock the Portal on initial page load.
- **Security headers added.** `X-Frame-Options`, CSP, no-referrer and restrictive Permissions-Policy are applied to the site.

## Holder contract

`0x27390fe7ae676fbfdb632e61cd4019996b07892c`

Minimum: **1 DEAD PIXELS**

## Access sequence

```text
LOAD PORTAL
  ↓
NO WALLET REQUEST
  ↓
USER CLICKS CONNECT WALLET
  ↓
eth_requestAccounts
  ↓
/api/holder?wallet=0x...
  ↓
SERVER READ-ONLY NFT balanceOf() ON CHAIN 4663
  ↓
BALANCE >= 1 → UNLOCK PORTAL
BALANCE = 0  → KEEP PORTAL LOCKED
```

No seed phrase/private key is ever requested. No message signature, approval, or transaction is part of this holder verification flow.

## Existing V3.7.4 features preserved

- GLITCH ALPHA universal token intelligence
- pair-aware rankings and canonical score
- qualified Trending / Gainers / Volume
- Just Born + historical token discovery
- HOLDER_MAP and holder intelligence
- Liquidity lock intelligence
- DEX Screener paid / boosts / ads intelligence
- larger readability typography
- 0% protocol fee GLITCH Router

## Environment variables

Keep the existing variables. No new key is required:

```text
RH_RPC_URL=https://rpc.mainnet.chain.robinhood.com/
UNISWAP_API_KEY=your_existing_key
LIFI_API_KEY=your_existing_key_if_used
```

## Simple deployment

1. Extract this ZIP.
2. Replace the current Vercel Portal project files with the extracted files.
3. Keep the existing Vercel environment variables.
4. Deploy / Redeploy.
5. Open `/api/health` and confirm **DEAD PIXELS PORTAL V3.7.5** and `securitySafeAccess.manualConnectOnly: true`.
6. Open the Portal in a fresh/private browser window. **No wallet popup should appear by itself.**
7. Press **CONNECT WALLET** manually. This should be the first wallet permission request.
8. A holder wallet should unlock the Portal; a non-holder wallet should remain on the access screen.
9. During access verification there should be **no network-switch, signature, approval, or transaction prompt**.

## Important

This build reduces unnecessary wallet/security signals but cannot guarantee how MetaMask or any third-party threat-intelligence provider classifies a domain. If a domain warning is already active, a clean redeploy does not itself guarantee immediate removal; the classification provider may need to rescan/review the site.

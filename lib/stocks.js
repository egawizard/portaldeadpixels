const CHAIN_ID = 4663;
const RHJ = "https://api.robinhood.com/rhj";

let assetCache = { at: 0, items: [] };
let priceCache = new Map();

function cleanSymbol(v){
  const s=String(v||"").trim().toUpperCase();
  return /^[A-Z0-9.\-]{1,16}$/.test(s)?s:null;
}
function n(v){
  const x=Number(v);
  return Number.isFinite(x)?x:null;
}
async function fetchJson(url, timeoutMs=10000){
  const c=new AbortController();
  const timer=setTimeout(()=>c.abort(),timeoutMs);
  try{
    const r=await fetch(url,{headers:{accept:"application/json"},signal:c.signal});
    const text=await r.text();
    let j;try{j=JSON.parse(text)}catch{j={error:text}}
    if(!r.ok)throw new Error(j?.message||j?.error||`RHJ_HTTP_${r.status}`);
    return j;
  }finally{clearTimeout(timer)}
}
function normalizeAsset(a){
  if(!a||a.status!=="ASSET_STATUS_ACTIVE")return null;
  const dep=(a.deployments||[]).find(x=>Number(x.chainId)===CHAIN_ID && /^0x[a-fA-F0-9]{40}$/.test(x.contractAddress||""));
  if(!dep)return null;
  const symbol=cleanSymbol(a.tokenSymbol);
  if(!symbol)return null;
  const multiplier=n(a.currentMultiplier)||1;
  return {
    id:a.id||null,
    symbol,
    name:String(a.tokenName||symbol).slice(0,120),
    address:dep.contractAddress,
    chainId:CHAIN_ID,
    decimals:18,
    multiplier,
    currentMultiplier:String(a.currentMultiplier||"1"),
    pendingMultiplier:String(a.pendingMultiplier||""),
    pendingMultiplierEffectiveTime:a.pendingMultiplierEffectiveTime||null,
    logoUrl:a.logoUrl||null,
    status:a.status,
    tradingCapabilities:a.tradingCapabilities||null
  };
}
async function getAssets(force=false){
  if(!force && assetCache.items.length && Date.now()-assetCache.at<300000)return assetCache.items;
  const j=await fetchJson(`${RHJ}/assets`,12000);
  const raw=Array.isArray(j)?j:Array.isArray(j.assets)?j.assets:[];
  const items=raw.map(normalizeAsset).filter(Boolean).sort((a,b)=>a.symbol.localeCompare(b.symbol));
  assetCache={at:Date.now(),items};
  return items;
}
async function getAsset(symbol){
  const s=cleanSymbol(symbol);if(!s)return null;
  const items=await getAssets();
  return items.find(x=>x.symbol===s)||null;
}
async function getPrice(symbol, asset=null, force=false){
  const s=cleanSymbol(symbol);if(!s)throw new Error("INVALID_SYMBOL");
  const cached=priceCache.get(s);
  if(!force && cached && Date.now()-cached.at<14000)return cached.value;
  const a=asset||await getAsset(s);
  if(!a)throw new Error("STOCK_TOKEN_NOT_FOUND");
  const j=await fetchJson(`${RHJ}/prices/${encodeURIComponent(s)}`,10000);
  const raw=Array.isArray(j)?j:Array.isArray(j.quotes)?j.quotes:[];
  const q=raw.find(x=>(x.deployments||[]).some(d=>Number(d.chainId)===CHAIN_ID))||raw[0];
  if(!q)throw new Error("PRICE_NOT_AVAILABLE");
  const bid=n(q.bid),ask=n(q.ask);
  if(!(bid>0)&&!(ask>0))throw new Error("INVALID_MARKET_PRICE");
  const b=bid>0?bid:ask, aa=ask>0?ask:bid;
  // RHJ REST prices are raw underlier prices. One Stock Token represents
  // currentMultiplier shares, so token-equivalent value is raw price × multiplier.
  const adjustedBid=b*a.multiplier;
  const adjustedAsk=aa*a.multiplier;
  const mid=(adjustedBid+adjustedAsk)/2;
  const spreadBps=mid>0?(adjustedAsk-adjustedBid)/mid*10000:null;
  const value={
    symbol:s,
    bidRaw:b,
    askRaw:aa,
    bid:adjustedBid,
    ask:adjustedAsk,
    fairValue:mid,
    multiplier:a.multiplier,
    currency:q.currency||"USD",
    dailyTradingVolume:n(q.dailyTradingVolume)||0,
    isTradingHalt:!!q.isTradingHalt,
    generatedAt:q.generatedAt||null,
    spreadBps
  };
  priceCache.set(s,{at:Date.now(),value});
  return value;
}
function clamp(x,a=0,b=100){return Math.max(a,Math.min(b,x));}
function marketScore(asset, price){
  if(price.isTradingHalt)return {score:0,spreadScore:0,tradabilityScore:0,verdict:"HALTED"};
  const spreadScore=clamp(100-Math.max(0,price.spreadBps||0)*1.6);
  const trad=asset?.tradingCapabilities?.fractionalTradability;
  const tradabilityScore=trad==="tradable"?100:(trad==="position_closing_only"||trad==="position_opening_only"?55:75);
  const score=Math.round(spreadScore*.65+tradabilityScore*.35);
  const verdict=score>=95?"EXCELLENT":score>=85?"GOOD":score>=70?"CAUTION":"POOR";
  return {score,spreadScore:Math.round(spreadScore),tradabilityScore,verdict};
}
async function getSnapshot(symbol){
  const asset=await getAsset(symbol);
  if(!asset)throw new Error("STOCK_TOKEN_NOT_FOUND");
  const price=await getPrice(symbol,asset);
  return {...asset,market:price,marketQuality:marketScore(asset,price)};
}
module.exports={CHAIN_ID,RHJ,cleanSymbol,getAssets,getAsset,getPrice,getSnapshot,marketScore,clamp};

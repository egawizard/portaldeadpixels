const CHAIN_ID=4663;
const NETWORK="robinhood";
const RPC=process.env.RH_RPC_URL||"https://rpc.mainnet.chain.robinhood.com/";
const BLOCKSCOUT="https://robinhoodchain.blockscout.com";
const DEX="https://api.dexscreener.com";
const GECKO="https://api.geckoterminal.com/api/v2";
const WETH="0x0bd7d308f8e1639fab988df18a8011f41eacad73";
const USDG="0x5fc5360d0400a0fd4f2af552add042d716f1d168";
const GLITCH="0xaeca11ad61d76f7c2d6b1100d3ca9066fbdb8459";
const TRANSFER_TOPIC="0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const ZERO_TOPIC="0x"+"0".repeat(64);
const QUOTE_TOKENS=new Set([WETH,USDG,"0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee","0x0000000000000000000000000000000000000000"]);
const HTTP_CACHE=new Map();
const DEAD="0x000000000000000000000000000000000000dead";
const ZERO="0x0000000000000000000000000000000000000000";
// Recognized Robinhood Chain launch/locker contracts. These are only used as positive evidence.
// If a market is not recognized, GLITCH ALPHA reports UNKNOWN rather than pretending liquidity is unlocked.
const PERMANENT_LAUNCH_ORIGINS=new Map([
  ["0x0000ffffbe8efe702c8703ae3477ff5de3d319c0","UNISWAP POOLS.TRADE // LIQUIDITY LAUNCHER"],
  ["0x23f8209572b4a1c2ad88a42749e830791fb027f1","UNISWAP POOLS.TRADE // INSTANT LAUNCH"],
  ["0xad44d55e7f8337c3ce113fbb591486e85be104b2","UNISWAP POOLS.TRADE // INSTANT LAUNCH"],
  ["0x815542e8b392389a1389e22e588e4b62a67ade72","OPENLAUNCH // FACTORY"]
]);
const KNOWN_LP_LOCKERS=new Map([
  [DEAD,"BURN ADDRESS"],
  ["0xcd1680d26922fcd9cabfbb8a56ba40c333fd842a","OPENLAUNCH // PERMANENT LOCKER"],
  ["0x5b41d59fa0ce65750bc64e06d85bc999084493cd","ROBINPAD // ROBINLOCK"],
  ["0xcf7fa67d6f5820680efbc5999c9c4198aee977ab","ROBINPAD // INSTANT LOCKER"],
  ["0x7a1fb91b81af106fb9134281aafe0205d2cd31f0","ROBINPAD // ROBIN PAIR LOCKER"],
  ["0x267444d099b10fb5ed7c3cc7b7c767adca574952","PONS // LAUNCH LOCKER"]
]);
const {getAssets}=require("./stocks");
const QUOTE_SYMBOLS=new Set(["ETH","WETH","USDG","USDC","USDT","DAI"]);
let STOCK_CACHE={at:0,addresses:new Set()};
let STOCK_LOADING=null;

function n(v,d=0){const x=Number(v);return Number.isFinite(x)?x:d;}
function optNum(v){if(v===null||v===undefined||v==="")return null;const x=Number(v);return Number.isFinite(x)?x:null;}
function clamp(x,a=0,b=100){return Math.max(a,Math.min(b,x));}
function addr(v){return /^0x[a-fA-F0-9]{40}$/.test(String(v||""));}
function poolId(v){return /^0x(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$/.test(String(v||""));}
function lower(v){return String(v||"").toLowerCase();}
function extractAddress(v){
  if(typeof v==="string")return addr(v)?lower(v):"";
  if(!v||typeof v!=="object")return "";
  for(const k of ["hash","address_hash","address","token_address","contract_address"]){
    if(v[k]!==undefined){const x=extractAddress(v[k]);if(x)return x;}
  }
  return "";
}
function officialToken(a){return lower(a)===GLITCH;}
function hexNum(v){try{return Number(BigInt(v||"0x0"));}catch{return 0;}}
function safeBig(v){try{return BigInt(String(v||"0"));}catch{return 0n;}}
function pctBig(a,b){if(!b||b<=0n)return null;return Number((a*1000000n)/b)/10000;}
function ageSec(ts){const t=typeof ts==="number"?ts:(Date.parse(ts||"")/1000);return Number.isFinite(t)?Math.max(0,Math.floor(Date.now()/1000-t)):null;}
function shortAddress(a){return addr(a)?`${a.slice(0,6)}…${a.slice(-4)}`:String(a||"");}
function tokenIsQuoteLike(t){return !!t&&(QUOTE_TOKENS.has(lower(t.address))||QUOTE_SYMBOLS.has(String(t.symbol||"").toUpperCase()));}
function tokenLooksStock(t,stockAddresses=new Set()){return !!t&&(stockAddresses.has(lower(t.address))||/robinhood\s+token|stock\s+token/i.test(String(t.name||"")));}
async function stockAddresses(){
  if(STOCK_CACHE.addresses.size&&Date.now()-STOCK_CACHE.at<300000)return STOCK_CACHE.addresses;
  if(STOCK_LOADING)return STOCK_LOADING;
  STOCK_LOADING=(async()=>{try{const xs=await getAssets();STOCK_CACHE={at:Date.now(),addresses:new Set(xs.map(x=>lower(x.address)).filter(addr))};}catch{if(!STOCK_CACHE.addresses.size)STOCK_CACHE={at:Date.now(),addresses:new Set()};}return STOCK_CACHE.addresses;})();
  try{return await STOCK_LOADING;}finally{STOCK_LOADING=null;}
}
function chooseSubject(base,quote,ctx={}){
  const preferred=lower(ctx.preferredAddress);const preferredSet=ctx.preferredSet instanceof Set?ctx.preferredSet:new Set();const stocks=ctx.stockAddresses instanceof Set?ctx.stockAddresses:new Set();
  if(preferred&&base.address===preferred)return {target:base,other:quote,isBase:true};
  if(preferred&&quote.address===preferred)return {target:quote,other:base,isBase:false};
  const bPref=preferredSet.has(base.address),qPref=preferredSet.has(quote.address);
  if(bPref!==qPref)return bPref?{target:base,other:quote,isBase:true}:{target:quote,other:base,isBase:false};
  const bQuote=tokenIsQuoteLike(base),qQuote=tokenIsQuoteLike(quote);
  if(bQuote!==qQuote)return bQuote?{target:quote,other:base,isBase:false}:{target:base,other:quote,isBase:true};
  // For meme/utility markets quoted in a Robinhood Stock Token (e.g. ARTIFICIAL INU / NVDA),
  // the non-stock asset is the market subject and the Stock Token is the quote asset.
  const bStock=tokenLooksStock(base,stocks),qStock=tokenLooksStock(quote,stocks);
  if(bStock!==qStock)return bStock?{target:quote,other:base,isBase:false}:{target:base,other:quote,isBase:true};
  return {target:base,other:quote,isBase:true};
}

async function fetchJson(url,timeout=9000,headers={}){
  let last=null;
  for(let attempt=0;attempt<2;attempt++){
    const ctrl=new AbortController();const timer=setTimeout(()=>ctrl.abort(),timeout);
    try{
      const r=await fetch(url,{headers:{accept:"application/json","user-agent":"Mozilla/5.0 (compatible; DEAD-PIXELS-GLITCH-ALPHA/3.7.5; +https://www.deadpixelslabs.com/)",...headers},signal:ctrl.signal});
      const text=await r.text();let body={};try{body=text?JSON.parse(text):{};}catch{throw new Error(`INVALID_JSON_${r.status}`);}
      if(r.ok)return body;
      const err=new Error(body?.message||body?.error||`HTTP_${r.status}`);err.status=r.status;last=err;
      if(attempt===0&&(r.status===429||r.status>=500)){const wait=Math.min(1200,250+n(r.headers.get("retry-after"))*1000);await new Promise(ok=>setTimeout(ok,wait));continue;}
      throw err;
    }catch(e){last=e;if(attempt===0&&(e?.name==="AbortError"||/fetch|network|429|HTTP_5/i.test(String(e?.message||e)))){await new Promise(ok=>setTimeout(ok,300));continue;}throw e;}
    finally{clearTimeout(timer);}
  }
  throw last||new Error("FETCH_FAILED");
}
async function cachedJson(url,ttl=55000,timeout=9000,headers={}){
  const now=Date.now(),hit=HTTP_CACHE.get(url);if(hit&&now-hit.at<ttl)return hit.value;
  const value=await fetchJson(url,timeout,headers);HTTP_CACHE.set(url,{at:now,value});
  if(HTTP_CACHE.size>120){const oldest=[...HTTP_CACHE.entries()].sort((a,b)=>a[1].at-b[1].at).slice(0,30);oldest.forEach(([k])=>HTTP_CACHE.delete(k));}
  return value;
}
async function rpc(method,params){
  const ctrl=new AbortController();const timer=setTimeout(()=>ctrl.abort(),9000);
  try{
    const r=await fetch(RPC,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method,params}),signal:ctrl.signal});
    const j=await r.json();if(j.error)throw new Error(j.error.message||"RPC_ERROR");return j.result;
  }finally{clearTimeout(timer);}
}
async function call(to,data){return rpc("eth_call",[{to,data},"latest"]);}
function decodeString(hex){
  if(!hex||hex==="0x")return "";const s=hex.slice(2);
  try{
    if(s.length===64)return Buffer.from(s.replace(/(00)+$/,""),"hex").toString("utf8").replace(/\0/g,"").trim();
    if(s.length>=128){const off=Number(BigInt("0x"+s.slice(0,64)))*2;const len=Number(BigInt("0x"+s.slice(off,off+64)));return Buffer.from(s.slice(off+64,off+64+len*2),"hex").toString("utf8").replace(/\0/g,"").trim();}
  }catch{}return "";
}
function decodeAddress(hex){if(!hex||hex.length<42)return null;const a="0x"+hex.slice(-40);return addr(a)&&!/^0x0{40}$/i.test(a)?a:null;}
async function tokenMeta(address){
  if(!addr(address))throw new Error("INVALID_TOKEN");
  const [d,s,nm,ts,own]=await Promise.allSettled([
    call(address,"0x313ce567"),call(address,"0x95d89b41"),call(address,"0x06fdde03"),call(address,"0x18160ddd"),call(address,"0x8da5cb5b")
  ]);
  if(d.status!=="fulfilled")throw new Error("NOT_ERC20");
  const decimals=hexNum(d.value);if(decimals<0||decimals>255)throw new Error("INVALID_DECIMALS");
  return {address,symbol:s.status==="fulfilled"?(decodeString(s.value)||"TOKEN"):"TOKEN",name:nm.status==="fulfilled"?(decodeString(nm.value)||"ERC20"):"ERC20",decimals,totalSupplyRaw:ts.status==="fulfilled"?safeBig(ts.value).toString():null,owner:own.status==="fulfilled"?decodeAddress(own.value):null};
}

function gtToken(rel,included){
  const id=rel?.data?.id;if(!id)return null;const x=included.get(id);const a=x?.attributes||{};const address=lower(a.address||id.slice(id.indexOf("_")+1));
  return {address,name:a.name||"Token",symbol:a.symbol||"TOKEN",decimals:n(a.decimals,18),imageUrl:a.image_url||null};
}
function scorePool(p){
  const liq=Math.max(0,n(p.liquidityUsd));
  const vol=Math.max(0,n(p.volume?.h24));
  const fdv=Math.max(0,n(p.fdv));
  const h24tx=p.txns?.h24||{},h1tx=p.txns?.h1||{};
  const tx24=n(h24tx.buys)+n(h24tx.sells),buys=n(h1tx.buys),sells=n(h1tx.sells),total=buys+sells;
  const m5=clamp(n(p.priceChange?.m5),-40,40),h1=clamp(n(p.priceChange?.h1),-100,100),h6=clamp(n(p.priceChange?.h6),-200,200),h24=clamp(n(p.priceChange?.h24),-400,400);
  let momentum=clamp(50+m5*.45+h1*.55+h6*.16+h24*.055);
  const extreme=Math.max(0,Math.abs(n(p.priceChange?.m5))-50)*.18+Math.max(0,Math.abs(n(p.priceChange?.h1))-180)*.05;
  momentum=clamp(momentum-Math.min(22,extreme));
  const depthAbs=clamp((Math.log10(liq+1)-3)*35);
  const structure=fdv>0?clamp((liq/fdv)*180):50;
  const liquidity=clamp(depthAbs*.62+structure*.38);
  const volAbs=clamp((Math.log10(vol+1)-2)*25);
  const turnover=liq>0?clamp((vol/liq)*70):0;
  const txScore=clamp(Math.log10(tx24+1)*38);
  const activity=clamp(volAbs*.42+turnover*.30+txScore*.28);
  const flow=total?clamp(50+(buys-sells)/total*30):50;
  const age=p.ageSeconds;
  let maturity=50;
  if(age!=null){maturity=age<600?15:age<3600?30:age<21600?45:age<86400?60:age<604800?75:85;}
  let score=Math.round(momentum*.17+liquidity*.20+activity*.18+flow*.10+maturity*.20+structure*.15);
  // Low-liquidity *new* markets cannot rank as strong alpha merely because they pumped.
  if(liq>0&&liq<2000&&age!=null&&age<86400)score=Math.min(score,32);
  else if(liq>0&&liq<5000&&age!=null&&age<3600)score=Math.min(score,42);
  else if(liq>0&&liq<10000&&age!=null&&age<600)score=Math.min(score,48);
  score=clamp(score);
  return {score,components:{momentum:Math.round(momentum),liquidity:Math.round(liquidity),activity:Math.round(activity),flow:Math.round(flow),novelty:Math.round(maturity),structure:Math.round(structure)},verdict:score>=82?"ALPHA":score>=70?"HOT":score>=55?"ACTIVE":score>=40?"WATCH":"COLD",model:"V3.7.5"};
}
function normalizeDex(p,ctx={}){
  if(!p||lower(p.chainId)!==NETWORK)return null;
  const base={...p.baseToken,address:lower(p.baseToken?.address)},quote={...p.quoteToken,address:lower(p.quoteToken?.address)};
  if(!addr(base.address)||!addr(quote.address))return null;
  const pick=chooseSubject(base,quote,ctx),target=pick.target,other=pick.other,isBase=pick.isBase;
  const baseUsd=n(p.priceUsd),baseNative=n(p.priceNative);const priceUsd=isBase?baseUsd:(baseUsd>0&&baseNative>0?baseUsd/baseNative:0);
  const changes=isBase?(p.priceChange||{}):Object.fromEntries(Object.entries(p.priceChange||{}).map(([k,v])=>[k,-n(v)]));
  const txns=isBase?(p.txns||{}):Object.fromEntries(Object.entries(p.txns||{}).map(([k,v])=>[k,{...v,buys:n(v?.sells),sells:n(v?.buys),buyers:n(v?.sellers),sellers:n(v?.buyers)}]));
  const x={source:"DEXSCREENER",address:target.address,symbol:target.symbol||"TOKEN",name:target.name||target.symbol||"Token",imageUrl:p.info?.imageUrl||null,pairAddress:lower(p.pairAddress),dexId:p.dexId||"DEX",labels:p.labels||[],quoteAddress:other.address,quoteSymbol:other.symbol||"PAIR",pairLabel:`${target.symbol||"TOKEN"}/${other.symbol||"PAIR"}`,tokenSide:isBase?"base":"quote",priceUsd,priceNative:isBase?baseNative:(baseNative>0?1/baseNative:0),liquidityUsd:n(p.liquidity?.usd),fdv:isBase?optNum(p.fdv):null,marketCap:isBase?optNum(p.marketCap):null,pairCreatedAt:p.pairCreatedAt||null,ageSeconds:p.pairCreatedAt?Math.max(0,Math.floor(Date.now()/1000-p.pairCreatedAt/1000)):null,volume:p.volume||{},priceChange:changes,txns,boosts:n(p.boosts?.active),websites:p.info?.websites||[],socials:p.info?.socials||[],url:p.url||null,official:officialToken(target.address)};
  x.glitch=scorePool(x);return x;
}
function normalizeGT(r,included,ctx={}){
  if(!r)return null;const a=r.attributes||{},rels=r.relationships||{};const base=gtToken(rels.base_token,included),quote=gtToken(rels.quote_token,included);if(!base||!quote)return null;
  const pick=chooseSubject(base,quote,ctx),target=pick.target,other=pick.other,isBase=pick.isBase;const poolAddress=lower(a.address||String(r.id||"").slice(String(r.id||"").indexOf("_")+1));
  const rawTx=a.transactions||{};const tx=isBase?rawTx:Object.fromEntries(Object.entries(rawTx).map(([k,v])=>[k,{...v,buys:n(v?.sells),sells:n(v?.buys),buyers:n(v?.sellers),sellers:n(v?.buyers)}]));
  const rawChanges=a.price_change_percentage||{};const changes=isBase?rawChanges:Object.fromEntries(Object.entries(rawChanges).map(([k,v])=>[k,-n(v)]));
  const x={source:"GECKOTERMINAL",address:target.address,symbol:target.symbol,name:target.name,imageUrl:target.imageUrl,pairAddress:poolAddress,dexId:String(rels.dex?.data?.id||"DEX").replace(`${NETWORK}_`,""),quoteAddress:other.address,quoteSymbol:other.symbol||"PAIR",pairLabel:`${target.symbol||"TOKEN"}/${other.symbol||"PAIR"}`,tokenSide:isBase?"base":"quote",priceUsd:n(isBase?a.base_token_price_usd:a.quote_token_price_usd),priceNative:n(isBase?a.base_token_price_native_currency:a.quote_token_price_native_currency),liquidityUsd:n(a.reserve_in_usd),fdv:isBase?optNum(a.fdv_usd):null,marketCap:isBase?optNum(a.market_cap_usd):null,pairCreatedAt:a.pool_created_at||null,ageSeconds:ageSec(a.pool_created_at),volume:a.volume_usd||{},priceChange:changes,txns:tx,url:null,official:officialToken(target.address)};x.glitch=scorePool(x);return x;
}
async function geckoPools(kind="trending_pools",page=1){
  const path=kind==="pools"?`/networks/${NETWORK}/pools`:`/networks/${NETWORK}/${kind}`;
  const [j,stocks]=await Promise.all([cachedJson(`${GECKO}${path}?include=base_token,quote_token,dex&page=${Math.max(1,n(page,1))}`,55000,9000,{accept:"application/json;version=20230203"}),stockAddresses()]);
  const inc=new Map((j.included||[]).map(x=>[x.id,x]));return (j.data||[]).map(x=>normalizeGT(x,inc,{stockAddresses:stocks})).filter(Boolean);
}
async function dexSearch(q){const [j,stocks]=await Promise.all([fetchJson(`${DEX}/latest/dex/search?q=${encodeURIComponent(q)}`),stockAddresses()]);const pref=addr(q)?lower(q):null;return (j.pairs||[]).map(x=>normalizeDex(x,{preferredAddress:pref,stockAddresses:stocks})).filter(Boolean);}
async function dexPairs(address){if(!addr(address))return[];const a=lower(address);const [j,stocks]=await Promise.all([fetchJson(`${DEX}/token-pairs/v1/${NETWORK}/${a}`),stockAddresses()]);const raw=Array.isArray(j)?j:(j.pairs||[]);return raw.map(x=>normalizeDex(x,{preferredAddress:a,stockAddresses:stocks})).filter(Boolean);}
async function dexMulti(addresses){const xs=[...new Set(addresses.map(lower).filter(addr))].slice(0,30);if(!xs.length)return[];const [j,stocks]=await Promise.all([fetchJson(`${DEX}/tokens/v1/${NETWORK}/${xs.join(",")}`),stockAddresses()]);const raw=Array.isArray(j)?j:(j.pairs||[]),preferredSet=new Set(xs);return raw.map(x=>normalizeDex(x,{preferredSet,stockAddresses:stocks})).filter(Boolean);}
async function blockSearch(q){
  const j=await fetchJson(`${BLOCKSCOUT}/api/v2/search?q=${encodeURIComponent(q)}`);
  return (j.items||[]).filter(x=>String(x.type||"").toLowerCase()==="token"&&String(x.token_type||x.type||"").toUpperCase().includes("ERC-20")).map(x=>{const address=extractAddress(x.address_hash||x.address);return {source:"BLOCKSCOUT",address,symbol:x.symbol||"TOKEN",name:x.name||x.symbol||"Token",imageUrl:x.icon_url||null,holders:n(x.holders_count||x.holders),marketCap:optNum(x.circulating_market_cap),priceUsd:optNum(x.exchange_rate),verified:!!x.is_smart_contract_verified,official:officialToken(address),glitch:{score:0,verdict:"UNPRICED",components:{}}};}).filter(x=>addr(x.address));
}
function mergePools(...groups){
  const map=new Map();
  for(const p of groups.flat()){
    if(!p||!addr(p.address))continue;
    const k=`${p.address}:${p.pairAddress||p.source||"token"}`;
    const old=map.get(k);
    if(!old||n(p.liquidityUsd)>n(old.liquidityUsd))map.set(k,{...old,...p,official:officialToken(p.address)||p.official});
  }
  return [...map.values()];
}
function sumPeriod(pools,key,field){return pools.reduce((a,p)=>a+n(p?.[key]?.[field]),0);}
function aggregateTokenMarkets(pools){
  const by=new Map();for(const p of pools){if(!p||!addr(p.address))continue;(by.get(p.address)||by.set(p.address,[]).get(p.address)).push(p);}
  const out=[];
  for(const [address,ps] of by){
    const primary=[...ps].sort((a,b)=>n(b.liquidityUsd)-n(a.liquidityUsd))[0];
    const uniq=[...new Map(ps.map(x=>[x.pairAddress||`${x.source}:${x.address}`,x])).values()];
    const volume={},txns={};for(const tf of ["m5","h1","h6","h24"]){volume[tf]=sumPeriod(uniq,"volume",tf);txns[tf]={buys:uniq.reduce((a,p)=>a+n(p.txns?.[tf]?.buys),0),sells:uniq.reduce((a,p)=>a+n(p.txns?.[tf]?.sells),0),buyers:uniq.reduce((a,p)=>a+n(p.txns?.[tf]?.buyers),0),sellers:uniq.reduce((a,p)=>a+n(p.txns?.[tf]?.sellers),0)};}
    const marketCap=ps.map(x=>optNum(x.marketCap)).find(x=>x!=null&&x>0)??null;
    const fdv=ps.map(x=>optNum(x.fdv)).find(x=>x!=null&&x>0)??null;
    const ages=ps.map(x=>x.ageSeconds).filter(x=>x!=null&&Number.isFinite(Number(x)));
    const z={...primary,address,official:officialToken(address)||ps.some(x=>x.official),liquidityUsd:uniq.reduce((a,p)=>a+n(p.liquidityUsd),0),volume,txns,marketCap,fdv,ageSeconds:ages.length?Math.max(...ages):primary.ageSeconds,poolCount:uniq.length,source:[...new Set(ps.map(x=>x.source).filter(Boolean))].join("+")};
    z.glitch=scorePool(z);out.push(z);
  }
  return out;
}
function bestMarketsByToken(pools){
  const by=new Map();
  for(const p of pools||[]){if(!p||!addr(p.address))continue;const old=by.get(p.address);if(!old||n(p.liquidityUsd)>n(old.liquidityUsd))by.set(p.address,p);}
  return [...by.values()];
}
function sortFeed(items,mode="score"){
  const a=[...items];
  const fn=mode==="new"?(x=>x.ageSeconds??1e15):mode==="gainers"?(x=>-n(x.priceChange?.h24)):mode==="volume"?(x=>-n(x.volume?.h24)):mode==="liquidity"?(x=>-n(x.liquidityUsd)):(x=>-n(x.glitch?.score));
  return a.sort((x,y)=>fn(x)-fn(y));
}
function qualifiedTrending(x){const liq=n(x.liquidityUsd),vol=n(x.volume?.h24),tx=n(x.txns?.h24?.buys)+n(x.txns?.h24?.sells);return x.official||(liq>=5000&&vol>=2000&&tx>=12);}
function qualifiedVolume(x){const liq=n(x.liquidityUsd),vol=n(x.volume?.h24),tx=n(x.txns?.h24?.buys)+n(x.txns?.h24?.sells);return liq>=10000&&vol>=25000&&tx>=25;}
function qualifiedGainer(x){const liq=n(x.liquidityUsd),vol=n(x.volume?.h24),tx=n(x.txns?.h24?.buys)+n(x.txns?.h24?.sells);return liq>=10000&&vol>=10000&&tx>=20;}
async function overview(){
  const jobs=[geckoPools("trending_pools",1),geckoPools("new_pools",1),geckoPools("pools",1),geckoPools("pools",2),geckoPools("pools",3),dexPairs(GLITCH)];
  const settled=await Promise.allSettled(jobs);const names=["GECKO_TRENDING","GECKO_NEW","GECKO_TOP_1","GECKO_TOP_2","GECKO_TOP_3","DEX_PINNED"];const sources={};
  settled.forEach((s,i)=>{sources[names[i]]=s.status==="fulfilled"?"ONLINE":`ERROR: ${s.reason?.message||"FAILED"}`;});
  const trendingRaw=settled[0].status==="fulfilled"?settled[0].value:[];const newRaw=settled[1].status==="fulfilled"?settled[1].value:[];const pinned=settled[5].status==="fulfilled"?settled[5].value:[];
  // V3.7.2 ranks MARKETS/PAIRS, not token-wide aggregates. This preserves the real market identity
  // (e.g. ARTIFICIAL INU / NVDA) and makes the score shown in the feed reproducible in detail.
  const markets=mergePools(...settled.flatMap(s=>s.status==="fulfilled"?s.value:[]));
  const trendMarkets=mergePools(...trendingRaw,...pinned,...markets.filter(qualifiedTrending));
  const trending=sortFeed(trendMarkets.filter(qualifiedTrending),"score").slice(0,60);
  const volume=sortFeed(markets.filter(qualifiedVolume),"volume").slice(0,60);
  const gainers=sortFeed(markets.filter(qualifiedGainer),"gainers").slice(0,60);
  return {chainId:CHAIN_ID,network:NETWORK,generatedAt:new Date().toISOString(),sources,count:markets.length,trending,newest:sortFeed(mergePools(...newRaw),"new").slice(0,60),gainers,volume,thresholds:{trending:{minLiquidityUsd:5000,minVolume24hUsd:2000,minTx24h:12},volume:{minLiquidityUsd:10000,minVolume24hUsd:25000,minTx24h:25},gainers:{minLiquidityUsd:10000,minVolume24hUsd:10000,minTx24h:20}},rankingUnit:"MARKET_PAIR"};
}
function tokenFromBlockscout(x){const address=extractAddress(x.address||x.address_hash);return {source:"BLOCKSCOUT",address,symbol:x.symbol||"TOKEN",name:x.name||x.symbol||"Token",imageUrl:x.icon_url||null,holders:n(x.holders||x.holders_count),marketCap:optNum(x.circulating_market_cap),fdv:null,priceUsd:optNum(x.exchange_rate),totalSupplyRaw:x.total_supply?String(x.total_supply):null,official:officialToken(address),glitch:{score:0,verdict:"UNPRICED",components:{}}};}
function encodeCursor(v){if(!v)return null;try{return Buffer.from(JSON.stringify(v)).toString("base64url");}catch{return null;}}
function decodeCursor(v){if(!v)return null;try{const x=JSON.parse(Buffer.from(String(v),"base64url").toString("utf8"));return x&&typeof x==="object"?x:null;}catch{return null;}}
async function blockTokenCatalogPage(cursor=null){
  const next=decodeCursor(cursor);const qs=new URLSearchParams({type:"ERC-20"});
  if(next)for(const [k,v] of Object.entries(next)){if(v!==null&&v!==undefined)qs.set(k,String(v));}
  const j=await cachedJson(`${BLOCKSCOUT}/api/v2/tokens?${qs.toString()}`,45000,9000);
  const items=(j.items||[]).map(tokenFromBlockscout).filter(x=>addr(x.address));
  return {items,nextCursor:encodeCursor(j.next_page_params||null)};
}
async function catalog(cursor=null){
  const page=await blockTokenCatalogPage(cursor);const unique=[...new Map(page.items.map(x=>[x.address,x])).values()];
  const chunks=[];for(let i=0;i<unique.length;i+=30)chunks.push(unique.slice(i,i+30).map(x=>x.address));
  const ms=await Promise.allSettled(chunks.map(dexMulti));const markets=bestMarketsByToken(mergePools(...ms.flatMap(x=>x.status==="fulfilled"?x.value:[])));const best=new Map(markets.map(x=>[x.address,x]));
  const items=unique.map(t=>best.has(t.address)?{...t,...best.get(t.address),holders:t.holders||null,imageUrl:best.get(t.address).imageUrl||t.imageUrl,official:officialToken(t.address)}:t);
  items.sort((a,b)=>(b.official?1:0)-(a.official?1:0)||n(b.holders)-n(a.holders)||String(a.symbol).localeCompare(String(b.symbol)));
  return {items,count:items.length,nextCursor:page.nextCursor,source:"BLOCKSCOUT CURSOR PAGE + DEX ENRICHMENT",note:"Use nextCursor to continue browsing the complete ERC-20 catalog."};
}
async function search(q){
  const term=String(q||"").trim();if(!term)return {items:[]};
  const jobs=[dexSearch(term),blockSearch(term)];if(addr(term))jobs.push(dexPairs(lower(term)));
  const settled=await Promise.allSettled(jobs);let dex=[];for(const i of [0,2])if(settled[i]?.status==="fulfilled")dex.push(...settled[i].value);const bs=settled[1].status==="fulfilled"?settled[1].value:[];
  const markets=bestMarketsByToken(mergePools(...dex));const bestByToken=new Map(markets.map(x=>[x.address,x]));
  for(const t of bs){if(!bestByToken.has(t.address))bestByToken.set(t.address,t);else{const x=bestByToken.get(t.address);x.verified=t.verified;x.holders=t.holders;x.marketCap=x.marketCap??t.marketCap;x.imageUrl=x.imageUrl||t.imageUrl;x.official=officialToken(x.address);}}
  if(addr(term)&&!bestByToken.has(lower(term))){try{const meta=await tokenMeta(lower(term));bestByToken.set(lower(term),{...meta,source:"RPC",official:officialToken(term),glitch:{score:0,verdict:"UNPRICED",components:{}}});}catch{}}
  return {query:term,items:sortFeed([...bestByToken.values()],"score").slice(0,80),sources:{DEXSCREENER:settled[0].status==="fulfilled"?"ONLINE":"ERROR",BLOCKSCOUT:settled[1].status==="fulfilled"?"ONLINE":"ERROR",RPC:addr(term)?"FALLBACK":"IDLE"}};
}
async function recentMintSignals(blocks=120){
  const latest=hexNum(await rpc("eth_blockNumber",[]));const from=Math.max(0,latest-Math.max(10,Math.min(500,n(blocks,120))));
  const logs=await rpc("eth_getLogs",[{fromBlock:"0x"+from.toString(16),toBlock:"latest",topics:[TRANSFER_TOPIC,ZERO_TOPIC]}]);
  const seen=new Map();for(const l of logs||[]){const a=lower(l.address);if(!addr(a)||QUOTE_TOKENS.has(a))continue;const bn=hexNum(l.blockNumber);const old=seen.get(a);if(!old||bn>old.blockNumber)seen.set(a,{address:a,blockNumber:bn,txHash:l.transactionHash});}
  let sig=[...seen.values()].sort((a,b)=>b.blockNumber-a.blockNumber).slice(0,20);if(!sig.length)return {latestBlock:latest,fromBlock:from,items:[]};
  const blockNums=[...new Set(sig.map(x=>x.blockNumber))].slice(0,12);const blockSettled=await Promise.allSettled(blockNums.map(b=>rpc("eth_getBlockByNumber",["0x"+b.toString(16),false])));const bt=new Map();blockSettled.forEach((x,i)=>{if(x.status==="fulfilled")bt.set(blockNums[i],hexNum(x.value?.timestamp));});
  const metaSettled=await Promise.allSettled(sig.map(x=>tokenMeta(x.address)));const markets=await dexMulti(sig.map(x=>x.address)).catch(()=>[]);const mMap=new Map();for(const p of markets){const old=mMap.get(p.address);if(!old||p.liquidityUsd>old.liquidityUsd)mMap.set(p.address,p);}
  sig=sig.map((x,i)=>{const meta=metaSettled[i].status==="fulfilled"?metaSettled[i].value:null;if(!meta)return null;const market=mMap.get(x.address);const ts=bt.get(x.blockNumber);const z={...market,...meta,address:x.address,source:market?"ONCHAIN+DEXSCREENER":"ONCHAIN",signal:"ZERO_ADDRESS_MINT",blockNumber:x.blockNumber,txHash:x.txHash,ageSeconds:ts?Math.max(0,Math.floor(Date.now()/1000-ts)):null};if(!z.glitch)z.glitch=scorePool(z);return z;}).filter(Boolean);
  return {latestBlock:latest,fromBlock:from,items:sig};
}
async function justBorn(){
  const [onchain,newPools]=await Promise.allSettled([recentMintSignals(120),geckoPools("new_pools")]);const oc=onchain.status==="fulfilled"?onchain.value:{items:[]};const np=newPools.status==="fulfilled"?newPools.value:[];
  const by=new Map();for(const x of [...oc.items,...np]){const old=by.get(x.address);if(!old)by.set(x.address,x);else by.set(x.address,{...x,...old,imageUrl:old.imageUrl||x.imageUrl,pairAddress:old.pairAddress||x.pairAddress,liquidityUsd:Math.max(n(old.liquidityUsd),n(x.liquidityUsd)),glitch:n(old.glitch?.score)>=n(x.glitch?.score)?old.glitch:x.glitch});}
  return {generatedAt:new Date().toISOString(),latestBlock:oc.latestBlock||null,fromBlock:oc.fromBlock||null,items:[...by.values()].sort((a,b)=>(a.ageSeconds??1e15)-(b.ageSeconds??1e15)).slice(0,50),sources:{ONCHAIN:onchain.status==="fulfilled"?"ONLINE":"ERROR",GECKO_NEW:newPools.status==="fulfilled"?"ONLINE":"ERROR"}};
}
function normalizeHolderBody(body){
  const src=Array.isArray(body?.items)?body.items:Array.isArray(body?.result)?body.result:[];
  const items=src.map(x=>({
    ...x,
    address:extractAddress(x.address_hash||x.address||x),
    value:String(x.value??x.balance??x.token_balance??"0")
  })).filter(x=>addr(x.address)&&safeBig(x.value)>0n);
  return {items,next_page_params:body?.next_page_params||null,legacy:!!Array.isArray(body?.result)};
}
async function legacyTokenHolders(address,offset=500){
  const a=lower(address);if(!addr(a))return null;
  const u=`${BLOCKSCOUT}/api?module=token&action=getTokenHolders&contractaddress=${a}&page=1&offset=${Math.max(20,Math.min(1000,n(offset,500)))}`;
  const j=await cachedJson(u,30000,12000);
  if(String(j?.status||"")==="0"&&!Array.isArray(j?.result))throw new Error(j?.message||"LEGACY_HOLDERS_FAILED");
  return normalizeHolderBody(j);
}
async function getBlockscoutDetail(address){
  const a=lower(address);
  // Holder data is the highest-priority Blockscout enrichment. The public per-instance
  // API is rate-limited, so requests are intentionally staggered instead of burst in parallel.
  const out={token:null,address:null,counters:null,holders:null,source:null,search:null,holderSources:{v2:0,legacy:0},holderErrors:{}};
  try{out.token=await cachedJson(`${BLOCKSCOUT}/api/v2/tokens/${a}`,45000,12000);}catch(e){out.holderErrors.token=e?.message||"TOKEN_INFO_FAILED";}
  await new Promise(ok=>setTimeout(ok,380));
  try{const raw=await cachedJson(`${BLOCKSCOUT}/api/v2/tokens/${a}/holders`,30000,12000);const v2=normalizeHolderBody(raw);out.holderSources.v2=v2?.items?.length||0;out.holders=v2;}catch(e){out.holderErrors.v2=e?.message||"V2_HOLDERS_FAILED";}
  await new Promise(ok=>setTimeout(ok,380));
  try{out.address=await cachedJson(`${BLOCKSCOUT}/api/v2/addresses/${a}`,45000,11000);}catch(e){out.holderErrors.address=e?.message||"ADDRESS_INFO_FAILED";}
  await new Promise(ok=>setTimeout(ok,380));
  try{out.source=await cachedJson(`${BLOCKSCOUT}/api/v2/smart-contracts/${a}`,70000,11000);}catch(e){out.holderErrors.source=e?.message||"SOURCE_INFO_FAILED";}
  // Legacy holder endpoint is fallback-only and is never called when V2 already returned a map.
  if(!out.holders?.items?.length){
    await new Promise(ok=>setTimeout(ok,380));
    try{const legacy=await legacyTokenHolders(a,500);out.holderSources.legacy=legacy?.items?.length||0;if(legacy?.items?.length)out.holders=legacy;}
    catch(e){out.holderErrors.legacy=e?.message||"LEGACY_HOLDERS_FAILED";}
  }
  // holders_count is part of token info. Search is a last-resort count source only.
  const t=out.token||out.address?.token||{};
  const known=[t?.holders_count,t?.holders,out.address?.token?.holders_count,out.address?.token?.holders].map(x=>n(x)).filter(x=>x>0);
  if(!known.length){
    await new Promise(ok=>setTimeout(ok,380));
    try{out.search=await cachedJson(`${BLOCKSCOUT}/api/v2/search?q=${encodeURIComponent(a)}`,45000,11000);}catch(e){out.holderErrors.search=e?.message||"SEARCH_FAILED";}
  }
  return out;
}
function abiSignals(src){
  const first=Array.isArray(src?.result)?src.result[0]:src;let abi=[];
  try{abi=Array.isArray(first?.abi)?first.abi:typeof first?.abi==="string"?JSON.parse(first.abi):typeof first?.ABI==="string"?JSON.parse(first.ABI):Array.isArray(first?.ABI)?first.ABI:[];}catch{}
  const names=abi.filter(x=>x.type==="function").map(x=>String(x.name||"").toLowerCase());const has=re=>names.some(x=>re.test(x));
  const verified=!!(first?.is_verified||first?.is_fully_verified||src?.status==="1");const implementation=extractAddress(first?.minimal_proxy_address_hash||first?.implementation_address||first?.Implementation);
  return {verified,proxy:!!implementation||String(first?.Proxy||"0")==="1",mintEntrypoint:has(/mint/),blacklistEntrypoint:has(/blacklist|denylist|blocklist/),pauseEntrypoint:has(/^pause$|^unpause$|setpause|pausetrading/),taxEntrypoint:has(/tax|fee/),maxTxEntrypoint:has(/maxtx|maxwallet|limits/),ownershipEntrypoint:has(/transferownership|renounceownership/),functionCount:names.length,contractName:first?.name||first?.ContractName||null,implementation:implementation||null};
}
function holderStats(holderBody,totalSupplyRaw,creator,pairAddresses=[]){
  const total=safeBig(totalSupplyRaw);const excluded=new Set([ZERO,DEAD,...pairAddresses.map(lower).filter(addr)]);
  const norm=normalizeHolderBody(holderBody||{});const raw=norm.items.map(x=>({address:x.address,valueRaw:String(x.value||"0")}));
  const circulating=raw.filter(x=>!excluded.has(x.address));const top10=circulating.slice(0,10).reduce((a,x)=>a+safeBig(x.valueRaw),0n);const top20=circulating.slice(0,20).reduce((a,x)=>a+safeBig(x.valueRaw),0n);const creatorItem=raw.find(x=>x.address===lower(creator));
  const top=raw.slice(0,20).map(x=>({...x,pct:pctBig(safeBig(x.valueRaw),total),role:x.address===lower(creator)?"DEPLOYER":x.address===DEAD?"BURN":pairAddresses.map(lower).includes(x.address)?"POOL":KNOWN_LP_LOCKERS.has(x.address)?"LOCKER":"HOLDER"}));
  return {top10Pct:pctBig(top10,total),top20Pct:pctBig(top20,total),creatorPct:creatorItem?pctBig(safeBig(creatorItem.valueRaw),total):null,top,sampleCount:raw.length,sampleHasMore:!!holderBody?.next_page_params,source:norm.legacy?"BLOCKSCOUT LEGACY":"BLOCKSCOUT V2"};
}
function riskModel(market,sec,holders,age){
  let r=0;const flags=[];const add=(v,msg)=>{r+=v;flags.push(msg);};
  if(!sec.verified)add(12,"CONTRACT UNVERIFIED");if(sec.proxy)add(5,"PROXY / IMPLEMENTATION");if(sec.mintEntrypoint)add(9,"MINT ENTRYPOINT PRESENT");if(sec.blacklistEntrypoint)add(16,"BLACKLIST-LIKE ENTRYPOINT");if(sec.pauseEntrypoint)add(7,"PAUSE ENTRYPOINT");if(sec.taxEntrypoint)add(5,"FEE/TAX ENTRYPOINT");
  const t10=n(holders.top10Pct,-1);if(t10>=80)add(30,"TOP 10 EXTREME CONCENTRATION");else if(t10>=60)add(22,"TOP 10 HIGH CONCENTRATION");else if(t10>=40)add(12,"TOP 10 CONCENTRATION");
  const cp=n(holders.creatorPct,-1);if(cp>=20)add(22,"CREATOR HOLDS ≥20%");else if(cp>=10)add(12,"CREATOR HOLDS ≥10%");
  const liq=n(market?.liquidityUsd);if(market&&liq<3000)add(18,"VERY LOW LIQUIDITY");else if(market&&liq<10000)add(10,"LOW LIQUIDITY");
  const h1=market?.txns?.h1||{};if(n(h1.buys)>=5&&n(h1.sells)===0)add(12,"NO RECENT SELLS OBSERVED");
  if(age!=null&&age<600)add(5,"EXTREMELY NEW MARKET");
  const score=clamp(Math.round(r));return {score,level:score>=75?"EXTREME":score>=55?"HIGH":score>=30?"MEDIUM":"LOW",flags:flags.slice(0,8),note:"Signal-based risk model; not a guarantee of safety or sellability."};
}
async function getTrades(pool){
  if(!poolId(pool))return[];try{const j=await cachedJson(`${GECKO}/networks/${NETWORK}/pools/${pool}/trades`,15000,9000,{accept:"application/json;version=20230203"});return (j.data||[]).slice(0,50).map(x=>{const a=x.attributes||{};return {txHash:a.tx_hash||null,wallet:a.tx_from_address||null,kind:String(a.kind||"").toUpperCase(),volumeUsd:n(a.volume_in_usd),fromAmount:n(a.from_token_amount),toAmount:n(a.to_token_amount),timestamp:a.block_timestamp||a.timestamp||null};});}catch{return[];}
}
function normalizeList(v){return Array.isArray(v)?v:(Array.isArray(v?.items)?v.items:(v&&typeof v==="object"?[v]:[]));}
async function dexPaidIntel(address,market){
  const a=lower(address);if(!addr(a))return {status:"UNKNOWN",paid:null,orders:[],paidOrders:[],boosts:n(market?.boosts),signals:[]};
  const signals=[];let orders=[],ordersError=null,latestBoosts=[],topBoosts=[],ads=[];
  // Orders are the canonical DEX Screener signal for paid tokenProfile/tokenAd/trendingBarAd/communityTakeover.
  // Boosts are a separate paid promotion product, so they must not be treated as NOT PAID when orders=[] .
  const settled=await Promise.allSettled([
    cachedJson(`${DEX}/orders/v1/${NETWORK}/${a}`,60000,10000),
    cachedJson(`${DEX}/token-boosts/latest/v1`,60000,10000),
    cachedJson(`${DEX}/token-boosts/top/v1`,60000,10000),
    cachedJson(`${DEX}/ads/latest/v1`,60000,10000)
  ]);
  if(settled[0].status==="fulfilled")orders=normalizeList(settled[0].value);else ordersError=settled[0].reason?.message||"ORDERS_FAILED";
  if(settled[1].status==="fulfilled")latestBoosts=normalizeList(settled[1].value);
  if(settled[2].status==="fulfilled")topBoosts=normalizeList(settled[2].value);
  if(settled[3].status==="fulfilled")ads=normalizeList(settled[3].value);
  const validStatus=new Set(["processing","on-hold","approved"]);
  const paidOrders=orders.filter(x=>n(x?.paymentTimestamp)>0);
  const activePaidOrders=paidOrders.filter(x=>validStatus.has(String(x?.status||"").toLowerCase()));
  for(const o of paidOrders)signals.push({kind:String(o.type||"ORDER").toUpperCase(),status:String(o.status||"PAID").toUpperCase(),paymentTimestamp:n(o.paymentTimestamp)});
  const match=x=>lower(x?.chainId)===NETWORK&&lower(x?.tokenAddress)===a;
  const boostRecords=[...latestBoosts,...topBoosts].filter(match);
  const apiBoostAmount=boostRecords.reduce((mx,x)=>Math.max(mx,n(x?.amount),n(x?.totalAmount)),0);
  const pairBoosts=n(market?.boosts);
  if(pairBoosts>0)signals.push({kind:"ACTIVE BOOST",status:"PAID",amount:pairBoosts});
  if(apiBoostAmount>0)signals.push({kind:"BOOST ORDER",status:"PAID",amount:apiBoostAmount});
  const adRecords=ads.filter(match);
  for(const ad of adRecords)signals.push({kind:`AD ${String(ad?.type||"").toUpperCase()}`.trim(),status:"ACTIVE",date:ad?.date||null});
  const paid=paidOrders.length>0||pairBoosts>0||apiBoostAmount>0||adRecords.length>0;
  const ordersAvailable=settled[0].status==="fulfilled";
  // A failed canonical orders request must never be rendered as NOT PAID merely because
  // the global boost/ad lists did not contain the token. UNKNOWN is safer than a false negative.
  return {status:paid?"PAID":(ordersAvailable?"NOT PAID":"UNKNOWN"),paid:paid?true:(ordersAvailable?false:null),activePaid:activePaidOrders.length>0||pairBoosts>0||apiBoostAmount>0||adRecords.length>0,orders:orders.slice(0,12),paidOrders:paidOrders.slice(0,12),activePaidOrders:activePaidOrders.slice(0,12),boosts:Math.max(pairBoosts,apiBoostAmount),boostRecords:boostRecords.slice(0,6),ads:adRecords.slice(0,6),signals:signals.slice(0,12),source:"DEXSCREENER ORDERS + BOOSTS + ADS",error:ordersError};
}
function protocolHint(market){
  const x=`${market?.dexId||''} ${(market?.labels||[]).join(' ')}`.toLowerCase();
  if(/v4|uniswap.?4/.test(x)||String(market?.pairAddress||'').length===66)return "V4";
  if(/v3|uniswap.?3/.test(x))return "V3";
  if(/v2|uniswap.?2/.test(x))return "V2";
  return "UNKNOWN";
}
async function pairLpLockEvidence(pairAddress){
  if(!addr(pairAddress))return null;
  try{
    const [metaS,holdersS]=await Promise.allSettled([
      cachedJson(`${BLOCKSCOUT}/api/v2/tokens/${lower(pairAddress)}`,45000,9000),
      legacyTokenHolders(pairAddress,500)
    ]);
    const meta=metaS.status==="fulfilled"?metaS.value:{};const body=holdersS.status==="fulfilled"?holdersS.value:null;
    const total=safeBig(meta?.total_supply);if(!body?.items?.length||total<=0n)return null;
    let locked=0n;const evidence=[];
    for(const h of body.items){const a=lower(h.address);if(!KNOWN_LP_LOCKERS.has(a))continue;const val=safeBig(h.value);if(val<=0n)continue;locked+=val;evidence.push({address:a,label:KNOWN_LP_LOCKERS.get(a),pct:pctBig(val,total)});}
    return {lockedPct:pctBig(locked,total),evidence};
  }catch{return null;}
}
async function liquidityLockIntel(market,creator){
  if(!market)return {status:"NO MARKET",locked:null,protocol:"UNKNOWN",confidence:"NONE",note:"No active market detected."};
  const protocol=protocolHint(market);const origin=PERMANENT_LAUNCH_ORIGINS.get(lower(creator));
  if(origin)return {status:"PERMANENT",locked:true,protocol,confidence:"HIGH",provider:origin,lockedPct:100,note:"Recognized permanent-liquidity launch origin. Creator cannot be assumed to control the LP position."};
  if(protocol==="V2"&&addr(market.pairAddress)){
    const ev=await pairLpLockEvidence(market.pairAddress);
    if(ev?.lockedPct>0)return {status:ev.lockedPct>=99?"LOCKED / BURNED":"PARTIALLY LOCKED",locked:true,protocol,confidence:"HIGH",lockedPct:ev.lockedPct,evidence:ev.evidence,note:"Detected LP-token balance at a burn/recognized locker address."};
    if(ev)return {status:"NOT DETECTED",locked:false,protocol,confidence:"MEDIUM",lockedPct:0,note:"No LP-token balance was detected at recognized burn/locker addresses. Other lockers may exist."};
  }
  return {status:"UNKNOWN",locked:null,protocol,confidence:"LOW",lockedPct:null,note:protocol==="V3"||protocol==="V4"?"Concentrated-liquidity positions are NFTs/positions; lock status is only asserted when a recognized launcher/locker can be proven.":"No recognized onchain lock evidence was found."};
}

function confidenceModel(market,bs,sec,holders){
  let points=0,total=8;const checks=[];const add=(ok,label)=>{if(ok)points++;else checks.push(label);};
  add(!!market?.priceUsd,"PRICE");add(n(market?.liquidityUsd)>0,"LIQUIDITY");add(n(market?.volume?.h24)>0,"24H VOLUME");add((n(market?.txns?.h24?.buys)+n(market?.txns?.h24?.sells))>0,"TRADES");add(n(holders?.count)>0,"HOLDERS");add(holders?.top10Pct!=null,"DISTRIBUTION");add(!!bs?.address,"DEPLOYER");add(!!sec?.verified,"VERIFIED SOURCE");
  return {score:Math.round(points/total*100),missing:checks};
}
function searchHolderCount(searchBody,address){
  const a=lower(address);let best=0;
  for(const x of searchBody?.items||[]){const xa=extractAddress(x.address_hash||x.address);if(xa!==a)continue;best=Math.max(best,n(x.holders_count),n(x.holders),n(x.token?.holders_count),n(x.token?.holders));}
  return best||null;
}
async function detail(address,pairAddress=null,sourceHint=null){
  const a=lower(address);const wantedPair=lower(pairAddress);if(!addr(a))throw new Error("INVALID_ADDRESS");
  const [dexS,gtS,bsS,metaS,stocksS]=await Promise.allSettled([dexPairs(a),cachedJson(`${GECKO}/networks/${NETWORK}/tokens/${a}/pools?include=base_token,quote_token,dex&page=1`,30000,9000,{accept:"application/json;version=20230203"}),getBlockscoutDetail(a),tokenMeta(a),stockAddresses()]);
  const stocks=stocksS.status==="fulfilled"?stocksS.value:new Set();const dex=dexS.status==="fulfilled"?dexS.value:[];let gt=[];
  if(gtS.status==="fulfilled"){const inc=new Map((gtS.value.included||[]).map(x=>[x.id,x]));gt=(gtS.value.data||[]).map(x=>normalizeGT(x,inc,{preferredAddress:a,stockAddresses:stocks})).filter(Boolean);}
  const pools=mergePools(dex,gt).filter(x=>x.address===a).sort((x,y)=>n(y.liquidityUsd)-n(x.liquidityUsd));
  const aggregate=aggregateTokenMarkets(pools)[0]||null;const bs=bsS.status==="fulfilled"?bsS.value:{};const bt=bs?.token||bs?.address?.token||{};
  let selected=null;
  if(poolId(wantedPair)){
    const same=[...dex,...gt].filter(x=>x.address===a&&lower(x.pairAddress)===wantedPair);
    if(sourceHint){const h=String(sourceHint).toUpperCase();selected=same.find(x=>String(x.source||"").toUpperCase()===h)||null;}
    selected=selected||same.find(x=>String(x.source||"").toUpperCase()==="GECKOTERMINAL")||same[0]||null;
  }
  selected=selected||pools[0]||aggregate;
  const meta=metaS.status==="fulfilled"?metaS.value:{address:a,symbol:selected?.symbol||aggregate?.symbol||bt?.symbol||"TOKEN",name:selected?.name||aggregate?.name||bt?.name||"ERC20",decimals:n(bt?.decimals,18),totalSupplyRaw:bt?.total_supply||null,owner:null};
  if(!meta.totalSupplyRaw&&bt?.total_supply)meta.totalSupplyRaw=String(bt.total_supply);
  const creator=extractAddress(bs?.address?.creator_address_hash)||null;const sec=abiSignals(bs?.source);if(meta.owner)sec.owner=meta.owner;
  const hs=holderStats(bs?.holders,meta.totalSupplyRaw,creator,pools.map(x=>x.pairAddress).filter(Boolean));
  const counts=[bt?.holders_count,bt?.holders,bs?.address?.token?.holders_count,bs?.address?.token?.holders,searchHolderCount(bs?.search,a)].map(x=>n(x)).filter(x=>x>0);
  const holdersCount=counts.length?Math.max(...counts):null;
  const sampleExact=hs.sampleCount>0&&!hs.sampleHasMore&&hs.sampleCount<500;
  const holders={count:holdersCount||(sampleExact?hs.sampleCount:null),countLabel:holdersCount?String(holdersCount):(hs.sampleCount?`${hs.sampleCount}${sampleExact?"":"+"}`:null),countSource:holdersCount?"BLOCKSCOUT INDEX":(hs.sampleCount?`${hs.source} SAMPLE`:null),holderSources:bs?.holderSources||{},holderErrors:bs?.holderErrors||{},...hs};
  let market=selected?{...selected,poolCount:pools.length}:null;
  if(market){if((market.marketCap==null||market.marketCap<=0)&&optNum(bt?.circulating_market_cap)>0)market.marketCap=optNum(bt.circulating_market_cap);if((market.priceUsd==null||market.priceUsd<=0)&&optNum(bt?.exchange_rate)>0)market.priceUsd=optNum(bt.exchange_rate);}
  const age=market?.ageSeconds??null;const risk=riskModel(market,sec,hs,age);
  // One canonical score model is used in both feed and detail. Holder/security signals stay in RISK + CONFIDENCE,
  // so opening a token can never silently change its GLITCH ALPHA SCORE.
  const gl=market?scorePool(market):{score:0,verdict:"UNPRICED",components:{momentum:0,liquidity:0,activity:0,flow:0,novelty:0,structure:0},model:"V3.7.5"};gl.scoreScope="MARKET_PAIR";
  const trades=await getTrades(market?.pairAddress);const whaleThreshold=Math.max(1000,n(market?.liquidityUsd)*.01);const whales=trades.filter(x=>x.volumeUsd>=whaleThreshold).slice(0,20);
  const sameMarket=pools.filter(x=>!market?.pairAddress||lower(x.pairAddress)===lower(market.pairAddress));const sourcePrices=[...new Map(sameMarket.filter(x=>n(x.priceUsd)>0).map(x=>[x.source,n(x.priceUsd)])).entries()].map(([source,price])=>({source,price}));let consensus=null;if(sourcePrices.length>=2){const vals=sourcePrices.map(x=>x.price);const avg=vals.reduce((x,y)=>x+y,0)/vals.length;const spread=(Math.max(...vals)-Math.min(...vals))/avg*100;consensus={sources:sourcePrices,spreadPct:spread,level:spread<.5?"HIGH":spread<2?"MEDIUM":"LOW"};}
  const confidence=confidenceModel(market,bs,sec,holders);
  const [liquidityLock,dexPaid]=await Promise.all([liquidityLockIntel(market,creator),dexPaidIntel(a,market)]);
  const aggregateMarket=aggregate?{...aggregate}:null;
  return {chainId:CHAIN_ID,address:a,official:officialToken(a),projectRole:officialToken(a)?"DEAD PIXELS ECOSYSTEM TOKEN":null,meta:{...meta,imageUrl:market?.imageUrl||bt?.icon_url||null},market,aggregateMarket,pools:pools.slice(0,20),holders,security:sec,risk,glitch:gl,confidence,liquidityLock,dexPaid,deployer:{address:creator,creationTx:bs?.address?.creation_transaction_hash||null},trades,whales,whaleThreshold,consensus,pairSelection:{requested:poolId(wantedPair)?wantedPair:null,selected:market?.pairAddress||null,source:market?.source||null},sources:{DEXSCREENER:dexS.status==="fulfilled"?"ONLINE":"ERROR",GECKOTERMINAL:gtS.status==="fulfilled"?"ONLINE":"ERROR",BLOCKSCOUT:bsS.status==="fulfilled"?"ONLINE":"ERROR",RPC:metaS.status==="fulfilled"?"ONLINE":"ERROR"},generatedAt:new Date().toISOString()};
}
async function ohlcv(pool,timeframe="minute",tokenSide="base"){
  if(!poolId(pool))throw new Error("INVALID_POOL");const tf=["minute","hour","day"].includes(timeframe)?timeframe:"minute";const side=String(tokenSide).toLowerCase()==="quote"?"quote":"base";
  const j=await cachedJson(`${GECKO}/networks/${NETWORK}/pools/${pool}/ohlcv/${tf}?aggregate=1&limit=180&currency=usd&token=${side}`,55000,9000,{accept:"application/json;version=20230203"});
  const list=j?.data?.attributes?.ohlcv_list||[];return {pool,timeframe:tf,tokenSide:side,items:list.map(x=>({t:x[0],o:n(x[1]),h:n(x[2]),l:n(x[3]),c:n(x[4]),v:n(x[5])})).reverse()};
}
async function status(){let latest=null;try{latest=hexNum(await rpc("eth_blockNumber",[]));}catch{}return {chainId:CHAIN_ID,network:NETWORK,latestBlock:latest,rpc:RPC.includes("alchemy")?"PROVIDER":"PUBLIC",generatedAt:new Date().toISOString()};}
module.exports={overview,catalog,search,justBorn,detail,ohlcv,status,recentMintSignals,scorePool,CHAIN_ID,NETWORK,GLITCH,_test:{chooseSubject,normalizeDex,normalizeGT,holderStats,normalizeHolderBody,searchHolderCount,bestMarketsByToken,poolId,protocolHint,dexPaidIntel,getBlockscoutDetail}};

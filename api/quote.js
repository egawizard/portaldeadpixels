const {
  encodeFunctionData,
  decodeFunctionResult,
  encodePacked,
  getAddress,
  parseAbi,
  toHex
} = require("viem");
const { deadPixelsBalance } = require("../lib/holder");
const { getAssets: getStockAssets, getPrice: getStockPrice } = require("../lib/stocks");

const CHAIN_ID = 4663;
const NATIVE = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const NORD_NATIVE = "0x0000000000000000000000000000000000000000";
const WETH = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";
const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";

const UNISWAP_V3_QUOTER = "0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7";
const UNISWAP_SWAP_ROUTER_02 = "0xcaf681a66d020601342297493863e78c959e5cb2";
const RPC = process.env.RH_RPC_URL || "https://rpc.mainnet.chain.robinhood.com/";
const UNISWAP_TRADE_API = "https://trade-api.gateway.uniswap.org/v1";
const UNISWAP_NATIVE = "0x0000000000000000000000000000000000000000";
const UNISWAP_ROUTER_VERSION = "2.1.1";
const FEES = [100, 500, 3000, 10000];

const quoterAbi = parseAbi([
  "function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)",
  "function quoteExactInput(bytes path,uint256 amountIn) returns (uint256 amountOut,uint160[] sqrtPriceX96AfterList,uint32[] initializedTicksCrossedList,uint256 gasEstimate)"
]);

const routerAbi = parseAbi([
  "function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)",
  "function exactInput((bytes path,address recipient,uint256 amountIn,uint256 amountOutMinimum) params) payable returns (uint256 amountOut)",
  "function unwrapWETH9(uint256 amountMinimum,address recipient) payable",
  "function multicall(bytes[] data) payable returns (bytes[] results)"
]);

let tokenCache = { at: 0, map: new Map() };

function addressOk(v){ return /^0x[a-fA-F0-9]{40}$/.test(v || ""); }
function json(res, code, body){
  res.statusCode = code;
  res.setHeader("Content-Type","application/json; charset=utf-8");
  res.setHeader("Cache-Control","no-store, max-age=0");
  res.end(JSON.stringify(body));
}
function errorText(body,status){
  if(!body) return `HTTP ${status}`;
  if(typeof body === "string") return body.slice(0,220);
  return body.message || body.error || body.description || body.code || `HTTP ${status}`;
}
async function fetchJson(url, opts={}, timeoutMs=14000){
  const c = new AbortController();
  const timer=setTimeout(()=>c.abort(),timeoutMs);
  try{
    const r=await fetch(url,{...opts,signal:c.signal});
    const text=await r.text();
    let body; try{body=JSON.parse(text)}catch{body=text}
    if(!r.ok) throw new Error(errorText(body,r.status));
    return body;
  }finally{clearTimeout(timer)}
}
async function rpc(method,params){
  const r=await fetchJson(RPC,{
    method:"POST",
    headers:{"content-type":"application/json"},
    body:JSON.stringify({jsonrpc:"2.0",id:1,method,params})
  },12000);
  if(r.error) throw new Error(r.error.message||"RPC_ERROR");
  return r.result;
}
async function rpcCall(to,data){
  return rpc("eth_call",[{to,data},"latest"]);
}
function safeTx(tx){
  if(!tx || !addressOk(tx.to) || !/^0x[0-9a-fA-F]*$/.test(tx.data||"0x")) return null;
  return {
    to:tx.to,
    data:tx.data||"0x",
    // Wallet RPC expects transaction value in hex. Normalize provider responses
    // because some APIs return decimal strings while others return 0x values.
    value:rpcHex(tx.value==null?0:tx.value),
    gas:tx.gas||tx.gasLimit||null,
    gasPrice:tx.gasPrice||null
  };
}
function sumUsd(items){
  const n=(items||[]).reduce((s,x)=>s+(Number(x?.amountUSD)||0),0);
  return Number.isFinite(n)&&n>0 ? n : null;
}
function wrapped(token){
  return token.toLowerCase()===NATIVE ? getAddress(WETH.toLowerCase()) : getAddress(token.toLowerCase());
}
function nordToken(token){
  return token.toLowerCase()===NATIVE ? NORD_NATIVE : token;
}
function minOut(amountOut, slippageBps){
  return (BigInt(amountOut) * BigInt(10000 - slippageBps)) / 10000n;
}
function pathHex(tokens, fees){
  const types=[], values=[];
  for(let i=0;i<tokens.length;i++){
    types.push("address"); values.push(tokens[i]);
    if(i<fees.length){types.push("uint24");values.push(fees[i]);}
  }
  return encodePacked(types, values);
}
function padAddress(a){ return a.toLowerCase().replace(/^0x/,"").padStart(64,"0"); }
function toHex32(n){ return BigInt(n).toString(16).padStart(64,"0"); }
function rpcHex(v){
  if(v==null) return "0x0";
  const s=String(v);
  return /^0x[0-9a-fA-F]+$/.test(s) ? s : "0x"+BigInt(s).toString(16);
}

async function getTokenMap(){
  if(Date.now()-tokenCache.at < 300000 && tokenCache.map.size) return tokenCache.map;
  try{
    const headers={accept:"application/json"};
    if(process.env.LIFI_API_KEY) headers["x-lifi-api-key"]=process.env.LIFI_API_KEY;
    const body=await fetchJson(`https://li.quest/v1/tokens?chains=${CHAIN_ID}`,{headers},12000);
    let raw=[];
    if(Array.isArray(body)) raw=body;
    else if(Array.isArray(body.tokens)) raw=body.tokens;
    else if(body.tokens && typeof body.tokens==="object"){
      raw=body.tokens[String(CHAIN_ID)]||body.tokens[CHAIN_ID]||Object.values(body.tokens).flat();
    }
    const map=new Map();
    for(const t of raw){
      const a=String(t?.address||"").toLowerCase();
      const d=Number(t?.decimals);
      if((addressOk(a)||a===NATIVE) && Number.isInteger(d)){
        map.set(a,{
          address:a,
          decimals:d,
          symbol:String(t.symbol||"TOKEN"),
          priceUSD:Number(t.priceUSD||0)
        });
      }
    }
    tokenCache={at:Date.now(),map};
  }catch{}
  return tokenCache.map;
}
async function tokenInfo(address){
  const map=await getTokenMap();
  const a=address.toLowerCase();
  const base=map.get(a)||null;
  if(base && Number(base.priceUSD||0)>0) return base;
  if(a===NATIVE && map.has(WETH.toLowerCase())){
    const w=map.get(WETH.toLowerCase());
    if(Number(w?.priceUSD||0)>0) return w;
  }
  // Stock Tokens may exist in aggregator catalogs without a usable USD price.
  // Fall back to Robinhood's official Stock Token registry + market reference
  // so BEST NET ranking can still account for output value and gas.
  try{
    const assets=await getStockAssets();
    const stock=assets.find(x=>x.address.toLowerCase()===a);
    if(stock){
      const px=await getStockPrice(stock.symbol,stock);
      return {...(base||{}),address:a,decimals:18,symbol:stock.symbol,priceUSD:px.fairValue,rwa:true};
    }
  }catch{}
  return base;
}
async function ethPriceUsd(){
  const map=await getTokenMap();
  const native=map.get(NATIVE);
  if(native?.priceUSD>0) return native.priceUSD;
  const weth=map.get(WETH.toLowerCase());
  return weth?.priceUSD>0 ? weth.priceUSD : null;
}
async function gasPriceWei(){
  try{return BigInt(await rpc("eth_gasPrice",[]));}catch{return null;}
}
async function allowance(token,owner,spender){
  if(token.toLowerCase()===NATIVE) return 2n**256n-1n;
  const data="0xdd62ed3e"+padAddress(owner)+padAddress(spender);
  try{return BigInt(await rpcCall(token,data));}catch{return 0n;}
}
async function estimateApprovalGas(token,owner,spender,amount){
  if(token.toLowerCase()===NATIVE) return 0n;
  const data="0x095ea7b3"+padAddress(spender)+toHex32(amount);
  try{
    const g=await rpc("eth_estimateGas",[{from:owner,to:token,data,value:"0x0"}]);
    return BigInt(g);
  }catch{
    return 55000n;
  }
}
async function estimateTxGas(tx,taker,fallback=null){
  try{
    const req={from:taker,to:tx.to,data:tx.data||"0x",value:rpcHex(tx.value||"0x0")};
    const g=await rpc("eth_estimateGas",[req]);
    return BigInt(g);
  }catch{
    return fallback!=null ? BigInt(fallback) : null;
  }
}
function gasUsdFromUnits(units,gasPrice,ethUsd){
  if(units==null||gasPrice==null||!ethUsd) return null;
  const wei=units*gasPrice;
  return Number(wei)/1e18*ethUsd;
}
function tokenAmountUsd(raw,info){
  if(!info||!(info.priceUSD>0)) return null;
  const n=Number(raw)/10**info.decimals;
  if(!Number.isFinite(n)) return null;
  return n*info.priceUSD;
}
function addGasMetrics(q,{gasUnits,approvalGasUnits=0n,gasPrice,ethUsd,buyInfo,sellInfo,sellAmount}){
  const total=gasUnits==null?null:(BigInt(gasUnits)+BigInt(approvalGasUnits||0n));
  const gasUsd=gasUsdFromUnits(total,gasPrice,ethUsd);
  const grossUsd=tokenAmountUsd(q.buyAmount,buyInfo);
  const providerFeeUsd=q.providerFeeUsd!=null?Number(q.providerFeeUsd):0;
  const netUsd=(grossUsd!=null&&gasUsd!=null)?grossUsd-gasUsd-providerFeeUsd:null;
  const sellUsd=tokenAmountUsd(sellAmount,sellInfo);
  const gasImpactPct=(gasUsd!=null&&sellUsd&&sellUsd>0)?gasUsd/sellUsd*100:null;
  return {
    ...q,
    gasUnits: total!=null?total.toString():null,
    swapGasUnits: gasUnits!=null?BigInt(gasUnits).toString():null,
    approvalGasUnits: BigInt(approvalGasUnits||0n).toString(),
    gasUsd,
    grossUsd,
    netUsd,
    gasImpactPct,
    rankingValue:netUsd
  };
}

async function getDirectWrap({sellToken,buyToken,sellAmount,taker,gasPrice,ethUsd,buyInfo,sellInfo}){
  const sell=sellToken.toLowerCase(), buy=buyToken.toLowerCase(), weth=WETH.toLowerCase();
  const isWrap=sell===NATIVE && buy===weth;
  const isUnwrap=sell===weth && buy===NATIVE;
  if(!isWrap && !isUnwrap) throw new Error("NOT_A_WRAP_PAIR");

  let tx;
  if(isWrap){
    tx={to:WETH,data:"0xd0e30db0",value:toHex(BigInt(sellAmount)),gas:null,gasPrice:null};
  }else{
    tx={to:WETH,data:"0x2e1a7d4d"+toHex32(sellAmount),value:"0x0",gas:null,gasPrice:null};
  }
  const gasUnits=await estimateTxGas(tx,taker,isWrap?30000n:38000n);
  const base={
    provider:"wrap",
    label:isWrap?"DIRECT WRAP":"DIRECT UNWRAP",
    buyAmount:String(sellAmount),
    minBuyAmount:String(sellAmount),
    approvalSpender:null,
    providerFeeUsd:0,
    route:isWrap?"ETH → WETH CONTRACT // 1:1":"WETH → ETH CONTRACT // 1:1",
    transaction:tx,
    complexity:"DIRECT"
  };
  return addGasMetrics(base,{gasUnits,approvalGasUnits:0n,gasPrice,ethUsd,buyInfo,sellInfo,sellAmount});
}


function uniswapHeaders(){
  const key=String(process.env.UNISWAP_API_KEY||"");
  if(!key) throw new Error("UNISWAP_API_KEY not configured");
  return {
    "x-api-key":key,
    "content-type":"application/json",
    "accept":"application/json",
    "x-universal-router-version":UNISWAP_ROUTER_VERSION,
    // Native UniswapX requires EIP-7914/7702 wallet preparation.
    // Keep it off for native ETH in V2; ERC20 input can still receive UniswapX.
    "x-erc20eth-enabled":"false"
  };
}
function uniToken(token){
  return token.toLowerCase()===NATIVE ? UNISWAP_NATIVE : token;
}
function pickNumber(...values){
  for(const v of values){
    const n=Number(v);
    if(Number.isFinite(n) && n>=0) return n;
  }
  return null;
}
function uniOutputAmount(resp){
  const q=resp?.quote||{};
  if(q.output?.amount!=null) return String(q.output.amount);
  if(q.output?.startAmount!=null) return String(q.output.startAmount);
  if(Array.isArray(q.outputs) && q.outputs[0]?.startAmount!=null) return String(q.outputs[0].startAmount);
  if(Array.isArray(q.aggregatedOutputs) && q.aggregatedOutputs.length){
    try{
      return q.aggregatedOutputs.reduce((a,x)=>a+BigInt(x.amount||0),0n).toString();
    }catch{}
  }
  return null;
}
function uniMinimumAmount(resp){
  const q=resp?.quote||{};
  if(q.output?.minimumAmount!=null) return String(q.output.minimumAmount);
  if(q.output?.endAmount!=null) return String(q.output.endAmount);
  if(Array.isArray(q.outputs) && q.outputs[0]?.endAmount!=null) return String(q.outputs[0].endAmount);
  return null;
}
function weiFeeUsd(value,ethUsd){
  try{
    if(value==null||!ethUsd)return null;
    return Number(BigInt(String(value)))/1e18*ethUsd;
  }catch{return null;}
}
function uniClassicGasUsd(resp,gasPrice,ethUsd){
  const q=resp?.quote||{};
  const direct=pickNumber(
    q.gasFeeUSD,q.gasFeeUsd,q.gasUseEstimateUSD,q.gasUseEstimateUsd,
    resp?.gasFeeUSD,resp?.gasFeeUsd
  );
  if(direct!=null)return direct;

  const gasUnits=pickNumber(q.gasUseEstimate,q.gasEstimate,q.gasLimit);
  if(gasUnits!=null && gasPrice!=null && ethUsd){
    return Number(BigInt(Math.ceil(gasUnits))*BigInt(gasPrice))/1e18*ethUsd;
  }
  return null;
}
function normalizePreparedTx(tx){
  if(!tx||!addressOk(tx.to)||!/^0x[0-9a-fA-F]*$/.test(tx.data||"0x"))return null;
  return {
    to:tx.to,
    data:tx.data||"0x",
    value:rpcHex(tx.value||0),
    gas:tx.gasLimit||tx.gas||null,
    gasPrice:tx.gasPrice||null,
    maxFeePerGas:tx.maxFeePerGas||null,
    maxPriorityFeePerGas:tx.maxPriorityFeePerGas||null
  };
}

async function getUniswapOfficial({sellToken,buyToken,sellAmount,taker,slippageBps,gasPrice,ethUsd,buyInfo,sellInfo}){
  const headers=uniswapHeaders();
  const tokenIn=uniToken(sellToken);
  const tokenOut=uniToken(buyToken);

  let approval=null,cancel=null,approvalGasUsd=0;
  if(sellToken.toLowerCase()!==NATIVE){
    try{
      const ap=await fetchJson(`${UNISWAP_TRADE_API}/check_approval`,{
        method:"POST",
        headers,
        body:JSON.stringify({
          walletAddress:taker,
          token:tokenIn,
          amount:String(sellAmount),
          chainId:CHAIN_ID,
          tokenOut,
          tokenOutChainId:CHAIN_ID,
          includeGasInfo:true
        })
      },12000);
      approval=normalizePreparedTx(ap.approval);
      cancel=normalizePreparedTx(ap.cancel);
      approvalGasUsd=weiFeeUsd(ap.gasFee,ethUsd)||0;
      if(cancel) approvalGasUsd+=(weiFeeUsd(ap.cancelGasFee,ethUsd)||0);
    }catch(e){
      // Approval lookup failure must not manufacture an approval target.
      // Quote can still be surfaced, but execution will refresh/check again.
    }
  }

  const body={
    tokenIn,
    tokenOut,
    tokenInChainId:CHAIN_ID,
    tokenOutChainId:CHAIN_ID,
    type:"EXACT_INPUT",
    amount:String(sellAmount),
    swapper:taker,
    slippageTolerance:Number(slippageBps)/100,
    routingPreference:"BEST_PRICE",
    permitAmount:"EXACT"
  };

  const uq=await fetchJson(`${UNISWAP_TRADE_API}/quote`,{
    method:"POST",
    headers,
    body:JSON.stringify(body)
  },14000);

  const out=uniOutputAmount(uq);
  if(!out) throw new Error("Uniswap API returned no output amount");

  const routing=String(uq.routing||"").toUpperCase();
  const isOrder=["DUTCH_V2","DUTCH_V3","PRIORITY","LIMIT_ORDER"].includes(routing);
  const isSwap=["CLASSIC","WRAP","UNWRAP"].includes(routing);
  if(!isOrder&&!isSwap) throw new Error(`Unsupported Uniswap routing: ${routing||"UNKNOWN"}`);

  const grossUsd=tokenAmountUsd(out,buyInfo);
  let gasUsd;
  if(isOrder){
    // Filler pays the swap execution gas. First-time Permit2 approval, if any,
    // is still a user-paid onchain transaction and is counted.
    gasUsd=approvalGasUsd;
  }else{
    const classic=uniClassicGasUsd(uq,gasPrice,ethUsd);
    gasUsd=(classic==null?null:classic+approvalGasUsd);
  }
  const netUsd=(grossUsd!=null&&gasUsd!=null)?grossUsd-gasUsd:null;
  const sellUsd=tokenAmountUsd(sellAmount,sellInfo);
  const gasImpactPct=(gasUsd!=null&&sellUsd&&sellUsd>0)?gasUsd/sellUsd*100:null;

  const min=uniMinimumAmount(uq) || out;
  const classicBaseline=pickNumber(uq?.quote?.classicGasUseEstimateUSD);
  const route=isOrder
    ? `${routing==="DUTCH_V3"?"UNISWAPX V3":routing} // GASLESS FILLER EXECUTION`
    : `OFFICIAL BEST_PRICE // ${routing}`;

  return {
    provider:"uniswapapi",
    label:isOrder?"UNISWAPX GASLESS":"UNISWAP OFFICIAL",
    baseline:true,
    buyAmount:String(out),
    minBuyAmount:String(min),
    approvalSpender:null,
    approvalTransaction:approval,
    cancelTransaction:cancel,
    providerFeeUsd:0,
    gasUsd,
    grossUsd,
    netUsd,
    gasImpactPct,
    gasUnits:null,
    approvalGasUnits:"0",
    route,
    transaction:null,
    execution:{
      kind:isOrder?"ORDER":"SWAP",
      routing,
      quote:uq.quote,
      permitData:uq.permitData||null,
      permitTransaction:normalizePreparedTx(uq.permitTransaction),
      requestId:uq.requestId||null,
      classicGasUseEstimateUSD:classicBaseline
    }
  };
}

async function getNordstern({sellToken,buyToken,sellAmount,taker,slippageBps,gasPrice,ethUsd,buyInfo,sellInfo}){
  const p=new URLSearchParams({
    src:nordToken(sellToken),
    dst:nordToken(buyToken),
    amount:String(sellAmount)
  });
  // Nordstern's public Swap API documents src/dst/amount. "from" is included
  // as a compatibility hint; providers that ignore unknown parameters are safe.
  p.set("from",taker);

  const q=await fetchJson(`https://api.nordstern.finance/aggregator/${CHAIN_ID}?${p}`,{
    headers:{accept:"application/json"}
  },12000);

  const tx=safeTx(q.tx||q.transaction);
  if(!tx || !q.toAmount) throw new Error("Nordstern returned no executable route");

  // Preserve provider calldata/value exactly. For a native input, the API is
  // expected to return msg.value. If it does not, fail closed instead of guessing.
  if(sellToken.toLowerCase()===NATIVE && BigInt(rpcHex(tx.value||"0x0"))===0n){
    throw new Error("Nordstern native quote missing tx.value");
  }

  const approvalSpender = sellToken.toLowerCase()===NATIVE ? null :
    [q.approvalSpender,q.approvalAddress,q.allowanceTarget,q.spender,tx.to]
      .find(addressOk) || null;

  let approvalGas=0n;
  let currentAllowance=2n**256n-1n;
  if(sellToken.toLowerCase()!==NATIVE && approvalSpender){
    currentAllowance=await allowance(sellToken,taker,approvalSpender);
    if(currentAllowance<BigInt(sellAmount)){
      approvalGas=await estimateApprovalGas(sellToken,taker,approvalSpender,sellAmount);
    }
  }

  let swapGas=null;
  for(const candidate of [q.gas,q.gasEstimate,q.estimatedGas,q.tx?.gas,q.tx?.gasLimit]){
    if(candidate!=null){
      try{swapGas=BigInt(candidate);break;}catch{}
    }
  }
  // Live gas estimate is reliable for native sells and already-approved ERC-20s.
  if(sellToken.toLowerCase()===NATIVE || currentAllowance>=BigInt(sellAmount)){
    swapGas=await estimateTxGas(tx,taker,swapGas||180000n);
  }
  if(swapGas==null) swapGas=180000n;

  const minBuy=q.minToAmount ? String(q.minToAmount) : minOut(BigInt(q.toAmount),slippageBps).toString();
  const swaps=Array.isArray(q.swaps)?q.swaps:[];
  const routeNames=swaps.map(x=>{
    if(typeof x==="string") return x;
    return x?.protocol||x?.dex||x?.name||x?.pool||null;
  }).filter(Boolean);
  const route=routeNames.length
    ? [...new Set(routeNames)].slice(0,4).join(" → ")
    : "NORDSTERN SIMULATED ROUTE";

  const base={
    provider:"nordstern",
    label:"NORDSTERN DIRECT",
    buyAmount:String(q.toAmount),
    minBuyAmount:minBuy,
    approvalSpender,
    providerFeeUsd:0,
    route,
    transaction:tx,
    complexity:swaps.length>1?"MULTI":"SMART"
  };
  return addGasMetrics(base,{
    gasUnits:swapGas,approvalGasUnits:approvalGas,gasPrice,ethUsd,buyInfo,sellInfo,sellAmount
  });
}

async function getLifi({sellToken,buyToken,sellAmount,taker,slippageBps,gasPrice,ethUsd,buyInfo,sellInfo}){
  const p=new URLSearchParams({
    fromChain:String(CHAIN_ID),toChain:String(CHAIN_ID),
    fromToken:sellToken,toToken:buyToken,fromAmount:sellAmount,
    fromAddress:taker,toAddress:taker,slippage:String(Number(slippageBps)/10000)
  });
  const headers={accept:"application/json"};
  if(process.env.LIFI_API_KEY) headers["x-lifi-api-key"]=process.env.LIFI_API_KEY;
  const q=await fetchJson(`https://li.quest/v1/quote?${p}`,{headers});
  const tx=safeTx(q.transactionRequest);
  if(!tx || !q?.estimate?.toAmount) throw new Error("LI.FI returned no executable route");

  const approvalSpender=addressOk(q.estimate.approvalAddress)?q.estimate.approvalAddress:null;
  let approvalGas=0n;
  if(sellToken.toLowerCase()!==NATIVE && approvalSpender){
    const a=await allowance(sellToken,taker,approvalSpender);
    if(a<BigInt(sellAmount)) approvalGas=await estimateApprovalGas(sellToken,taker,approvalSpender,sellAmount);
  }

  let swapGas=null;
  if(q.transactionRequest?.gasLimit){try{swapGas=BigInt(q.transactionRequest.gasLimit);}catch{}}
  if(swapGas==null && q.transactionRequest?.gas){try{swapGas=BigInt(q.transactionRequest.gas);}catch{}}
  if(swapGas==null) swapGas=await estimateTxGas(tx,taker,null);

  const steps=(q.includedSteps||[]).map(x=>x.tool).filter(Boolean);
  const route=[q.tool,...steps].filter(Boolean).filter((x,i,a)=>a.indexOf(x)===i).join(" → ");
  const base={
    provider:"lifi",label:"LI.FI",
    buyAmount:String(q.estimate.toAmount),
    minBuyAmount:q.estimate.toAmountMin ? String(q.estimate.toAmountMin) : null,
    approvalSpender,
    providerFeeUsd:sumUsd(q.estimate.feeCosts),
    route:route || "LI.FI SMART ROUTE",transaction:tx,
    complexity:steps.length>1?"MULTI":"SMART"
  };
  const withMetrics=addGasMetrics(base,{gasUnits:swapGas,approvalGasUnits:approvalGas,gasPrice,ethUsd,buyInfo,sellInfo,sellAmount});
  const providerGasUsd=sumUsd(q.estimate.gasCosts);
  if(providerGasUsd!=null){
    withMetrics.gasUsd=Math.max(withMetrics.gasUsd||0,providerGasUsd+(gasUsdFromUnits(approvalGas,gasPrice,ethUsd)||0));
    if(withMetrics.grossUsd!=null){
      withMetrics.netUsd=withMetrics.grossUsd-withMetrics.gasUsd-(withMetrics.providerFeeUsd||0);
      withMetrics.rankingValue=withMetrics.netUsd;
    }
    const sellUsd=tokenAmountUsd(sellAmount,sellInfo);
    withMetrics.gasImpactPct=sellUsd&&sellUsd>0?withMetrics.gasUsd/sellUsd*100:null;
  }
  return withMetrics;
}

async function quoteSingle(tokenIn,tokenOut,amountIn,fee){
  const data=encodeFunctionData({
    abi:quoterAbi,functionName:"quoteExactInputSingle",
    args:[{tokenIn,tokenOut,amountIn:BigInt(amountIn),fee,sqrtPriceLimitX96:0n}]
  });
  const result=await rpcCall(UNISWAP_V3_QUOTER,data);
  const decoded=decodeFunctionResult({abi:quoterAbi,functionName:"quoteExactInputSingle",data:result});
  return {amountOut:BigInt(decoded[0]),gasEstimate:BigInt(decoded[3]),fees:[fee],tokens:[tokenIn,tokenOut]};
}
async function quotePath(tokens,fees,amountIn){
  const path=pathHex(tokens,fees);
  const data=encodeFunctionData({
    abi:quoterAbi,functionName:"quoteExactInput",
    args:[path,BigInt(amountIn)]
  });
  const result=await rpcCall(UNISWAP_V3_QUOTER,data);
  const decoded=decodeFunctionResult({abi:quoterAbi,functionName:"quoteExactInput",data:result});
  return {amountOut:BigInt(decoded[0]),gasEstimate:BigInt(decoded[3]),fees,tokens,path};
}
function buildUniTransaction(best,{sellToken,buyToken,sellAmount,taker,slippageBps}){
  const sellNative=sellToken.toLowerCase()===NATIVE;
  const buyNative=buyToken.toLowerCase()===NATIVE;
  const minimum=minOut(best.amountOut,slippageBps);
  const recipient=buyNative ? getAddress(UNISWAP_SWAP_ROUTER_02.toLowerCase()) : getAddress(taker.toLowerCase());

  let swapData;
  if(best.fees.length===1){
    swapData=encodeFunctionData({
      abi:routerAbi,functionName:"exactInputSingle",
      args:[{
        tokenIn:best.tokens[0],tokenOut:best.tokens[1],fee:best.fees[0],
        recipient,amountIn:BigInt(sellAmount),amountOutMinimum:minimum,sqrtPriceLimitX96:0n
      }]
    });
  }else{
    swapData=encodeFunctionData({
      abi:routerAbi,functionName:"exactInput",
      args:[{path:pathHex(best.tokens,best.fees),recipient,amountIn:BigInt(sellAmount),amountOutMinimum:minimum}]
    });
  }

  let data=swapData;
  if(buyNative){
    const unwrap=encodeFunctionData({
      abi:routerAbi,functionName:"unwrapWETH9",
      args:[minimum,getAddress(taker.toLowerCase())]
    });
    data=encodeFunctionData({abi:routerAbi,functionName:"multicall",args:[[swapData,unwrap]]});
  }

  return {
    to:UNISWAP_SWAP_ROUTER_02,
    data,
    value:sellNative ? toHex(BigInt(sellAmount)) : "0x0",
    gas:null,gasPrice:null
  };
}
async function getUniswapDirect({sellToken,buyToken,sellAmount,taker,slippageBps,gasPrice,ethUsd,buyInfo,sellInfo}){
  const tokenIn=wrapped(sellToken), tokenOut=wrapped(buyToken);
  if(tokenIn.toLowerCase()===tokenOut.toLowerCase()) throw new Error("Wrapped route resolves to same token");

  const candidates=[];
  await Promise.all(FEES.map(async fee=>{
    try{
      const q=await quoteSingle(tokenIn,tokenOut,sellAmount,fee);
      if(q.amountOut>0n)candidates.push(q);
    }catch{}
  }));

  const mids=[getAddress(WETH.toLowerCase()),getAddress(USDG.toLowerCase())].filter(m=>
    m.toLowerCase()!==tokenIn.toLowerCase() && m.toLowerCase()!==tokenOut.toLowerCase()
  );
  for(const mid of mids){
    const legs1=[];
    await Promise.all(FEES.map(async fee=>{
      try{
        const q=await quoteSingle(tokenIn,mid,sellAmount,fee);
        if(q.amountOut>0n) legs1.push({fee,out:q.amountOut});
      }catch{}
    }));
    legs1.sort((a,b)=>a.out===b.out?0:(a.out>b.out?-1:1));
    for(const leg1 of legs1.slice(0,2)){
      await Promise.all(FEES.map(async fee2=>{
        try{
          const q=await quotePath([tokenIn,mid,tokenOut],[leg1.fee,fee2],sellAmount);
          if(q.amountOut>0n)candidates.push(q);
        }catch{}
      }));
    }
  }
  if(!candidates.length) throw new Error("No direct Uniswap V3 route");

  let approvalGas=0n;
  const currentAllowance=sellToken.toLowerCase()===NATIVE
    ? 2n**256n-1n
    : await allowance(sellToken,taker,UNISWAP_SWAP_ROUTER_02);
  if(sellToken.toLowerCase()!==NATIVE && currentAllowance<BigInt(sellAmount)){
    approvalGas=await estimateApprovalGas(sellToken,taker,UNISWAP_SWAP_ROUTER_02,sellAmount);
  }

  const scored=candidates.map(c=>{
    const gasUsd=gasUsdFromUnits(c.gasEstimate+approvalGas,gasPrice,ethUsd);
    const grossUsd=tokenAmountUsd(c.amountOut.toString(),buyInfo);
    const netUsd=(grossUsd!=null&&gasUsd!=null)?grossUsd-gasUsd:null;
    return {...c,gasUsd,grossUsd,netUsd};
  });
  scored.sort((a,b)=>{
    if(a.netUsd!=null && b.netUsd!=null && a.netUsd!==b.netUsd) return a.netUsd>b.netUsd?-1:1;
    if(a.amountOut!==b.amountOut) return a.amountOut>b.amountOut?-1:1;
    return a.fees.length-b.fees.length;
  });

  const best=scored[0];
  const tx=buildUniTransaction(best,{sellToken,buyToken,sellAmount,taker,slippageBps});
  let swapGas=best.gasEstimate;
  if(sellToken.toLowerCase()===NATIVE || currentAllowance>=BigInt(sellAmount)){
    const live=await estimateTxGas(tx,taker,best.gasEstimate);
    if(live!=null) swapGas=live;
  }

  const mid=best.tokens.length===3
    ? ` → ${best.tokens[1].toLowerCase()===WETH.toLowerCase()?"WETH":best.tokens[1].toLowerCase()===USDG.toLowerCase()?"USDG":"MID"}`
    : "";
  const fees=best.fees.map(x=>`${x/10000}%`).join(" + ");
  const base={
    provider:"uniswap",label:"UNISWAP DIRECT",
    buyAmount:best.amountOut.toString(),
    minBuyAmount:minOut(best.amountOut,slippageBps).toString(),
    approvalSpender:sellToken.toLowerCase()===NATIVE?null:UNISWAP_SWAP_ROUTER_02,
    providerFeeUsd:null,
    route:`V3 ${best.fees.length===1?"DIRECT":"2-HOP"}${mid} // LP FEE ${fees}`,
    transaction:tx,
    complexity:best.fees.length===1?"DIRECT":"2-HOP",
    meta:{version:"v3",feeTiers:best.fees,hopCount:best.fees.length}
  };
  return addGasMetrics(base,{gasUnits:swapGas,approvalGasUnits:approvalGas,gasPrice,ethUsd,buyInfo,sellInfo,sellAmount});
}

module.exports = async function handler(req,res){
  if(req.method!=="GET") return json(res,405,{error:"METHOD_NOT_ALLOWED"});
  try{
    const {sellToken,buyToken,sellAmount,taker,provider="all"}=req.query||{};
    const slippageBps=Number(req.query?.slippageBps||50);

    if(!addressOk(sellToken)||!addressOk(buyToken)) return json(res,400,{error:"INVALID_TOKEN_ADDRESS"});
    if(sellToken.toLowerCase()===buyToken.toLowerCase()) return json(res,400,{error:"TOKENS_MUST_DIFFER"});
    if(!addressOk(taker)) return json(res,400,{error:"INVALID_TAKER"});
    try{ if(BigInt(sellAmount)<=0n) throw 0; }catch{return json(res,400,{error:"INVALID_SELL_AMOUNT"});}
    if(!Number.isInteger(slippageBps)||slippageBps<1||slippageBps>500) return json(res,400,{error:"INVALID_SLIPPAGE"});
    if(!["all","wrap","uniswapapi","nordstern","lifi"].includes(provider)) return json(res,400,{error:"INVALID_PROVIDER"});

    // HARD PORTAL GATE: no executable quote is returned unless the taker
    // currently owns at least one DEAD PIXELS NFT.
    const holderBalance=await deadPixelsBalance(taker);
    if(holderBalance<1n){
      return json(res,403,{
        error:"DEAD_PIXELS_HOLDER_REQUIRED",
        requirement:"HOLD_AT_LEAST_1_DEAD_PIXEL"
      });
    }

    const [gp,ethUsd,buyInfo,sellInfo]=await Promise.all([
      gasPriceWei(),ethPriceUsd(),tokenInfo(buyToken),tokenInfo(sellToken)
    ]);
    const args={sellToken,buyToken,sellAmount,taker,slippageBps,gasPrice:gp,ethUsd,buyInfo,sellInfo};

    const jobs=[];
    const isWrapPair=
      (sellToken.toLowerCase()===NATIVE && buyToken.toLowerCase()===WETH.toLowerCase()) ||
      (sellToken.toLowerCase()===WETH.toLowerCase() && buyToken.toLowerCase()===NATIVE);

    if((provider==="all"||provider==="wrap") && isWrapPair){
      jobs.push(["DIRECT WRAP",()=>getDirectWrap(args)]);
    }

    if(!isWrapPair){
      if((provider==="all"||provider==="uniswapapi") && process.env.UNISWAP_API_KEY)
        jobs.push(["UNISWAP OFFICIAL",()=>getUniswapOfficial(args)]);
      if(provider==="all"||provider==="nordstern")
        jobs.push(["NORDSTERN",()=>getNordstern(args)]);
      if(provider==="all"||provider==="lifi")
        jobs.push(["LI.FI",()=>getLifi(args)]);
    }

    const settled=await Promise.all(jobs.map(async ([name,fn])=>{
      try{return {ok:true,value:await fn()}}catch(e){return {ok:false,provider:name,error:e.message||String(e)}}
    }));
    const quotes=settled.filter(x=>x.ok).map(x=>x.value);

    quotes.sort((a,b)=>{
      if(a.netUsd!=null && b.netUsd!=null && a.netUsd!==b.netUsd) return a.netUsd>b.netUsd?-1:1;
      const A=BigInt(a.buyAmount),B=BigInt(b.buyAmount);
      if(A!==B) return A>B?-1:1;
      const ga=a.gasUnits?BigInt(a.gasUnits):2n**255n;
      const gb=b.gasUnits?BigInt(b.gasUnits):2n**255n;
      return ga===gb?0:(ga<gb?-1:1);
    });

    const errors=settled.filter(x=>!x.ok).map(({provider,error})=>({provider,error}));
    const sellUsd=tokenAmountUsd(sellAmount,sellInfo);
    const uniswapBaseline=quotes.find(x=>x.provider==="uniswapapi")||null;
    const best=quotes[0]||null;
    let savingsVsUniswapUsd=null;
    let savingsVsUniswapPct=null;
    if(best?.netUsd!=null && uniswapBaseline?.netUsd!=null){
      savingsVsUniswapUsd=Math.max(0,best.netUsd-uniswapBaseline.netUsd);
      if(uniswapBaseline.netUsd>0)
        savingsVsUniswapPct=savingsVsUniswapUsd/uniswapBaseline.netUsd*100;
    }

    return json(res,200,{
      chainId:CHAIN_ID,
      holderBalance:holderBalance.toString(),
      protocolFeeBps:0,
      ranking:(quotes[0]?.netUsd!=null)?"best net value after estimated gas":"highest expected token output",
      gasPriceWei:gp?gp.toString():null,
      ethPriceUsd:ethUsd,
      sellValueUsd:sellUsd,
      providers:[
        {name:"DIRECT WRAP",enabled:true,for:"ETH/WETH"},
        {name:"UNISWAP OFFICIAL",enabled:!!process.env.UNISWAP_API_KEY,mode:"BEST_PRICE"},
        {name:"NORDSTERN DIRECT",enabled:true},
        {name:"LI.FI",enabled:true}
      ],
      baseline:{
        provider:"UNISWAP OFFICIAL",
        available:!!uniswapBaseline,
        netUsd:uniswapBaseline?.netUsd??null
      },
      savingsVsUniswapUsd,
      savingsVsUniswapPct,
      quotes,errors,generatedAt:new Date().toISOString()
    });
  }catch(e){
    return json(res,500,{error:e.message||"QUOTE_FAILED"});
  }
};
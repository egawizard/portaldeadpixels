const quoteHandler=require("./quote");
const {getAssets,getSnapshot,getPrice,marketScore,cleanSymbol,clamp}=require("../lib/stocks");

const USDG="0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const PREFERRED=["NVDA","AAPL","TSLA","MSFT","AMZN","META","GOOGL","QQQ","SPY","PLTR","COIN","AMD"];

function json(res,code,body,cache="no-store"){
  res.statusCode=code;
  res.setHeader("Content-Type","application/json; charset=utf-8");
  res.setHeader("Cache-Control",cache);
  res.end(JSON.stringify(body));
}
function rawUnits(value,decimals){
  const s=String(value||"").trim();
  if(!/^\d+(\.\d+)?$/.test(s))throw new Error("INVALID_AMOUNT");
  let [a,b=""]=s.split(".");
  b=(b+"0".repeat(decimals)).slice(0,decimals);
  return (BigInt(a)*10n**BigInt(decimals)+BigInt(b||0)).toString();
}
function formatUnits(raw,decimals){
  const n=BigInt(raw||0),base=10n**BigInt(decimals);
  const a=n/base,b=(n%base).toString().padStart(decimals,"0").replace(/0+$/,"");
  return Number(b?`${a}.${b}`:`${a}`);
}
function runQuote(query){
  return new Promise((resolve,reject)=>{
    const req={method:"GET",query};
    const out={
      statusCode:200,headers:{},
      setHeader(k,v){this.headers[k]=v;},
      end(body){
        let j;try{j=JSON.parse(body)}catch{j={error:String(body)}}
        resolve({status:this.statusCode,body:j});
      }
    };
    Promise.resolve(quoteHandler(req,out)).catch(reject);
  });
}
function verdict(score){
  return score>=95?"EXCELLENT":score>=85?"GOOD":score>=70?"CAUTION":"POOR";
}

async function registry(req,res){
  const assets=await getAssets();
  return json(res,200,{
    chainId:4663,
    count:assets.length,
    assets,
    source:"ROBINHOOD_RHJ_ASSET_REGISTRY",
    generatedAt:new Date().toISOString()
  },"public, s-maxage=300, stale-while-revalidate=900");
}

async function scan(req,res){
  const assets=await getAssets();
  const by=new Map(assets.map(x=>[x.symbol,x]));
  let syms=String(req.query?.symbols||"").split(",").map(cleanSymbol).filter(Boolean);
  if(!syms.length)syms=PREFERRED.filter(s=>by.has(s));
  syms=[...new Set(syms)].filter(s=>by.has(s)).slice(0,12);

  const settled=await Promise.allSettled(syms.map(async symbol=>{
    const asset=by.get(symbol);
    const market=await getPrice(symbol,asset);
    return {...asset,market,marketQuality:marketScore(asset,market)};
  }));
  const items=[],errors=[];
  settled.forEach((x,i)=>{
    if(x.status==="fulfilled")items.push(x.value);
    else errors.push({symbol:syms[i],error:x.reason?.message||"PRICE_FAILED"});
  });
  items.sort((a,b)=>(b.marketQuality?.score||0)-(a.marketQuality?.score||0));
  return json(res,200,{
    chainId:4663,items,errors,
    source:"ROBINHOOD_RHJ_PRICES_PLUS_MULTIPLIER",
    generatedAt:new Date().toISOString()
  },"public, s-maxage=12, stale-while-revalidate=15");
}

async function detail(req,res){
  const symbol=cleanSymbol(req.query?.symbol);
  if(!symbol)return json(res,400,{error:"INVALID_SYMBOL"});
  return json(res,200,{
    item:await getSnapshot(symbol),
    source:"ROBINHOOD_RHJ_PRICES_PLUS_MULTIPLIER"
  },"public, s-maxage=12, stale-while-revalidate=15");
}

async function execution(req,res){
  const symbol=cleanSymbol(req.query?.symbol);
  const wallet=String(req.query?.wallet||"");
  const side=String(req.query?.side||"buy").toLowerCase();
  const amount=String(req.query?.amount||"100");

  if(!symbol||!/^0x[a-fA-F0-9]{40}$/.test(wallet))
    return json(res,400,{error:"INVALID_REQUEST"});
  if(!["buy","sell"].includes(side))
    return json(res,400,{error:"INVALID_SIDE"});

  const snap=await getSnapshot(symbol);
  const stock=snap.address;
  let sellToken,buyToken,sellAmount,inputUnits,notionalUsd;

  if(side==="buy"){
    sellToken=USDG;
    buyToken=stock;
    sellAmount=rawUnits(amount,6);
    inputUnits=Number(amount);
    notionalUsd=inputUnits;
  }else{
    sellToken=stock;
    buyToken=USDG;
    sellAmount=rawUnits(amount,18);
    inputUnits=Number(amount);
    notionalUsd=inputUnits*snap.market.fairValue;
  }
  if(!(inputUnits>0)||!(notionalUsd>0))throw new Error("INVALID_AMOUNT");

  const qr=await runQuote({
    sellToken,buyToken,sellAmount,taker:wallet,
    slippageBps:String(req.query?.slippageBps||50),
    provider:"all"
  });
  if(qr.status!==200)return json(res,qr.status,qr.body);

  const best=(qr.body.quotes||[])[0];
  if(!best)throw new Error("NO_EXECUTABLE_ROUTE");

  let effectivePrice,outputUnits;
  if(side==="buy"){
    outputUnits=formatUnits(best.buyAmount,18);
    effectivePrice=outputUnits>0?inputUnits/outputUnits:null;
  }else{
    outputUnits=formatUnits(best.buyAmount,6);
    effectivePrice=inputUnits>0?outputUnits/inputUnits:null;
  }

  const fair=snap.market.fairValue;
  const deviationPct=side==="buy"
    ?(effectivePrice/fair-1)*100
    :(1-effectivePrice/fair)*100;
  const adverseDeviationPct=Math.max(0,deviationPct);

  const gasKnown=best.gasUsd!=null && Number.isFinite(Number(best.gasUsd));
  const gasUsd=gasKnown?Number(best.gasUsd):null;
  const gasPct=gasKnown&&notionalUsd>0?gasUsd/notionalUsd*100:null;

  const priceQuality=clamp(100-adverseDeviationPct*45);
  const spreadQuality=clamp(100-Math.max(0,snap.market.spreadBps||0)*1.6);
  const gasEfficiency=gasKnown?clamp(100-gasPct*35):65;
  const marketQuality=snap.marketQuality?.score||0;

  let score=Math.round(
    priceQuality*.45+
    spreadQuality*.18+
    gasEfficiency*.22+
    marketQuality*.15
  );
  if(snap.market.isTradingHalt)score=0;

  return json(res,200,{
    symbol,side,amount,inputUnits,notionalUsd,
    stock:{
      symbol:snap.symbol,name:snap.name,address:snap.address,
      logoUrl:snap.logoUrl,multiplier:snap.multiplier
    },
    fair:{
      value:fair,bid:snap.market.bid,ask:snap.market.ask,
      spreadBps:snap.market.spreadBps,
      generatedAt:snap.market.generatedAt,
      isTradingHalt:snap.market.isTradingHalt
    },
    execution:{
      effectivePrice,outputUnits,buyAmount:best.buyAmount,
      label:best.label,provider:best.provider,route:best.route,
      gasUsd:best.gasUsd,netUsd:best.netUsd,
      deviationPct,adverseDeviationPct
    },
    glitchScore:{
      score,verdict:verdict(score),
      components:{
        priceQuality:Math.round(priceQuality),
        spreadQuality:Math.round(spreadQuality),
        gasEfficiency:Math.round(gasEfficiency),
        marketQuality
      }
    },
    baseline:{
      available:qr.body.baseline?.available||false,
      savingsVsUniswapUsd:qr.body.savingsVsUniswapUsd??null,
      savingsVsUniswapPct:qr.body.savingsVsUniswapPct??null
    },
    generatedAt:new Date().toISOString()
  });
}

module.exports=async function handler(req,res){
  if(req.method!=="GET")return json(res,405,{error:"METHOD_NOT_ALLOWED"});
  const action=String(req.query?.action||"registry").toLowerCase();
  try{
    if(action==="registry")return await registry(req,res);
    if(action==="scan")return await scan(req,res);
    if(action==="detail")return await detail(req,res);
    if(action==="execution")return await execution(req,res);
    return json(res,400,{error:"INVALID_STOCK_ACTION"});
  }catch(e){
    return json(res,502,{error:e.message||"STOCK_API_FAILED",action});
  }
};

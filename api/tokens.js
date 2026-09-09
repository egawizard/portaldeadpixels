const CHAIN_ID=4663;
const NATIVE="0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const {getAssets}=require("../lib/stocks");
function json(res,code,body){
  res.statusCode=code;
  res.setHeader("Content-Type","application/json; charset=utf-8");
  res.setHeader("Cache-Control","public, s-maxage=300, stale-while-revalidate=1800");
  res.end(JSON.stringify(body));
}
function addr(v){return /^0x[a-fA-F0-9]{40}$/.test(v||"");}
function normalize(t,source){
  if(!t||typeof t!=="object")return null;
  let address=String(t.address||t.tokenAddress||"");
  if(address==="0x0000000000000000000000000000000000000000") address=NATIVE;
  if(!addr(address))return null;
  const decimals=Number(t.decimals);
  if(!Number.isInteger(decimals)||decimals<0||decimals>255)return null;
  return {
    address,
    chainId:CHAIN_ID,
    symbol:String(t.symbol||"TOKEN").slice(0,32),
    name:String(t.name||t.symbol||"Token").slice(0,96),
    decimals,
    logoURI:t.logoURI||t.logoUrl||t.logo||null,
    priceUSD:t.priceUSD!=null?String(t.priceUSD):null,
    sources:[source]
  };
}
async function getLifi(){
  const headers={accept:"application/json"};
  if(process.env.LIFI_API_KEY)headers["x-lifi-api-key"]=process.env.LIFI_API_KEY;
  const r=await fetch(`https://li.quest/v1/tokens?chains=${CHAIN_ID}`,{headers});
  const body=await r.json();
  if(!r.ok)throw new Error(body?.message||`LI.FI HTTP ${r.status}`);
  let raw=[];
  if(Array.isArray(body))raw=body;
  else if(Array.isArray(body.tokens))raw=body.tokens;
  else if(body.tokens&&typeof body.tokens==="object")raw=body.tokens[String(CHAIN_ID)]||body.tokens[CHAIN_ID]||Object.values(body.tokens).flat();
  return raw.map(t=>normalize(t,"LI.FI")).filter(Boolean);
}
async function getNordstern(){
  const r=await fetch(`https://api.nordstern.finance/tokens/${CHAIN_ID}`,{headers:{accept:"application/json"}});
  const body=await r.json();
  if(!r.ok)throw new Error(body?.message||`NORDSTERN HTTP ${r.status}`);
  const raw=Array.isArray(body)?body:Array.isArray(body.tokens)?body.tokens:Array.isArray(body.data)?body.data:[];
  return raw.map(t=>normalize(t,"NORDSTERN")).filter(Boolean);
}

async function getStockTokens(){
  const assets=await getAssets();
  return assets.map(a=>({
    address:a.address,chainId:CHAIN_ID,symbol:a.symbol,name:a.name,decimals:18,
    logoURI:a.logoUrl||null,priceUSD:null,sources:["ROBINHOOD STOCK TOKENS"],rwa:true,
    currentMultiplier:a.currentMultiplier
  }));
}

module.exports=async function handler(req,res){
  if(req.method!=="GET")return json(res,405,{error:"METHOD_NOT_ALLOWED"});
  const settled=await Promise.allSettled([getLifi(),getNordstern(),getStockTokens()]);
  const all=[];
  const errors=[];
  settled.forEach((x,i)=>{
    if(x.status==="fulfilled")all.push(...x.value);
    else errors.push({source:i===0?"LI.FI":i===1?"NORDSTERN":"ROBINHOOD STOCK TOKENS",error:x.reason?.message||"FAILED"});
  });
  const map=new Map();
  for(const t of all){
    const k=t.address.toLowerCase();
    if(!map.has(k)){map.set(k,t);continue;}
    const old=map.get(k);
    old.sources=[...new Set([...(old.sources||[]),...(t.sources||[])])];
    if(!old.logoURI&&t.logoURI)old.logoURI=t.logoURI;
    if((!old.priceUSD||Number(old.priceUSD)===0)&&t.priceUSD)old.priceUSD=t.priceUSD;
    if((old.symbol==="TOKEN"||!old.symbol)&&t.symbol)old.symbol=t.symbol;
    if((old.name==="Token"||!old.name)&&t.name)old.name=t.name;
    if(t.rwa)old.rwa=true;
    if(!old.currentMultiplier&&t.currentMultiplier)old.currentMultiplier=t.currentMultiplier;
  }
  const tokens=[...map.values()].sort((a,b)=>{
    const pa=Number(a.priceUSD||0)>0?0:1,pb=Number(b.priceUSD||0)>0?0:1;
    if(pa!==pb)return pa-pb;
    return a.symbol.localeCompare(b.symbol);
  });
  return json(res,200,{chainId:CHAIN_ID,count:tokens.length,tokens,errors,sources:["LI.FI","NORDSTERN","ROBINHOOD STOCK TOKENS"]});
};
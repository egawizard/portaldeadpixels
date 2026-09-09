const {deadPixelsBalance,validAddress}=require("../lib/holder");

const API="https://trade-api.gateway.uniswap.org/v1";
const CHAIN_ID=4663;

function json(res,code,body){
  res.statusCode=code;
  res.setHeader("Content-Type","application/json; charset=utf-8");
  res.setHeader("Cache-Control","no-store");
  res.end(JSON.stringify(body));
}
function headers(){
  const key=String(process.env.UNISWAP_API_KEY||"");
  if(!key)throw new Error("UNISWAP_API_KEY_NOT_CONFIGURED");
  return {
    "x-api-key":key,
    "content-type":"application/json",
    "accept":"application/json",
    "x-universal-router-version":"2.1.1",
    "x-erc20eth-enabled":"false"
  };
}
async function post(path,body){
  const r=await fetch(API+path,{method:"POST",headers:headers(),body:JSON.stringify(body)});
  const text=await r.text();
  let j;try{j=JSON.parse(text)}catch{j={error:text}}
  if(!r.ok)throw new Error(j?.detail||j?.message||j?.error||`UNISWAP_HTTP_${r.status}`);
  return j;
}
function txSafe(tx){
  return !!(tx && /^0x[a-fA-F0-9]{40}$/.test(tx.to||"") && /^0x[0-9a-fA-F]*$/.test(tx.data||"0x"));
}
function quoteSwapper(quote){
  return String(
    quote?.swapper ||
    quote?.orderInfo?.swapper ||
    quote?.input?.swapper ||
    ""
  ).toLowerCase();
}

module.exports=async function handler(req,res){
  if(req.method!=="POST")return json(res,405,{error:"METHOD_NOT_ALLOWED"});
  try{
    const {wallet,routing,quote,permitData,signature}=req.body||{};
    if(!validAddress(wallet))return json(res,400,{error:"INVALID_WALLET"});
    const bal=await deadPixelsBalance(wallet);
    if(bal<1n)return json(res,403,{error:"DEAD_PIXELS_HOLDER_REQUIRED"});

    const r=String(routing||"").toUpperCase();
    const qs=quoteSwapper(quote);
    if(qs && qs!==wallet.toLowerCase())
      return json(res,400,{error:"QUOTE_SWAPPER_MISMATCH"});

    if(["DUTCH_V2","DUTCH_V3","PRIORITY","LIMIT_ORDER"].includes(r)){
      if(!signature)return json(res,400,{error:"UNISWAPX_SIGNATURE_REQUIRED"});
      const out=await post("/order",{routing:r,quote,signature});
      return json(res,201,{
        kind:"ORDER",
        routing:r,
        orderId:out.orderId,
        orderStatus:out.orderStatus,
        requestId:out.requestId
      });
    }

    if(["CLASSIC","WRAP","UNWRAP"].includes(r)){
      const body={
        quote,
        refreshGasPrice:true,
        simulateTransaction:true
      };
      if(signature)body.signature=signature;
      if(permitData)body.permitData=permitData;
      const out=await post("/swap",body);
      if(!txSafe(out.swap))throw new Error("UNISWAP_RETURNED_INVALID_TRANSACTION");
      return json(res,200,{
        kind:"SWAP",
        routing:r,
        gasFee:out.gasFee||null,
        requestId:out.requestId||null,
        transaction:{
          to:out.swap.to,
          data:out.swap.data||"0x",
          value:out.swap.value||"0x0",
          gas:out.swap.gasLimit||null,
          gasPrice:out.swap.gasPrice||null,
          maxFeePerGas:out.swap.maxFeePerGas||null,
          maxPriorityFeePerGas:out.swap.maxPriorityFeePerGas||null
        }
      });
    }

    return json(res,400,{error:`UNSUPPORTED_UNISWAP_ROUTING_${r||"UNKNOWN"}`});
  }catch(e){
    return json(res,502,{error:e.message||"UNISWAP_EXECUTION_FAILED"});
  }
};

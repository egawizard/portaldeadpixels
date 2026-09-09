const RPC = process.env.RH_RPC_URL || "https://rpc.mainnet.chain.robinhood.com/";
function json(res,code,body){res.statusCode=code;res.setHeader("Content-Type","application/json; charset=utf-8");res.setHeader("Cache-Control","public, max-age=120");res.end(JSON.stringify(body));}
function ok(a){return /^0x[a-fA-F0-9]{40}$/.test(a||"");}
async function rpc(method,params){
  const r=await fetch(RPC,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method,params})});
  const j=await r.json(); if(j.error) throw new Error(j.error.message||"RPC_ERROR"); return j.result;
}
async function call(to,data){return rpc("eth_call",[{to,data},"latest"]);}
function uint(hex){return Number(BigInt(hex||"0x0"));}
function decodeString(hex){
  if(!hex||hex==="0x") return "";
  const s=hex.slice(2);
  try{
    if(s.length===64){return Buffer.from(s.replace(/(00)+$/,""),"hex").toString("utf8").replace(/\0/g,"").trim();}
    if(s.length>=128){
      const off=Number(BigInt("0x"+s.slice(0,64)))*2;
      const len=Number(BigInt("0x"+s.slice(off,off+64)));
      return Buffer.from(s.slice(off+64,off+64+len*2),"hex").toString("utf8").replace(/\0/g,"").trim();
    }
  }catch{}
  return "";
}
module.exports=async function handler(req,res){
  if(req.method!=="GET")return json(res,405,{error:"METHOD_NOT_ALLOWED"});
  const address=String(req.query?.address||"");
  if(!ok(address))return json(res,400,{error:"INVALID_ADDRESS"});
  try{
    const code=await rpc("eth_getCode",[address,"latest"]);
    if(!code||code==="0x")return json(res,400,{error:"ADDRESS_HAS_NO_CONTRACT_CODE"});
    const [d,s,n]=await Promise.allSettled([
      call(address,"0x313ce567"),call(address,"0x95d89b41"),call(address,"0x06fdde03")
    ]);
    if(d.status!=="fulfilled") throw new Error("TOKEN_DECIMALS_UNAVAILABLE");
    const decimals=uint(d.value);
    if(!Number.isInteger(decimals)||decimals<0||decimals>255)throw new Error("INVALID_TOKEN_DECIMALS");
    const symbol=s.status==="fulfilled"?decodeString(s.value):"";
    const name=n.status==="fulfilled"?decodeString(n.value):"";
    return json(res,200,{address,symbol:symbol||"TOKEN",name:name||symbol||"ERC20",decimals,chainId:4663});
  }catch(e){return json(res,502,{error:e.message||"TOKEN_LOOKUP_FAILED"});}
};
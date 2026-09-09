const API="https://trade-api.gateway.uniswap.org/v1";
function json(res,code,body){
  res.statusCode=code;
  res.setHeader("Content-Type","application/json; charset=utf-8");
  res.setHeader("Cache-Control","no-store");
  res.end(JSON.stringify(body));
}
module.exports=async function handler(req,res){
  if(req.method!=="GET")return json(res,405,{error:"METHOD_NOT_ALLOWED"});
  const orderId=String(req.query?.orderId||"");
  if(!orderId)return json(res,400,{error:"ORDER_ID_REQUIRED"});
  const key=String(process.env.UNISWAP_API_KEY||"");
  if(!key)return json(res,503,{error:"UNISWAP_API_KEY_NOT_CONFIGURED"});
  try{
    const u=new URL(API+"/orders");
    u.searchParams.set("orderId",orderId);
    const r=await fetch(u,{headers:{"x-api-key":key,"accept":"application/json"}});
    const text=await r.text();
    let j;try{j=JSON.parse(text)}catch{j={error:text}}
    if(!r.ok)return json(res,r.status,{error:j?.message||j?.error||`UNISWAP_HTTP_${r.status}`});
    const item=Array.isArray(j.orders)?j.orders[0]:null;
    return json(res,200,{
      orderId,
      orderStatus:item?.orderStatus||"open",
      txHash:item?.txHash||null
    });
  }catch(e){
    return json(res,502,{error:e.message||"ORDER_STATUS_FAILED"});
  }
};

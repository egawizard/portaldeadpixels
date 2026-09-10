const alpha=require("../lib/alpha");
function json(res,code,body){res.statusCode=code;res.setHeader("Content-Type","application/json; charset=utf-8");res.setHeader("Cache-Control","no-store, max-age=0");res.setHeader("X-Content-Type-Options","nosniff");res.end(JSON.stringify(body));}
module.exports=async function handler(req,res){
  if(req.method!=="GET")return json(res,405,{error:"METHOD_NOT_ALLOWED"});
  try{
    const mode=String(req.query?.mode||"overview").toLowerCase();
    if(mode==="overview")return json(res,200,await alpha.overview());
    if(mode==="catalog")return json(res,200,await alpha.catalog(req.query?.cursor));
    if(mode==="search")return json(res,200,await alpha.search(req.query?.q));
    if(mode==="justborn")return json(res,200,await alpha.justBorn());
    if(mode==="detail")return json(res,200,await alpha.detail(req.query?.address,req.query?.pair,req.query?.source));
    if(mode==="ohlcv")return json(res,200,await alpha.ohlcv(req.query?.pool,req.query?.timeframe,req.query?.token));
    if(mode==="status")return json(res,200,await alpha.status());
    return json(res,400,{error:"INVALID_ALPHA_MODE"});
  }catch(e){return json(res,502,{error:e?.message||"GLITCH_ALPHA_FAILED"});}
};

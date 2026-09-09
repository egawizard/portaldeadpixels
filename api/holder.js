const {NFT_CONTRACT,validAddress,deadPixelsBalance}=require("../lib/holder");
function json(res,code,body){
  res.statusCode=code;
  res.setHeader("Content-Type","application/json; charset=utf-8");
  res.setHeader("Cache-Control","no-store");
  res.end(JSON.stringify(body));
}
module.exports=async function handler(req,res){
  if(req.method!=="GET")return json(res,405,{error:"METHOD_NOT_ALLOWED"});
  const wallet=String(req.query?.wallet||"");
  if(!validAddress(wallet))return json(res,400,{error:"INVALID_WALLET"});
  try{
    const balance=await deadPixelsBalance(wallet);
    return json(res,200,{
      wallet,
      nftContract:NFT_CONTRACT,
      balance:balance.toString(),
      eligible:balance>=1n,
      requirement:"HOLD_1_DEAD_PIXEL"
    });
  }catch(e){
    return json(res,502,{error:e.message||"HOLDER_CHECK_FAILED"});
  }
};

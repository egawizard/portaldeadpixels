const API="https://trade-api.gateway.uniswap.org/v1";
module.exports=async function handler(req,res){
  res.setHeader("Content-Type","application/json; charset=utf-8");
  res.setHeader("Cache-Control","no-store");

  const key=String(process.env.UNISWAP_API_KEY||"");
  let uniswapOfficial=false;
  let robinhoodSupported=false;
  let uniswapError=null;

  if(key){
    try{
      const r=await fetch(API+"/supported_chains",{
        headers:{"x-api-key":key,"accept":"application/json"}
      });
      const text=await r.text();
      let j; try{j=JSON.parse(text)}catch{j={}}
      if(!r.ok) throw new Error(j?.message||j?.error||`HTTP_${r.status}`);
      uniswapOfficial=true;
      robinhoodSupported=Array.isArray(j.chains) &&
        j.chains.some(c=>Number(c.chainId)===4663);
    }catch(e){
      uniswapError=e.message||"UNISWAP_API_CHECK_FAILED";
    }
  }

  res.status(200).json({
    ok:true,
    app:"GLITCH ROUTER V2.1 // ROBINHOOD UNISWAP FIX",
    chainId:4663,
    universalRouterVersion:"2.1.1",
    protocolFeeBps:0,
    holderGate:{
      enabled:true,
      minimumNFTs:1,
      nftContract:"0x27390fe7ae676fbfdb632e61cd4019996b07892c",
      enforcement:"SERVER_SIDE_EXECUTABLE_QUOTE_GATE"
    },
    strategy:"UNISWAP IS THE BASELINE. WE SEARCH FOR BETTER.",
    providers:{
      directWrap:true,
      uniswapOfficial,
      uniswapRobinhood4663:robinhoodSupported,
      uniswapX:"via Uniswap BEST_PRICE when eligible",
      nordsternDirect:true,
      lifi:true
    },
    uniswapError,
    missing:key?[]:["UNISWAP_API_KEY"]
  });
};
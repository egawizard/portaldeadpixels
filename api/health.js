module.exports=async function handler(req,res){
  res.setHeader("Content-Type","application/json; charset=utf-8");
  res.setHeader("Cache-Control","no-store");
  res.status(200).json({
    ok:true,
    app:"GLITCH ROUTER V2 // UNISWAP BASELINE ENGINE",
    chainId:4663,
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
      uniswapOfficial:!!process.env.UNISWAP_API_KEY,
      uniswapX:"via Uniswap BEST_PRICE when eligible",
      nordsternDirect:true,
      lifi:true
    },
    missing:process.env.UNISWAP_API_KEY?[]:["UNISWAP_API_KEY"]
  });
};
module.exports=async function handler(req,res){
  res.setHeader("Content-Type","application/json; charset=utf-8");
  res.setHeader("Cache-Control","no-store");
  res.status(200).json({
    ok:true,
    app:"GLITCH ROUTER V6 // NORDSTERN + HOLDER GATE",
    chainId:4663,
    protocolFeeBps:0,
    holderGate:{
      enabled:true,
      minimumNFTs:1,
      nftContract:"0x27390fe7ae676fbfdb632e61cd4019996b07892c",
      enforcement:"SERVER_SIDE_EXECUTABLE_QUOTE_GATE"
    },
    providers:{
      directWrap:true,
      nordsternDirect:true,
      uniswapDirectV3:true,
      lifi:true
    },
    ranking:"BEST NET OUTPUT when USD pricing is available"
  });
};
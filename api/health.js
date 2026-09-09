module.exports=async function handler(req,res){
  res.setHeader("Content-Type","application/json; charset=utf-8");
  res.setHeader("Cache-Control","no-store");
  const executor=String(process.env.GLITCH_EXECUTOR_ADDRESS||"");
  const executorConfigured=/^0x[a-fA-F0-9]{40}$/.test(executor);
  res.status(200).json({
    ok:true,
    app:"GLITCH ROUTER V3 // FULL RANGE DIRECT POOL ENGINE",
    chainId:4663,
    protocolFeeBps:0,
    holderGate:{
      enabled:true,
      minimumNFTs:1,
      nftContract:"0x27390fe7ae676fbfdb632e61cd4019996b07892c",
      enforcement:"PORTAL + CUSTOM EXECUTOR"
    },
    directPoolEngine:{
      configured:executorConfigured,
      address:executorConfigured?executor:null,
      tradeSizeThreshold:"NONE",
      singleHop:true,
      twoHop:true,
      intermediates:["WETH","USDG"]
    },
    providers:{
      directWrap:true,
      glitchDirectPool:executorConfigured,
      uniswapUniversalNative:true,
      uniswapV2Native:true,
      nordsternDirect:true,
      uniswapV3Direct:true,
      lifi:true
    },
    ranking:"BEST NET OUTPUT"
  });
};
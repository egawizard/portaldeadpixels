module.exports=async function handler(req,res){
  res.setHeader("Content-Type","application/json; charset=utf-8");
  res.setHeader("Cache-Control","no-store");
  res.status(200).json({
    ok:true,
    app:"GLITCH ROUTER V2 // MICRO GAS ENGINE",
    chainId:4663,
    protocolFeeBps:0,
    holderGate:{
      enabled:true,
      minimumNFTs:1,
      nftContract:"0x27390fe7ae676fbfdb632e61cd4019996b07892c",
      enforcement:"SERVER_SIDE_EXECUTABLE_QUOTE_GATE"
    },
    gasStrategy:{
      mode:"MICRO_GAS",
      robinhoodOrdering:"FCFS",
      directTxGasPrice:"RPC_CURRENT_PLUS_1_PERCENT"
    },
    providers:{
      directWrap:true,
      uniswapUniversalNative:true,
      uniswapV2Native:true,
      nordsternDirect:true,
      uniswapV3Direct:true,
      lifi:true
    },
    ranking:"BEST NET OUTPUT when USD pricing is available"
  });
};
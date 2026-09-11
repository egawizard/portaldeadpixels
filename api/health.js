const API="https://trade-api.gateway.uniswap.org/v1";
const {getAssets}=require("../lib/stocks");
module.exports=async function handler(req,res){
  res.setHeader("Content-Type","application/json; charset=utf-8");
  res.setHeader("Cache-Control","no-store");

  const key=String(process.env.UNISWAP_API_KEY||"");
  let uniswapOfficial=false,robinhoodSupported=false,uniswapError=null;
  let stockRegistry=false,stockTokenCount=0,stockRegistryError=null;

  if(key){
    try{
      const r=await fetch(API+"/supported_chains",{headers:{"x-api-key":key,"accept":"application/json"}});
      const text=await r.text();let j;try{j=JSON.parse(text)}catch{j={}}
      if(!r.ok)throw new Error(j?.message||j?.error||`HTTP_${r.status}`);
      uniswapOfficial=true;robinhoodSupported=Array.isArray(j.chains)&&j.chains.some(c=>Number(c.chainId)===4663);
    }catch(e){uniswapError=e.message||"UNISWAP_API_CHECK_FAILED";}
  }
  try{const assets=await getAssets();stockRegistry=true;stockTokenCount=assets.length;}catch(e){stockRegistryError=e.message||"STOCK_REGISTRY_CHECK_FAILED";}

  res.status(200).json({
    ok:true,
    app:"DEAD PIXELS PORTAL V3.7.7 // GLITCH ALPHA + UNIFIED EXECUTION OS",
    chainId:4663,
    protocolFeeBps:0,
    holderGate:{enabled:true,minimumNFTs:1,nftContract:"0x27390fe7ae676fbfdb632e61cd4019996b07892c",enforcement:"FULL_UI_HOLDER_GATE + SERVER_SIDE_EXECUTABLE_QUOTE_GATE",accessFlow:"EXPLICIT_CONNECT_THEN_READ_ONLY_SERVER_BALANCE_CHECK"},
    modules:{
      v30UnifiedPortalUI:true,
      v31StockTokenRegistry:{enabled:stockRegistry,count:stockTokenCount},
      v31MarketScanner:stockRegistry,
      v32FairValueEngine:{enabled:stockRegistry,source:"RHJ_BID_ASK_X_CURRENT_MULTIPLIER"},
      v32GlitchScore:true,
      v33StockToStock:true,
      v34PortfolioBuilder:true,
      v34Rebalancer:true,
      v35WaitForBetter:true,
      v35ExecutionOrders:"CLIENT_WATCH_WALLET_CONFIRMATION",
      v377GlitchAlpha:{enabled:true,scope:"UNIVERSAL_ERC20",directOnchainDiscovery:true,historicalSearch:true,multiSource:true,paginatedCatalog:true,qualifiedVolume:true,pairLevelRankings:true,canonicalPairScore:true,holderPipeline:"RATE_LIMIT_AWARE_BLOCKSCOUT_V2_WITH_LEGACY_FALLBACK",holderMap:true,liquidityLockIntel:true,dexScreenerPaidIntel:"ORDERS_PLUS_BOOSTS_PLUS_ADS",readabilityPass:true,tokenImageProxy:"SAME_ORIGIN_SSRF_SAFE_RASTER_ONLY",scoreModel:"V3.7.7_INTELLIGENT_MARKET_GUARD",universalCrashGuard:true,priceSurvivalComponent:true,anomalyEngine:true,turnoverQualityModel:true,distressExcludedFromTrending:true,riskRadarIncludesDistress:true,scoreExplainability:true,securitySafeAccess:{manualConnectOnly:true,autoProviderProbe:false,networkSwitchDuringGate:false,signatureDuringGate:false,transactionDuringGate:false}}
    },
    routing:{uniswapOfficial,uniswapRobinhood4663:robinhoodSupported,uniswapX:"via BEST_PRICE when eligible",nordsternDirect:true,lifi:true,directWrap:true},
    universalRouterVersion:"2.1.1",
    uniswapError,stockRegistryError,
    missing:key?[]:["UNISWAP_API_KEY"]
  });
};

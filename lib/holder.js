const NFT_CONTRACT = "0x27390fe7ae676fbfdb632e61cd4019996b07892c";
const RPC = process.env.RH_RPC_URL || "https://rpc.mainnet.chain.robinhood.com/";

function validAddress(v){
  return /^0x[a-fA-F0-9]{40}$/.test(v || "");
}
function padAddress(a){
  return a.toLowerCase().replace(/^0x/,"").padStart(64,"0");
}
async function rpc(method, params){
  const r = await fetch(RPC,{
    method:"POST",
    headers:{"content-type":"application/json"},
    body:JSON.stringify({jsonrpc:"2.0",id:1,method,params})
  });
  const j = await r.json();
  if(j.error) throw new Error(j.error.message || "RPC_ERROR");
  return j.result;
}
async function deadPixelsBalance(wallet){
  if(!validAddress(wallet)) throw new Error("INVALID_WALLET");
  const data = "0x70a08231" + padAddress(wallet);
  const result = await rpc("eth_call",[{to:NFT_CONTRACT,data},"latest"]);
  return BigInt(result || "0x0");
}
module.exports = { NFT_CONTRACT, validAddress, deadPixelsBalance };

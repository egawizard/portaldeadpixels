const hre = require("hardhat");

const V3_FACTORY = "0x1f7d7550b1b028f7571e69a784071f0205fd2efa";
const WETH = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";
const DEAD_PIXELS = "0x27390fe7ae676fbfdb632e61cd4019996b07892c";

async function main() {
  const net = await hre.ethers.provider.getNetwork();
  if (Number(net.chainId) !== 4663) {
    throw new Error(`Wrong network: expected Robinhood Chain 4663, got ${net.chainId}`);
  }

  const Executor = await hre.ethers.getContractFactory("GlitchDirectExecutor");
  const executor = await Executor.deploy(V3_FACTORY, WETH, DEAD_PIXELS);
  await executor.waitForDeployment();

  const address = await executor.getAddress();
  console.log("");
  console.log("GLITCH DIRECT EXECUTOR DEPLOYED");
  console.log("Address:", address);
  console.log("Factory:", V3_FACTORY);
  console.log("WETH:", WETH);
  console.log("DEAD PIXELS:", DEAD_PIXELS);
  console.log("");
  console.log("NEXT:");
  console.log(`Add GLITCH_EXECUTOR_ADDRESS=${address} to Vercel and redeploy.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

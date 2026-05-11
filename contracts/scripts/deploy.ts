import { ethers, network } from "hardhat";
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";

dotenv.config({ path: "../.env" });

interface DeploymentRecord {
  address: string;
  deployer: string;
  relay: string;
  maxMintPerBlock: string;
  blockNumber: number;
  txHash: string;
  timestamp: string;
}

async function main() {
  // ----- pre-flight validation for Sepolia -----
  if (network.name === "sepolia") {
    const missing: string[] = [];
    if (!process.env.SEPOLIA_RPC_URL) missing.push("SEPOLIA_RPC_URL");
    if (!process.env.RELAY_PRIVATE_KEY) missing.push("RELAY_PRIVATE_KEY");
    if (!process.env.RELAY_ADDRESS) missing.push("RELAY_ADDRESS");
    if (missing.length > 0) {
      throw new Error(
        `Missing required env vars for Sepolia deploy: ${missing.join(", ")}. ` +
          `Set them in the monorepo root .env file.`
      );
    }
    console.log("Sepolia pre-flight OK");
  }

  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  const admin = deployer.address;
  const relay = process.env.RELAY_ADDRESS ?? deployer.address;
  const maxMintPerBlock = ethers.parseUnits("1000", 18);

  const Token = await ethers.getContractFactory("PoHEToken");
  const token = await Token.deploy(
    "Proof of Harmonic Equilibrium",
    "PoHE",
    admin,
    relay,
    maxMintPerBlock
  );
  await token.waitForDeployment();

  const addr = await token.getAddress();
  console.log("PoHEToken deployed at:", addr);
  console.log("  admin:", admin);
  console.log("  relay (MINTER_ROLE):", relay);
  console.log("  maxMintPerBlock:", maxMintPerBlock.toString());

  // ----- deployment record -----
  const deployTx = token.deploymentTransaction();
  const receipt = deployTx ? await deployTx.wait() : null;

  const record: DeploymentRecord = {
    address: addr,
    deployer: deployer.address,
    relay,
    maxMintPerBlock: maxMintPerBlock.toString(),
    blockNumber: receipt?.blockNumber ?? 0,
    txHash: deployTx?.hash ?? "",
    timestamp: new Date().toISOString(),
  };

  const recordsDir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(recordsDir, { recursive: true });
  const recordPath = path.join(recordsDir, "sepolia.json");
  fs.writeFileSync(recordPath, JSON.stringify(record, null, 2) + "\n");
  console.log(`\nDeployment record saved: ${recordPath}`);

  // ----- .env block (ready to paste into monorepo root .env) -----
  console.log("\n--- paste into monorepo root .env ---");
  console.log(`POHE_TOKEN_ADDRESS=${addr}`);
  console.log("--- end .env block ---");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

import { ethers } from "hardhat";
import * as dotenv from "dotenv";

dotenv.config({ path: "../.env" });

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  const admin = deployer.address;
  // For local tests the relay is the deployer; on Sepolia, pass via env.
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
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

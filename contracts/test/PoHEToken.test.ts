import { expect } from "chai";
import { ethers } from "hardhat";

describe("PoHEToken", () => {
  async function deploy() {
    const [admin, relay, miner, stranger] = await ethers.getSigners();
    const Token = await ethers.getContractFactory("PoHEToken");
    const token = await Token.deploy(
      "Proof of Harmonic Equilibrium",
      "PoHE",
      admin.address,
      relay.address,
      ethers.parseUnits("1000", 18)
    );
    return { token, admin, relay, miner, stranger };
  }

  it("mints to miner when called by relay", async () => {
    const { token, relay, miner } = await deploy();
    const seed = ethers.keccak256(ethers.toUtf8Bytes("seed-1"));
    await token.connect(relay).mintReward(miner.address, 100n, seed);
    expect(await token.balanceOf(miner.address)).to.equal(100n);
  });

  it("rejects replays of the same (seed, miner) pair", async () => {
    const { token, relay, miner } = await deploy();
    const seed = ethers.keccak256(ethers.toUtf8Bytes("seed-2"));
    await token.connect(relay).mintReward(miner.address, 100n, seed);
    await expect(
      token.connect(relay).mintReward(miner.address, 100n, seed)
    ).to.be.revertedWithCustomError(token, "ProofAlreadyUsed");
  });

  it("rejects non-relay callers", async () => {
    const { token, stranger, miner } = await deploy();
    const seed = ethers.keccak256(ethers.toUtf8Bytes("seed-3"));
    await expect(
      token.connect(stranger).mintReward(miner.address, 100n, seed)
    ).to.be.revertedWithCustomError(
      token,
      "AccessControlUnauthorizedAccount"
    );
  });

  it("enforces per-mint cap", async () => {
    const { token, relay, miner } = await deploy();
    const seed = ethers.keccak256(ethers.toUtf8Bytes("seed-4"));
    const tooMuch = ethers.parseUnits("1001", 18);
    await expect(
      token.connect(relay).mintReward(miner.address, tooMuch, seed)
    ).to.be.revertedWithCustomError(token, "MintAmountExceedsCap");
  });
});

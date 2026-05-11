import { createConfig, http } from "wagmi";
import { sepolia } from "wagmi/chains";
import { injected } from "wagmi/connectors";

/**
 * Wagmi v2 config — Sepolia only, injected connector (MetaMask, Rabby, etc.).
 * No WalletConnect, no Coinbase — minimal footprint for MVP.
 * The wallet is read-only: used solely to prove the miner's address.
 */
export const config = createConfig({
  chains: [sepolia],
  connectors: [injected()],
  transports: {
    [sepolia.id]: http(),
  },
});

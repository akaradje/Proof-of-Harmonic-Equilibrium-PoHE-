import { useCallback, useEffect, useRef, useState } from "react";
import { createPublicClient, http } from "viem";
import { sepolia } from "viem/chains";

// ---- types ----

export interface MintEvent {
  txHash: string;
  miner: string;
  seed: string;
  amount: bigint;
  proofId: string;
  blockNumber: number;
}

// ---- ABI fragment (event only) ----

const proofAcceptedAbi = {
  type: "event" as const,
  name: "ProofAccepted" as const,
  inputs: [
    { type: "address" as const, name: "miner" as const, indexed: true },
    { type: "bytes32" as const, name: "seed" as const, indexed: true },
    { type: "uint256" as const, name: "amount" as const, indexed: false },
    { type: "bytes32" as const, name: "proofId" as const, indexed: false },
  ],
} as const;

const MAX_EVENTS = 50;

/** Read the deployed token address from the Vite env (set from monorepo .env). */
const TOKEN_ADDRESS: `0x${string}` =
  (import.meta.env.VITE_POHE_TOKEN_ADDRESS as `0x${string}`) ??
  "0x0000000000000000000000000000000000000000";

// ---- hook ----

export function useMintEvents() {
  const [events, setEvents] = useState<MintEvent[]>([]);
  const unwatchRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const client = createPublicClient({
      chain: sepolia,
      transport: http(), // built-in public Sepolia RPC — read-only, no wallet
    });

    // watchContractEvent polls eth_getLogs under the hood when transport is
    // HTTP (no WebSocket needed).  New events are prepended; list is capped.
    const unwatch = client.watchContractEvent({
      address: TOKEN_ADDRESS,
      abi: [proofAcceptedAbi],
      eventName: "ProofAccepted",
      onLogs: (logs) => {
        if (!logs.length) return;
        const incoming: MintEvent[] = logs.map((log) => {
          // viem types event args as T | undefined; the contract always
          // emits every field so a cast is safe here.
          const args = log.args as unknown as {
            miner: `0x${string}`;
            seed: `0x${string}`;
            amount: bigint;
            proofId: `0x${string}`;
          };
          return {
            txHash: log.transactionHash,
            miner: args.miner,
            seed: args.seed,
            amount: args.amount,
            proofId: args.proofId,
            blockNumber: Number(log.blockNumber),
          };
        });
        setEvents((prev) => {
          const merged = [...incoming, ...prev];
          return merged.length <= MAX_EVENTS ? merged : merged.slice(0, MAX_EVENTS);
        });
      },
    });

    unwatchRef.current = unwatch;
    return () => {
      unwatch();
    };
  }, []);

  const clear = useCallback(() => {
    setEvents([]);
  }, []);

  return { events, clear };
}

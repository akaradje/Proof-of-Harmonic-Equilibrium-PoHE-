import { useEffect, useRef, useState } from "react";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { useCanvasReducer } from "../hooks/useCanvasReducer";
import type { LayoutTemplate } from "../App";

type MinerStatus = "idle" | "connecting" | "mining" | "equilibrium" | "error";

interface SeedMessage {
  type: "seed";
  seed_hex: string;
  difficulty: number;
  checkpoint_every: number;
}

interface AckMessage {
  type: "ack";
  accepted: boolean;
  reason?: string | null;
  tx_hash?: string | null;
}

type ServerMessage = SeedMessage | AckMessage;

const RELAY_WS_URL: string =
  (import.meta.env.VITE_RELAY_WS_URL as string) || "ws://localhost:8080/ws";

const DEFAULT_ADDRESS = "0x000000000000000000000000000000000000dEaD";

/** Minimal inline connect button — no ConnectKit dependency. */
function WalletButton() {
  const { address, isConnected, isConnecting, isReconnecting } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();

  if (isConnecting || isReconnecting) {
    return (
      <button className="hud__btn wallet-btn" disabled>
        Connecting...
      </button>
    );
  }

  if (isConnected && address) {
    const short = `${address.slice(0, 6)}...${address.slice(-4)}`;
    return (
      <button
        className="hud__btn wallet-btn wallet-btn--connected"
        title={address}
        onClick={() => disconnect()}
      >
        {short}
      </button>
    );
  }

  const injected = connectors[0];
  return (
    <button
      className="hud__btn wallet-btn"
      disabled={!injected}
      onClick={() => connect({ connector: injected })}
    >
      Connect Wallet
    </button>
  );
}

/**
 * Main HUD. Owns the WebSocket to the relay and spawns a single-threaded
 * Web Worker per seed. The Worker runs the Wasm VDF; the Canvas reducer
 * mirrors its progress as Liquid Information animation.
 */
export function HUD({ template: _template }: { template: LayoutTemplate }) {
  const [status, setStatus] = useState<MinerStatus>("idle");
  const [lastTx, setLastTx] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const workerRef = useRef<Worker | null>(null);

  // Bound to the connected wallet address; falls back to zero address.
  const { address } = useAccount();
  const minerAddressRef = useRef<string>(address ?? DEFAULT_ADDRESS);

  useEffect(() => {
    minerAddressRef.current = address ?? DEFAULT_ADDRESS;
  }, [address]);

  const isConnected = !!address;

  const { attach, onTick, onEquilibrium, onIdle } = useCanvasReducer();

  useEffect(() => {
    if (canvasRef.current) attach(canvasRef.current);
  }, [attach]);

  // ---- worker lifecycle ----
  function spawnWorker(): Worker {
    const w = new Worker(new URL("../wasm/miner.worker.ts", import.meta.url), {
      type: "module",
    });
    w.onmessage = (ev: MessageEvent) => {
      const msg = ev.data as
        | { type: "progress"; rounds: number; digest_prefix: string }
        | {
            type: "done";
            seed_hex: string;
            difficulty: number;
            checkpoint_every: number;
            final_state_hex: string;
            checkpoints_hex: string[];
          }
        | { type: "error"; message: string };

      if (msg.type === "progress") {
        onTick(msg.rounds, msg.digest_prefix);
      } else if (msg.type === "done") {
        onEquilibrium();
        setStatus("equilibrium");
        wsRef.current?.send(
          JSON.stringify({
            type: "proof",
            ...msg,
            miner_address: minerAddressRef.current,
          })
        );
      } else if (msg.type === "error") {
        setError(msg.message);
        setStatus("error");
      }
    };
    return w;
  }

  function startMining() {
    setError(null);
    setStatus("connecting");
    const ws = new WebSocket(RELAY_WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus("mining");
    };
    ws.onerror = () => {
      setError("WebSocket error");
      setStatus("error");
    };
    ws.onclose = () => {
      workerRef.current?.terminate();
      workerRef.current = null;
      onIdle();
      if (status !== "error") setStatus("idle");
    };
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data) as ServerMessage;
      if (msg.type === "seed") {
        workerRef.current?.terminate();
        workerRef.current = spawnWorker();
        workerRef.current.postMessage({
          type: "start",
          seed_hex: msg.seed_hex,
          difficulty: msg.difficulty,
          checkpoint_every: msg.checkpoint_every,
        });
        setStatus("mining");
      } else if (msg.type === "ack") {
        if (msg.accepted) {
          setLastTx(msg.tx_hash ?? "(dev mode)");
        } else {
          setError(msg.reason ?? "rejected");
          setStatus("error");
        }
      }
    };
  }

  function stopMining() {
    wsRef.current?.close();
    workerRef.current?.terminate();
    workerRef.current = null;
    setStatus("idle");
  }

  return (
    <section className="hud glass">
      <div className="hud__controls">
        <button
          className="hud__btn"
          onClick={startMining}
          disabled={status === "mining" || !isConnected}
        >
          Start mining
        </button>
        <button className="hud__btn" onClick={stopMining} disabled={status === "idle"}>
          Stop
        </button>
        <WalletButton />
      </div>

      <canvas ref={canvasRef} className="hud__canvas" aria-label="Liquid Information" />

      <div className="hud__status">
        <span>Status: {status}</span>
        {lastTx && <span>Last mint tx: {lastTx}</span>}
        {error && <span className="hud__error">Error: {error}</span>}
        {address && <span className="hud__addr">{address}</span>}
      </div>
    </section>
  );
}

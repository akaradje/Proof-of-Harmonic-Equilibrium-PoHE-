/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_RELAY_WS_URL: string;
  readonly VITE_CHAIN_ID: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** PeerJS signaling server; defaults to the free PeerJS cloud server. */
  readonly VITE_PEER_HOST?: string;
  readonly VITE_PEER_PORT?: string;
  readonly VITE_PEER_PATH?: string;
  readonly VITE_PEER_SECURE?: string;
  /** Comma-separated STUN URLs; set to an empty string to use none (local tests). */
  readonly VITE_STUN_URLS?: string;
  /** Optional TURN relay for players on strict networks. */
  readonly VITE_TURN_URL?: string;
  readonly VITE_TURN_USERNAME?: string;
  readonly VITE_TURN_CREDENTIAL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

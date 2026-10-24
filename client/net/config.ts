import type { PeerOptions } from 'peerjs';

const env = import.meta.env;

/** Free public STUN servers: they help browsers find each other across home routers. */
const DEFAULT_STUN = 'stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302';

function iceServers(): RTCIceServer[] {
  const stun = (env.VITE_STUN_URLS ?? DEFAULT_STUN)
    .split(',')
    .map((url) => url.trim())
    .filter((url) => url !== '');
  const servers: RTCIceServer[] = stun.length > 0 ? [{ urls: stun }] : [];
  if (env.VITE_TURN_URL) {
    servers.push({
      urls: env.VITE_TURN_URL,
      username: env.VITE_TURN_USERNAME ?? '',
      credential: env.VITE_TURN_CREDENTIAL ?? '',
    });
  }
  return servers;
}

/** PeerJS settings from environment variables (see .env.example). */
export function peerOptions(): PeerOptions {
  const options: PeerOptions = { config: { iceServers: iceServers() }, debug: 1 };
  if (env.VITE_PEER_HOST) {
    options.host = env.VITE_PEER_HOST;
    if (env.VITE_PEER_PORT) options.port = Number(env.VITE_PEER_PORT);
    if (env.VITE_PEER_PATH) options.path = env.VITE_PEER_PATH;
    options.secure = env.VITE_PEER_SECURE !== 'false';
  }
  return options;
}

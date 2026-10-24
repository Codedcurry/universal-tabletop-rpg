import { defineConfig, devices } from '@playwright/test';

// End-to-end tests: real Chrome sessions talking over real WebRTC, through a
// local PeerJS signaling server so tests don't depend on the public cloud one.

const PEER_PORT = 9123;
const APP_PORT = 5174;

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${APP_PORT}`,
    trace: 'retain-on-failure',
    // Headless Chrome draws in software: start on Low graphics so effects don't slow every test.
    // e2e/graphics.spec.ts clears this to test the real defaults and every setting.
    storageState: {
      cookies: [],
      origins: [{ origin: `http://localhost:${APP_PORT}`, localStorage: [{ name: 'graphics-quality', value: 'low' }] }],
    },
    ...devices['Desktop Chrome'],
    launchOptions: {
      // Let two local browser sessions see each other's real addresses.
      args: ['--disable-features=WebRtcHideLocalIpsWithMdns'],
    },
  },
  webServer: [
    {
      command: `npx peerjs --port ${PEER_PORT} --path /peer`,
      port: PEER_PORT,
      reuseExistingServer: false,
    },
    {
      command: `npx vite --port ${APP_PORT} --strictPort`,
      port: APP_PORT,
      reuseExistingServer: false,
      env: {
        VITE_PEER_HOST: 'localhost',
        VITE_PEER_PORT: String(PEER_PORT),
        VITE_PEER_PATH: '/peer',
        VITE_PEER_SECURE: 'false',
        VITE_STUN_URLS: '',
      },
    },
  ],
});

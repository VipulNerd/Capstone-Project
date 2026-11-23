import { defineConfig } from '@playwright/test';
import path from 'node:path';

// Two suites:
//   regression  full UI flow against the real backend code with a fake AI (scripts/fake_ai_backend.py).
//               Starts that backend (port 8001) and a Vite dev server (port 5174) automatically.
//   smoke       short real-AI run against any deployment: E2E_BASE_URL=https://<app> npm run test:smoke
const SMOKE_URL = process.env.E2E_BASE_URL;
const repo = path.resolve(import.meta.dirname, '..');
const python =
  process.env.E2E_PYTHON ||
  path.join(repo, 'backend', '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');

const chrome = {
  channel: process.env.E2E_CHANNEL || 'chrome', // uses the installed Chrome; no browser download
  launchOptions: {
    args: [
      '--use-fake-device-for-media-stream', // fake microphone
      '--use-fake-ui-for-media-stream', // auto-accept mic permission
      '--auto-accept-this-tab-capture',
      '--auto-select-desktop-capture-source=Entire screen', // auto-pick a source for "Share meeting audio"
    ],
  },
  permissions: ['microphone', 'clipboard-read', 'clipboard-write'],
  acceptDownloads: true,
  viewport: { width: 1360, height: 900 },
};

export default defineConfig({
  testDir: './e2e',
  outputDir: './e2e/results',
  reporter: [['list'], ['html', { outputFolder: 'e2e/report', open: 'never' }]],
  use: { screenshot: 'on', trace: 'retain-on-failure' },
  projects: [
    {
      name: 'regression',
      testMatch: 'regression.spec.js',
      timeout: 5 * 60_000,
      use: { ...chrome, baseURL: 'http://localhost:5174' },
    },
    {
      name: 'smoke',
      testMatch: 'smoke.spec.js',
      timeout: 15 * 60_000, // real transcription of a few minutes of audio
      use: { ...chrome, baseURL: SMOKE_URL },
    },
  ],
  // Only the regression suite needs local servers.
  webServer: SMOKE_URL
    ? undefined
    : [
        {
          command: `"${python}" scripts/fake_ai_backend.py`,
          cwd: repo,
          url: 'http://127.0.0.1:8001/health',
          reuseExistingServer: false,
          timeout: 60_000,
        },
        {
          command: 'npx vite --port 5174 --strictPort',
          url: 'http://localhost:5174',
          env: { VITE_PROXY_TARGET: 'http://127.0.0.1:8001', VITE_CHUNK_SECONDS: '4' },
          reuseExistingServer: false,
          timeout: 60_000,
        },
      ],
});

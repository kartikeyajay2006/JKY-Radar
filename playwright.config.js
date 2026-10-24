import { defineConfig, devices } from '@playwright/test';

const API_PORT = 4100;
const WEB_PORT = 5180;
// Optional: point at a system Chrome/Chromium instead of the Playwright download.
const EXECUTABLE = process.env.PW_CHROMIUM_PATH;
const MONGO = process.env.MONGODB_URI_E2E ?? 'mongodb://127.0.0.1:27017/jky_radar_e2e';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...(EXECUTABLE ? { launchOptions: { executablePath: EXECUTABLE } } : {}),
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
      testIgnore: /mobile\.spec\.js/,
    },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /mobile\.spec\.js/ },
  ],
  webServer: [
    {
      command: 'npm run dev -w @jky/api',
      url: `http://localhost:${API_PORT}/api/v1/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        PORT: String(API_PORT),
        MONGODB_URI: MONGO,
        WEB_ORIGIN: `http://localhost:${WEB_PORT}`,
        API_ORIGIN: `http://localhost:${API_PORT}`,
        SESSION_SECRET: 'e2e-secret-e2e-secret-e2e-secret-0123456789',
        DEMO_SEED_ENABLED: 'true',
        RATE_LIMIT_ENABLED: 'false',
        ANALYSIS_ISOLATION: 'worker',
      },
    },
    {
      command: `npm run dev -w @jky/web -- --port ${WEB_PORT}`,
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: { VITE_DEV_API: `http://localhost:${API_PORT}` },
    },
  ],
});

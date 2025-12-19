// @ts-check
const { defineConfig, devices } = require('@playwright/test');

const DEFAULT_BASE_URL = 'http://127.0.0.1:8000';
const baseURL = process.env.BASE_URL || DEFAULT_BASE_URL;

/** @type {import('@playwright/test').PlaywrightTestConfig} */
module.exports = defineConfig({
  testDir: 'e2e',
  timeout: 60 * 1000,
  expect: { timeout: 10 * 1000 },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL,
    headless: true,
    // Capture helpful artifacts without bloating runs:
    // - trace on first retry for DOM/network/stepwise screenshots
    // - screenshots only when a test fails
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'python manage.py runserver 127.0.0.1:8000 --noreload',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
    stdout: 'pipe',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});

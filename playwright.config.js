// @ts-check
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: 'e2e',
  timeout: 60 * 1000,
  expect: { timeout: 10 * 1000 },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:8000',
    headless: true,
    trace: 'on-first-retry'
  },
  webServer: {
    command: 'python manage.py runserver 127.0.0.1:8000',
    url: 'http://127.0.0.1:8000',
    reuseExistingServer: true,
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


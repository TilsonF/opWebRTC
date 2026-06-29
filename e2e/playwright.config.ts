import { defineConfig, devices } from '@playwright/test';

/**
 * Levanta signaling (8080) + demo (5173) y corre los tests en Chromium con
 * dispositivos de media falsos (video/audio sintéticos), sin hardware real.
 */
export default defineConfig({
  testDir: './tests',
  timeout: 45_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:5199',
    permissions: ['camera', 'microphone'],
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: [
            '--use-fake-device-for-media-stream',
            '--use-fake-ui-for-media-stream',
            '--auto-select-desktop-capture-source=Entire screen',
          ],
        },
      },
    },
  ],
  // Puertos dedicados y sin reutilizar: evita chocar con otros dev servers
  // del entorno (p. ej. el de ripor en 5173).
  webServer: [
    {
      command: 'npm run dev:signaling',
      cwd: '..',
      port: 8080,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      // Segundo signaling CON auth para los tests de token (puerto 8081).
      command: 'AUTH_ENABLED=true AUTH_TOKEN=secreto-e2e PORT=8081 npm run dev:signaling',
      cwd: '..',
      port: 8081,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: 'npm run dev -w demo -- --port 5199 --strictPort',
      cwd: '..',
      url: 'http://localhost:5199',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
});

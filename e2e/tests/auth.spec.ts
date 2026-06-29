import { test, expect, type Page } from '@playwright/test';

// Apunta el demo al signaling con auth (puerto 8081).
const AUTH_SIGNALING = 'ws://localhost:8081';

async function enterWithToken(page: Page, room: string, token: string): Promise<void> {
  await page.goto(`/?signaling=${encodeURIComponent(AUTH_SIGNALING)}`);
  await page.fill('#room', room);
  if (token) await page.fill('#token', token);
  await page.click('#join');
}

/**
 * Auth de sala parametrizable: el signaling con AUTH_ENABLED rechaza joins sin
 * token o con token inválido, y acepta el token correcto.
 */
test('rechaza el ingreso con token inválido', async ({ page }) => {
  await enterWithToken(page, `e2e-auth-bad-${Date.now()}`, 'token-incorrecto');
  // El core recibe 'unauthorized' -> estado failed.
  await expect(page.locator('#state')).toHaveText('failed', { timeout: 15_000 });
});

test('rechaza el ingreso sin token', async ({ page }) => {
  await enterWithToken(page, `e2e-auth-none-${Date.now()}`, '');
  await expect(page.locator('#state')).toHaveText('failed', { timeout: 15_000 });
});

test('acepta el token correcto y conecta', async ({ browser }) => {
  const room = `e2e-auth-ok-${Date.now()}`;
  const ctxA = await browser.newContext({ permissions: ['camera', 'microphone'] });
  const ctxB = await browser.newContext({ permissions: ['camera', 'microphone'] });
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();

  await enterWithToken(a, room, 'secreto-e2e');
  await enterWithToken(b, room, 'secreto-e2e');

  await expect(a.locator('#state')).toHaveText('connected', { timeout: 25_000 });
  await expect(b.locator('#state')).toHaveText('connected', { timeout: 25_000 });

  await ctxA.close();
  await ctxB.close();
});

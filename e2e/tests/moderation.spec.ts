import { test, expect, type Page } from '@playwright/test';

async function enter(page: Page, room: string): Promise<void> {
  await page.goto('/');
  await page.fill('#room', room);
  await page.click('#join');
}

/**
 * Moderación: el creador de la sala es admin y puede expulsar al otro.
 *  - A (primero en entrar) ve el badge admin y el botón de expulsar.
 *  - B (segundo) NO es admin.
 *  - Al expulsar, B vuelve al prejoin y A se queda solo.
 */
test('el admin puede expulsar al otro participante', async ({ browser }) => {
  const room = `e2e-mod-${Date.now()}`;
  const ctxA = await browser.newContext({ permissions: ['camera', 'microphone'] });
  const ctxB = await browser.newContext({ permissions: ['camera', 'microphone'] });
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();

  // A entra primero -> admin.
  await enter(a, room);
  await expect(a.locator('#admin-badge')).toBeVisible();
  // B entra después -> no admin.
  await enter(b, room);
  await expect(b.locator('#admin-badge')).toBeHidden();

  await expect(a.locator('#state')).toHaveText('connected', { timeout: 25_000 });
  await expect(b.locator('#state')).toHaveText('connected', { timeout: 25_000 });

  // El botón de expulsar aparece para A cuando hay alguien presente.
  await expect(a.locator('#kick')).toBeVisible();
  await expect(b.locator('#kick')).toBeHidden();

  // A expulsa a B: B vuelve al prejoin.
  await a.click('#kick');
  await expect(b.locator('#prejoin')).toBeVisible({ timeout: 10_000 });

  // A se queda solo: su vista remota se limpia.
  await expect.poll(
    () => a.evaluate(() => Boolean((document.getElementById('remote') as HTMLVideoElement).srcObject)),
    { timeout: 10_000 },
  ).toBe(false);

  await ctxA.close();
  await ctxB.close();
});

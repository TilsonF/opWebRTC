import { test, expect, type Page } from '@playwright/test';

async function enter(page: Page, room: string): Promise<void> {
  await page.goto('/');
  await page.fill('#room', room);
  await page.click('#join');
}

const videoFlowing = (page: Page, id: string) =>
  page.evaluate((sel) => {
    const v = document.getElementById(sel) as HTMLVideoElement;
    const s = v.srcObject as MediaStream | null;
    return Boolean(s && s.getVideoTracks().length > 0 && v.videoWidth > 0);
  }, id);

/**
 * Screenshare como pista adicional: el peer remoto recibe la pantalla SIN
 * perder la cámara, y la UI pasa a modo "sharing" (estilo Meet).
 */
test('compartir pantalla llega al peer remoto y conserva la cámara', async ({ browser }) => {
  const room = `e2e-screen-${Date.now()}`;
  const ctxA = await browser.newContext({ permissions: ['camera', 'microphone'] });
  const ctxB = await browser.newContext({ permissions: ['camera', 'microphone'] });
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();

  await enter(a, room);
  await enter(b, room);
  await expect(a.locator('#state')).toHaveText('connected', { timeout: 25_000 });
  await expect(b.locator('#state')).toHaveText('connected', { timeout: 25_000 });

  // A comparte pantalla.
  await a.click('#screen');
  await expect(a.locator('#screen')).toHaveClass(/active/, { timeout: 10_000 });
  await expect(a.locator('#stage')).toHaveClass(/sharing/);

  // B RECIBE la pantalla (vista principal) y CONSERVA la cámara remota.
  await expect.poll(() => videoFlowing(b, 'screenView'), { timeout: 15_000 }).toBe(true);
  await expect(b.locator('#stage')).toHaveClass(/sharing/);
  expect(await videoFlowing(b, 'remote')).toBe(true);

  // A detiene: B sale de modo sharing.
  await a.click('#screen');
  await expect(a.locator('#screen')).not.toHaveClass(/active/, { timeout: 10_000 });
  await expect(b.locator('#stage')).not.toHaveClass(/sharing/, { timeout: 10_000 });

  await ctxA.close();
  await ctxB.close();
});

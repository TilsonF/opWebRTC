import { test, expect, type Page } from '@playwright/test';

/**
 * Test 1 — videollamada P2P 1‑a‑1.
 * Dos peers (contextos aislados) se unen a la misma sala y deben:
 *  1. llegar ambos al estado "connected"
 *  2. recibir el video remoto del otro (track + frames reales)
 */
test('dos peers establecen una videollamada P2P y reciben video', async ({ browser }) => {
  const room = `e2e-${Date.now()}`;

  const ctxA = await browser.newContext({ permissions: ['camera', 'microphone'] });
  const ctxB = await browser.newContext({ permissions: ['camera', 'microphone'] });
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();

  await a.goto('/');
  await b.goto('/');

  for (const p of [a, b]) {
    await p.fill('#room', room);
    await p.click('#join');
  }

  // 1) Ambos extremos negocian y conectan.
  await expect(a.locator('#state')).toHaveText('connected', { timeout: 25_000 });
  await expect(b.locator('#state')).toHaveText('connected', { timeout: 25_000 });

  // 2) El <video> remoto tiene un track vivo y frames fluyendo (videoWidth > 0).
  const remoteReceiving = (p: Page) =>
    p.evaluate(() => {
      const v = document.getElementById('remote') as HTMLVideoElement;
      const s = v.srcObject as MediaStream | null;
      return Boolean(s && s.getVideoTracks().length > 0 && v.videoWidth > 0);
    });

  await expect.poll(() => remoteReceiving(a), { timeout: 15_000 }).toBe(true);
  await expect.poll(() => remoteReceiving(b), { timeout: 15_000 }).toBe(true);

  await ctxA.close();
  await ctxB.close();
});

import { test, expect, type Page } from '@playwright/test';

async function enter(page: Page, room: string): Promise<void> {
  await page.goto('/');
  await page.fill('#room', room);
  await page.click('#join');
}

/**
 * Compartir pantalla. Chromium resuelve getDisplayMedia automáticamente por
 * los flags --use-fake-ui-for-media-stream y --auto-select-desktop-capture-source.
 * El botón se marca 'active' cuando el core emite screenShare(true) — lo que
 * solo ocurre tras un replaceTrack exitoso.
 */
test('compartir pantalla activa y revierte el envío de video', async ({ browser }) => {
  const room = `e2e-screen-${Date.now()}`;
  const ctxA = await browser.newContext({ permissions: ['camera', 'microphone'] });
  const ctxB = await browser.newContext({ permissions: ['camera', 'microphone'] });
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();

  // Unir AMBOS antes de esperar conexión (P2P necesita los dos peers presentes).
  await enter(a, room);
  await enter(b, room);
  await expect(a.locator('#state')).toHaveText('connected', { timeout: 25_000 });
  await expect(b.locator('#state')).toHaveText('connected', { timeout: 25_000 });

  // Iniciar screenshare en A.
  await a.click('#screen');
  await expect(a.locator('#screen')).toHaveClass(/active/, { timeout: 10_000 });

  // B sigue recibiendo video (ahora la pantalla de A).
  await expect
    .poll(() =>
      b.evaluate(() => {
        const v = document.getElementById('remote') as HTMLVideoElement;
        const s = v.srcObject as MediaStream | null;
        return Boolean(s && s.getVideoTracks().length > 0 && v.videoWidth > 0);
      }),
    )
    .toBe(true);

  // Detener y volver a cámara.
  await a.click('#screen');
  await expect(a.locator('#screen')).not.toHaveClass(/active/, { timeout: 10_000 });

  await ctxA.close();
  await ctxB.close();
});

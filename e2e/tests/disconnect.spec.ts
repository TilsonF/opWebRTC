import { test, expect, type Page } from '@playwright/test';

async function enter(page: Page, room: string): Promise<void> {
  await page.goto('/');
  await page.fill('#room', room);
  await page.click('#join');
}

/**
 * Al irse un participante, su vista debe limpiarse (no dejar el último frame
 * congelado) y mostrarse el placeholder de "esperando".
 */
test('cuando el otro peer se va, su vista se limpia', async ({ browser }) => {
  const room = `e2e-leave-${Date.now()}`;
  const ctxA = await browser.newContext({ permissions: ['camera', 'microphone'] });
  const ctxB = await browser.newContext({ permissions: ['camera', 'microphone'] });
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();

  await enter(a, room);
  await enter(b, room);
  await expect(a.locator('#state')).toHaveText('connected', { timeout: 25_000 });

  // B está recibiendo a A.
  const remoteHasStream = (p: Page) =>
    p.evaluate(() => Boolean((document.getElementById('remote') as HTMLVideoElement).srcObject));
  await expect.poll(() => remoteHasStream(b)).toBe(true);
  await expect(b.locator('#placeholder')).toHaveClass(/hidden/);

  // A se va (cierra su pestaña/contexto).
  await ctxA.close();

  // La vista remota de B se limpia y reaparece el placeholder.
  await expect.poll(() => remoteHasStream(b), { timeout: 10_000 }).toBe(false);
  await expect(b.locator('#placeholder')).not.toHaveClass(/hidden/);

  await ctxB.close();
});

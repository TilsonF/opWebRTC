import { test, expect, type Page } from '@playwright/test';

/** Une una página a una sala y espera a que el stream local exista. */
async function join(page: Page, room: string): Promise<void> {
  await page.goto('/');
  await page.fill('#room', room);
  await page.click('#join');
  // El <video> local recibe el stream tras getUserMedia.
  await expect
    .poll(() =>
      page.evaluate(() => {
        const v = document.getElementById('local') as HTMLVideoElement;
        return Boolean(v.srcObject);
      }),
    )
    .toBe(true);
}

const localTrackEnabled = (page: Page, kind: 'audio' | 'video') =>
  page.evaluate((k) => {
    const v = document.getElementById('local') as HTMLVideoElement;
    const s = v.srcObject as MediaStream;
    const t = k === 'audio' ? s.getAudioTracks()[0] : s.getVideoTracks()[0];
    return t?.enabled ?? null;
  }, kind);

test('mute de micrófono desactiva el track de audio', async ({ page }) => {
  await join(page, `e2e-mic-${Date.now()}`);

  expect(await localTrackEnabled(page, 'audio')).toBe(true);

  await page.click('#mic');
  expect(await localTrackEnabled(page, 'audio')).toBe(false);
  await expect(page.locator('#mic')).toHaveClass(/off/);

  await page.click('#mic'); // reactivar
  expect(await localTrackEnabled(page, 'audio')).toBe(true);
});

test('mute de cámara desactiva el track de video', async ({ page }) => {
  await join(page, `e2e-cam-${Date.now()}`);

  expect(await localTrackEnabled(page, 'video')).toBe(true);

  await page.click('#cam');
  expect(await localTrackEnabled(page, 'video')).toBe(false);
  await expect(page.locator('#cam')).toHaveClass(/off/);
});

test('los selectores de dispositivos se pueblan tras unirse', async ({ page }) => {
  await join(page, `e2e-dev-${Date.now()}`);

  // getDevices() del core alimenta los <select> de la toolbar.
  await expect.poll(() => page.locator('#cam-select option').count()).toBeGreaterThan(0);
  await expect.poll(() => page.locator('#mic-select option').count()).toBeGreaterThan(0);
});

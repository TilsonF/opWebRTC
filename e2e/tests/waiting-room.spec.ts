import { test, expect, type Browser, type Page } from '@playwright/test';

async function newPage(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext({ permissions: ['camera', 'microphone'] });
  return ctx.newPage();
}

async function enter(page: Page, opts: { room: string; name: string; approval?: boolean }): Promise<void> {
  await page.goto('/');
  await page.fill('#name', opts.name);
  await page.fill('#room', opts.room);
  if (opts.approval) await page.check('#approval');
  await page.click('#join');
}

/**
 * Sala de espera: el creador activa "requiere aprobación". El segundo queda en
 * espera con su nombre visible; el admin lo admite o rechaza.
 */
test('el anfitrión admite al participante en espera (con su nombre)', async ({ browser }) => {
  const room = `e2e-wait-${Date.now()}`;
  const a = await newPage(browser); // anfitrión
  const b = await newPage(browser); // invitado

  await enter(a, { room, name: 'Doctor', approval: true });
  await enter(b, { room, name: 'Paciente' });

  // B queda en sala de espera; A ve la solicitud con el nombre de B.
  await expect(b.locator('#waiting-overlay')).toBeVisible({ timeout: 10_000 });
  await expect(a.locator('#admit-prompt')).toBeVisible({ timeout: 10_000 });
  await expect(a.locator('#admit-name')).toHaveText('Paciente');

  // A admite -> ambos conectan y B sale de la espera.
  await a.click('#admit-yes');
  await expect(a.locator('#state')).toHaveText('connected', { timeout: 25_000 });
  await expect(b.locator('#state')).toHaveText('connected', { timeout: 25_000 });
  await expect(b.locator('#waiting-overlay')).toBeHidden();

  // A ve el nombre del participante.
  await expect(a.locator('#peer-name')).toHaveText('Paciente');
});

test('el anfitrión rechaza al participante en espera', async ({ browser }) => {
  const room = `e2e-reject-${Date.now()}`;
  const a = await newPage(browser);
  const b = await newPage(browser);

  await enter(a, { room, name: 'Doctor', approval: true });
  await enter(b, { room, name: 'Paciente' });

  await expect(a.locator('#admit-prompt')).toBeVisible({ timeout: 10_000 });

  // A rechaza -> B vuelve al prejoin con aviso.
  await a.click('#admit-no');
  await expect(b.locator('#prejoin')).toBeVisible({ timeout: 10_000 });
  await expect(b.locator('#toast')).toBeVisible();
});

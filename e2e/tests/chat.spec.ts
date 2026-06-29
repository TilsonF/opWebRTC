import { test, expect, type Page } from '@playwright/test';

async function enter(page: Page, room: string): Promise<void> {
  await page.goto('/');
  await page.fill('#room', room);
  await page.click('#join');
}

/**
 * Chat por data channel: los mensajes viajan P2P (RTCDataChannel), sin pasar
 * por el servidor. A envía y B recibe, y viceversa.
 */
test('los mensajes de chat llegan por el data channel', async ({ browser }) => {
  const room = `e2e-chat-${Date.now()}`;
  const ctxA = await browser.newContext({ permissions: ['camera', 'microphone'] });
  const ctxB = await browser.newContext({ permissions: ['camera', 'microphone'] });
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();

  await enter(a, room);
  await enter(b, room);
  await expect(a.locator('#state')).toHaveText('connected', { timeout: 25_000 });
  await expect(b.locator('#state')).toHaveText('connected', { timeout: 25_000 });

  // Ambos abren el chat (el panel oculta el input si no).
  await a.click('#chat-toggle');
  await b.click('#chat-toggle');

  // A envía un mensaje.
  await a.fill('#chat-text', 'hola desde A');
  await a.click('#chat-form button[type=submit]');

  // B lo recibe (mensaje "them").
  await expect(b.locator('#chat-log .msg.them')).toHaveText('hola desde A', { timeout: 10_000 });

  // B responde y A lo recibe.
  await b.fill('#chat-text', 'hola B aquí');
  await b.click('#chat-form button[type=submit]');
  await expect(a.locator('#chat-log .msg.them')).toHaveText('hola B aquí', { timeout: 10_000 });

  // El emisor ve su propio mensaje como "me".
  await expect(a.locator('#chat-log .msg.me')).toHaveText('hola desde A');

  await ctxA.close();
  await ctxB.close();
});

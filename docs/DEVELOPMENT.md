# Desarrollo

## Requisitos
- Node ≥ 20 (probado con 22/25), npm ≥ 10.

## Instalar
```bash
npm install    # instala todo el monorepo (workspaces)
```

## Correr en local
```bash
npm run build            # compila core + adaptadores
npm run dev:signaling    # servidor de señalización en ws://localhost:8080
npm run dev:demo         # demo en http://localhost:5199 (ver nota de puerto)
```
Abre el demo en **dos pestañas**, misma sala, para probar 1‑a‑1.

> **Puerto del demo**: usamos 5199 (`--port 5199 --strictPort`) porque 5173 lo
> ocupa el dev server de otro proyecto (ripor). Si cambias esto, actualiza
> `e2e/playwright.config.ts`.

> **Convención**: levanta signaling/demo solo al probar y detenlos al terminar.

## Tests e2e (Playwright)
```bash
npm run test:e2e                        # 15 tests, ~9s
npm run test:headed -w @opwebrtc/e2e    # con navegador visible
```
- Chromium con `--use-fake-device-for-media-stream` (media sintética, sin
  hardware). Cubre: conexión, mute, dispositivos, screenshare, desconexión,
  moderación, chat, auth, sala de espera.
- Playwright levanta sus propios servidores (signaling 8080, signaling-auth
  8081, demo 5199). Localmente reutiliza los que ya estén corriendo.
- El demo acepta `?signaling=ws://host:port` para apuntar a otro server (lo usan
  los tests de auth).

## Config del signaling (env + JSON)
Dos fuentes; **env tiene prioridad** sobre el JSON:
1. `opwebrtc.config.json` (o `CONFIG_FILE=ruta`) — ver `opwebrtc.config.example.json`.
2. Variables de entorno.

| Var | Default | Descripción |
|-----|---------|-------------|
| `PORT` | 8080 | Puerto WS + HTTP |
| `AUTH_ENABLED` / `AUTH_TOKEN` | false | Auth de sala por token |
| `TURN_SECRET` / `TURN_URLS` / `TURN_TTL` | — | TURN efímero (HMAC coturn) |
| `STUN_URL` | Google STUN | STUN por defecto |
| `TLS_CERT` / `TLS_KEY` | — | Activan `wss://` + `https` |

Fuente: `packages/signaling-server/src/config.ts`.

## Blur (nota de dev)
`@opwebrtc/core/blur` descarga MediaPipe (wasm + modelo) desde CDN en runtime.
En el demo se carga de forma diferida (solo al activar blur). **Bug abierto**:
se ve fluido en local pero congelado en la vista remota → investigar vía
insertable streams / WebCodecs.

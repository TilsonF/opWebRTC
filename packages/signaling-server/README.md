# @opwebrtc/signaling-server

Servidor de señalización WebSocket para [`@opwebrtc/core`](https://www.npmjs.com/package/@opwebrtc/core). No toca la media (P2P cifrado entre los peers); solo intercambia SDP/ICE y coordina la sala.

```bash
npx @opwebrtc/signaling-server
# o instálalo y córrelo
npm i -g @opwebrtc/signaling-server && opwebrtc-signaling
```

## Funciones
- Relay de SDP/ICE entre los dos peers de una sala
- Sala de espera (admitir/rechazar) + identidad por nombre
- Moderación (rol admin, expulsar)
- Auth de sala opcional por token
- `GET /ice` con credenciales TURN efímeras (HMAC coturn)
- WSS (TLS) opcional

## Configuración (env o JSON)
Por env, o por `opwebrtc.config.json` (o `CONFIG_FILE=ruta`). Las env vars
tienen prioridad. Ver `.env.example` y `opwebrtc.config.example.json`.

| Variable | Por defecto | Descripción |
|---|---|---|
| `PORT` | `8080` | Puerto WS + HTTP |
| `AUTH_ENABLED` / `AUTH_TOKEN` | `false` | Auth de sala por token |
| `TURN_SECRET` / `TURN_URLS` / `TURN_TTL` | — | TURN efímero (HMAC coturn) |
| `STUN_URL` | Google STUN | STUN por defecto |
| `TLS_CERT` / `TLS_KEY` | — | Activan `wss://` + `https` |

MIT

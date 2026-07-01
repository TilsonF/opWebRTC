# opWebRTC

[![CI](https://github.com/TilsonF/opWebRTC/actions/workflows/ci.yml/badge.svg)](https://github.com/TilsonF/opWebRTC/actions/workflows/ci.yml)

Librería **WebRTC agnóstica a frameworks** (TS/JS) para videollamadas personalizables, seguras y ligeras. P2P 1‑a‑1 con cámara, micrófono, compartir pantalla, blur de fondo, moderación y chat.

> 📖 **Manuales internos** en [`docs/`](./docs) · Roadmap en [`ROADMAP.md`](./ROADMAP.md)

## Estructura (monorepo)

```
opWebRTC/
├── packages/
│   ├── core/              → @opwebrtc/core · librería TS agnóstica (publicable a npm)
│   └── signaling-server/  → backend WebSocket: señalización + salas + auditoría
└── demo/                  → app vanilla TS que consume el core (prueba de agnosticismo)
```

- **core** y **signaling-server** son el producto.
- **demo** existe para demostrar que el core no depende de ningún framework de UI.

## Cómo funciona

En P2P el servidor **no toca la media**: el video/audio van cifrados directo entre los
dos navegadores (DTLS‑SRTP). El backend solo hace de "celestina" y portero:
intercambia SDP/ICE, agrupa peers en salas y registra auditoría de metadatos.

```
Peer A ──offer/ice──→ [signaling-server] ──offer/ice──→ Peer B
Peer A ←─answer/ice── [signaling-server] ←─answer/ice── Peer B
        (luego la media fluye DIRECTA y cifrada entre A y B)
```

## Arranque rápido

```bash
npm install
npm run build            # compila @opwebrtc/core (ESM + CJS + tipos)

# en dos terminales:
npm run dev:signaling    # ws://localhost:8080
npm run dev:demo         # http://localhost:5173
```

Abre el demo en **dos pestañas**, usa la misma sala y pulsa *Unirse* en ambas.

> Para probar entre dos máquinas distintas necesitas **HTTPS/WSS** (getUserMedia
> exige contexto seguro fuera de localhost) y un **TURN** (ej. `coturn`) para
> atravesar NAT/firewalls.

## Uso de la librería

```ts
import { Call } from '@opwebrtc/core';

const call = new Call({
  signalingUrl: 'wss://tu-backend/ws',
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
  audit: true,
});

call.on('localStream',  (s) => localVideo.srcObject = s);
call.on('remoteStream', (s) => remoteVideo.srcObject = s);
call.on('stateChange',  (s) => console.log('estado:', s));
call.on('audit',        (e) => log(e)); // solo metadatos, nunca contenido

await call.join('sala-123');
call.toggleCamera(false);
call.toggleMic(false);
await call.hangup();
```

El mismo `core` funciona en React, Vue o vanilla: solo emite `MediaStream` y eventos.

### Funcionalidades del core

```ts
// Dispositivos
const { cameras, microphones } = await call.getDevices();
await call.switchCamera(cameras[1].deviceId);
await call.switchMicrophone(microphones[0].deviceId);

// Mute
call.toggleCamera(false);
call.toggleMic(false);

// Compartir pantalla (revierte a cámara al terminar)
await call.startScreenShare();
await call.stopScreenShare();

// TURN efímero: credenciales frescas por conexión
new Call({ signalingUrl, iceServersProvider: async () =>
  (await fetch('/ice').then(r => r.json())).iceServers });

// Reconexión automática (ICE restart) — integrada, configurable
new Call({ signalingUrl, maxReconnectAttempts: 5 });
```

### Blur de fondo (opt-in, carga diferida)

Módulo aparte para no inflar el core; MediaPipe solo se descarga si lo usas:

```ts
import { BackgroundBlur } from '@opwebrtc/core/blur';

const blur = new BackgroundBlur({ blurRadius: 12 });
const blurred = await blur.process(cameraTrack);
await call.replaceOutgoingVideo(blurred);
// ...
blur.stop();
```

### TURN / coturn

`infra/` trae un `docker-compose.yml` + `turnserver.conf` listos. El
signaling-server firma credenciales efímeras (HMAC) en `GET /ice` con el mismo
`TURN_SECRET`. Ver `infra/` y `.env.example`.

## Seguridad

- Media cifrada por defecto (DTLS‑SRTP) — propio de WebRTC.
- En producción: **WSS** (TLS en señalización), autenticación por token de sala,
  y **credenciales TURN efímeras** emitidas por el backend (nunca fijas en el front).

### Auth de sala (parametrizable)

Desactivada por defecto. Para exigir token, arranca el servidor con:

```bash
AUTH_ENABLED=true AUTH_TOKEN=mi-secreto npm run dev:signaling
```

Y pásalo en el cliente:

```ts
new Call({ signalingUrl, token: 'mi-secreto' });
```

Si está activada y el token no coincide, el servidor responde `unauthorized`,
cierra la conexión y el core emite un evento `error`. Ver
`packages/signaling-server/.env.example`.

## Roadmap

### Fase A — sobre P2P 1‑a‑1 (hecho)

- [x] Auth por token en señalización (parametrizable, off por defecto)
- [x] WSS (TLS en señalización, vía `TLS_CERT`/`TLS_KEY`)
- [x] Credenciales TURN efímeras (`GET /ice` + coturn)
- [x] Reconexión / ICE restart
- [x] Selección de dispositivos (cámara/mic) en vivo
- [x] Compartir pantalla
- [x] Blur de fondo (módulo opt-in)
- [x] Demo funcional estilo Jitsi (logo overlay, controles, stats)
- [x] Moderación P2P: rol admin + sacar participante (kick)
- [x] Chat de texto por data channel
- [x] CI (GitHub Actions) con 12 tests e2e Playwright

### Fase B — requiere SFU (multiparticipante)

- [ ] Migración a SFU para llamadas grupales
- [ ] Moderación grupal: mute all (silenciar a todos)
- [ ] Control de calidad por capas (simulcast, bitrate)

### Pendientes / bugs abiertos

- [ ] Blur: se congela en la vista del peer remoto (local fluido) — investigar vía WebCodecs/insertable streams
```

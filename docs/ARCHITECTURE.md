# Arquitectura

## Monorepo (npm workspaces)

```
opWebRTC/
├── packages/
│   ├── core/              @opwebrtc/core — librería TS agnóstica (clase Call)
│   ├── react/             @opwebrtc/react — hook useCall()
│   ├── vue/               @opwebrtc/vue — composable useCall()
│   ├── angular/           @opwebrtc/angular — CallService (RxJS)
│   └── signaling-server/  @opwebrtc/signaling-server — backend WebSocket
├── demo/                  app vanilla TS (Vite) que consume el core
├── e2e/                   tests Playwright (navegador real, media falsa)
├── infra/                 docker-compose + turnserver.conf (coturn)
└── docs/                  estos manuales
```

## Principio de diseño: headless + agnóstico

El **core** nunca toca el DOM. La clase `Call` extiende `EventEmitter` y solo:
1. expone métodos (`join`, `toggleMic`, `startScreenShare`, `admit`, ...),
2. emite eventos (`localStream`, `remoteStream`, `stateChange`, ...),
3. maneja objetos estándar del navegador (`MediaStream`, `RTCPeerConnection`).

El consumidor (React/Vue/Angular/vanilla) hace el puente evento→UI. Por eso el
mismo core sirve en cualquier framework: los adaptadores son wrappers finos que
mapean los eventos a estado reactivo.

## Flujo P2P (por qué el servidor no toca la media)

```
Peer A ──offer/ice──▶ [signaling-server] ──offer/ice──▶ Peer B
Peer A ◀─answer/ice── [signaling-server] ◀─answer/ice── Peer B
        (luego la media fluye DIRECTA y cifrada A↔B por DTLS-SRTP)
```

El servidor es "celestina + portero": intercambia SDP/ICE, agrupa peers en
salas (máx 2), aplica auth/sala de espera/moderación. La media va P2P; solo
pasa por el servidor si se usa **TURN** (relay).

## Perfect negotiation

Ambos peers pueden ofertar; el patrón "perfect negotiation" resuelve las
colisiones (glare). El servidor asigna un rol **polite** (el primero en entrar)
y uno **impolite**; ante colisión, el polite cede. Ver `Call.handleSignalData`.

## Protocolo de señalización (mensajes)

Cliente→servidor: `join` (room, token?, name?, requireApproval?), `signal`
(SDP/ICE), `screen` (active), `kick`, `admit`, `reject`.

Servidor→cliente: `joined` (polite, admin, peerName?), `peer-joined` (name?),
`peer-left`, `room-full`, `unauthorized`, `waiting`, `participant-waiting`
(name), `rejected`, `kicked`, `signal`, `screen`.

Tipos en `packages/core/src/signaling.ts` (fuente de verdad del protocolo).

## Funcionalidades del core

- Video/audio HD, mute cámara/mic
- Selección de dispositivos en vivo (`getDevices`, `switchCamera/Microphone`)
- Compartir pantalla como **pista adicional** (el remoto ve pantalla + cámara)
- Blur de fondo (`@opwebrtc/core/blur`, opt-in, MediaPipe) — **bug abierto: se
  congela en el remoto; pendiente vía WebCodecs**
- Reconexión por ICE restart (parcial; ver ROADMAP)
- TURN efímero (`iceServersProvider`) y TURN forzado (`iceTransportPolicy`)
- Chat por data channel negociado
- Moderación (admin, kick), sala de espera (admit/reject), identidad por nombre
- Auditoría de metadatos (`audit: true`)

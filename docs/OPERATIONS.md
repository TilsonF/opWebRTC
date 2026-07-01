# Operación / Despliegue

## Componentes a desplegar
1. **signaling-server** — un servicio Node (WebSocket + HTTP). Escala fácil: en
   P2P solo intercambia texto (SDP/ICE), no media. Miles de llamadas 1‑a‑1
   simultáneas con un server modesto.
2. **coturn** (TURN/STUN) — solo necesario para atravesar NAT/firewalls
   difíciles o para forzar relay (privacidad). Aquí sí paga bandwidth.
3. El **frontend** (tu app con el core/adaptador) — estático.

## Desplegar el signaling
```bash
npx @opwebrtc/signaling-server           # rápido
# o con Docker/PM2/systemd apuntando a: node dist/index.js
```
Config por env o `opwebrtc.config.json` (ver DEVELOPMENT.md). En producción:
- `AUTH_ENABLED=true` + `AUTH_TOKEN` (o validación real de identidad).
- `TLS_CERT`/`TLS_KEY` para `wss://` (obligatorio fuera de localhost: los
  navegadores exigen contexto seguro para getUserMedia).

## WSS en local (pruebas)
```bash
# generar cert self-signed
openssl req -x509 -newkey rsa:2048 -nodes -keyout key.pem -out cert.pem \
  -days 2 -subj "/CN=localhost"
TLS_CERT=cert.pem TLS_KEY=key.pem npm run dev:signaling
# el server arranca en wss:// + https /ice  (verificado)
```

## coturn (TURN efímero)
Infra en `infra/` (`docker-compose.yml` + `turnserver.conf`).

```bash
# 1. En infra/turnserver.conf:
#    static-auth-secret=<mismo que TURN_SECRET>
#    realm=tu-dominio  y  external-ip=TU_IP_PUBLICA
#    (abre el rango UDP min-port..max-port en el firewall)
# 2. Levantar
docker compose -f infra/docker-compose.yml up -d
# 3. Signaling apuntando al TURN
TURN_SECRET=<secreto> TURN_URLS=turn:TU_IP:3478 npm run dev:signaling
```

**Cómo funciona el TURN efímero**: el signaling firma credenciales temporales
por HMAC-SHA1 en `GET /ice` (username = `expiry:opwebrtc`, credential =
`base64(HMAC(username, TURN_SECRET))`). El cliente las usa vía
`iceServersProvider`. Nunca pongas credenciales TURN fijas en el frontend.

**Probar que el relay funciona de verdad**: usa dos redes distintas (o
`iceTransportPolicy:'relay'`) y verifica en `chrome://webrtc-internals` que el
candidate seleccionado sea de tipo `relay`.

> Estado: HMAC validado; falta prueba end-to-end con coturn levantado (requiere
> Docker corriendo).

## Costos (mental model)
- P2P sin relay: casi gratis de operar (solo el signaling, texto).
- Con TURN forzado: pagas egress por cada llamada concurrente que usa relay
  (~1‑2 Mbps por sentido en HD).

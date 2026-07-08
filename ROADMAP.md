# Roadmap de opWebRTC

> Última actualización: 2026-07-07. Estado: v0.1.0 publicado (5 paquetes),
> P2P 1‑a‑1 completo y validado. Pendientes abajo para próximas sesiones.

## ✅ Hecho y validado (P2P 1‑a‑1)
- Videollamada P2P cifrada E2E (DTLS‑SRTP); cámara, mic, mute
- Compartir pantalla (layout estilo Meet, limpieza al salir)
- Selección de dispositivos en vivo
- Chat por data channel + badge de no leídos
- Moderación: rol admin + sacar participante
- Sala de espera (admitir/rechazar) + identidad por nombre
- Auth por token de sala
- **Blur de fondo** (Insertable Streams; fluido en remoto, feather del borde;
  fallback a canvas en Safari/Firefox) — validado por el usuario en Chrome
- Config del servidor: env + JSON opcional (`opwebrtc.config.json`)
- WSS (TLS) — verificado con cert self-signed
- **Adaptadores**: `@opwebrtc/react`, `@opwebrtc/vue`, `@opwebrtc/angular`
- **Publicado en npm**: core, signaling-server, react, vue, angular (todos @0.1.0)
- CI con 16 tests e2e (Playwright); release por token (workflow_dispatch/tag);
  seguridad endurecida (branch protection, allowed actions, Dependabot)

## ⏳ Pendientes (próximas sesiones)

### Infra / verificación con red real
- [ ] **coturn real**: `docker compose -f infra/docker-compose.yml up -d` +
  prueba de relay end-to-end (verificar candidate `relay` en webrtc-internals).
  Bloqueado: requiere Docker Desktop corriendo.
- [ ] **TURN efímero y forzado**: probar de verdad con coturn levantado (HMAC ya
  validado; `iceTransportPolicy:'relay'` flag listo).

### Reconexión robusta
- [ ] ICE restart ya existe, pero ante caída TOTAL de red falta:
  (1) el `SignalingChannel` no auto-reconecta el WS, (2) el server no tiene
  resumención de sesión. Implementar **WS auto-reconnect + session resume**.
  Difícil de e2e en localhost (loopback no lo afecta `setOffline`).

### Producto
- [ ] **Sitio de docs** (GitHub Pages + VitePress o Astro Starlight)
- [ ] **Grabación** (MVP `MediaRecorder` cliente + consentimiento; producción:
  SFU egress). Ver consideraciones de PHI en docs/SECURITY.
- [ ] Blur: opción de **suavizado temporal** de la máscara (mezclar máscaras
  consecutivas) si el feather no basta para el parpadeo en movimiento.

### Seguridad (acción del usuario)
- [ ] **Rotar el `NPM_TOKEN`**: el actual se filtró en chat. Revocar en npm,
  crear uno granular acotado a `@opwebrtc` y actualizar el secreto de GitHub.

## 🟣 Fase B — requiere SFU (multiparticipante)
- [ ] Migración a SFU (decisión: **LiveKit** [rápido] vs **mediasoup** [control total])
- [ ] Multiparticipante (>2)
- [ ] Moderación grupal: mute‑all
- [ ] Control de calidad por capas: simulcast + bitrate adaptativo

## 💡 Ideas futuras
- Perfil telemedicina (TURN forzado por defecto; cumplimiento/HCE = plataforma
  de TM, no la librería)
- Transcripción / subtítulos en vivo

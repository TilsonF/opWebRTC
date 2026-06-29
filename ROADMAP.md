# Roadmap de opWebRTC

## ✅ Hecho y validado (P2P 1‑a‑1)
- Videollamada P2P cifrada E2E (DTLS‑SRTP)
- Cámara, micrófono, mute
- Compartir pantalla (layout estilo Meet, limpieza al salir)
- Selección de dispositivos en vivo
- Chat por data channel + badge de no leídos
- Moderación: rol admin + sacar participante
- Sala de espera (admitir/rechazar) + identidad por nombre
- Auth por token de sala
- Config del servidor: env + JSON opcional (`opwebrtc.config.json`)
- WSS (TLS) — verificado con cert self-signed
- Publicado: `@opwebrtc/core@0.1.0` en npm
- CI con 15 tests e2e (Playwright); release por OIDC; seguridad endurecida

## 🟡 Hecho, falta verificar con infra real
- Reconexión / ICE restart (código listo)
- TURN efímero (HMAC validado, falta coturn levantado) — **mantener en roadmap**
- TURN forzado `iceTransportPolicy: 'relay'` (flag listo) — **mantener en roadmap**

## ⏸️ Bugs abiertos
- Blur se congela en la vista remota → vía: WebCodecs / insertable streams

## 🔵 En curso / próximo (sobre P2P)
- [ ] Reconexión: test e2e (simular caída de red)
- [ ] coturn real: docker-compose + prueba de relay end-to-end
- [ ] Publicar `@opwebrtc/signaling-server` a npm
- [ ] Adaptadores de framework:
  - [ ] `@opwebrtc/react` (hook `useCall`)
  - [ ] `@opwebrtc/vue` (composable `useCall`)
  - [ ] `@opwebrtc/angular` (servicio `CallService`)
- [ ] Grabación — **mantener en roadmap** (MVP `MediaRecorder` cliente + consentimiento; producción: SFU egress)
- [ ] Sitio de docs (GitHub Pages + VitePress/Starlight)

## 🟣 Fase B — requiere SFU (multiparticipante)
- [ ] Migración a SFU (decisión: LiveKit vs mediasoup)
- [ ] Multiparticipante (>2)
- [ ] Moderación grupal: mute‑all
- [ ] Control de calidad por capas: simulcast + bitrate adaptativo

## 💡 Ideas futuras
- Perfil telemedicina (TURN forzado por defecto; cumplimiento/HCE = plataforma de TM, no la librería)
- Transcripción / subtítulos en vivo

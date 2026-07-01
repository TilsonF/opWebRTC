# Manuales internos — opWebRTC

Documentación interna del proyecto (decisiones, procesos y operación). Para el
uso público de la librería, ver el [README](../README.md) y el
[ROADMAP](../ROADMAP.md).

| Manual | Contenido |
|--------|-----------|
| [ARCHITECTURE](./ARCHITECTURE.md) | Estructura del monorepo, paquetes, flujo P2P, protocolo de señalización |
| [DEVELOPMENT](./DEVELOPMENT.md) | Cómo correr, testear y configurar en local |
| [PUBLISHING](./PUBLISHING.md) | Proceso de release, versionado y publicación a npm |
| [SECURITY](./SECURITY.md) | Endurecimiento del repo/npm, tokens y rotación |
| [OPERATIONS](./OPERATIONS.md) | Despliegue del signaling, TURN/coturn y WSS |

## Resumen de 30 segundos

- **Qué es**: librería WebRTC agnóstica a frameworks para videollamadas P2P
  1‑a‑1 (cifradas E2E). Motor puro + adaptadores React/Vue/Angular + servidor
  de señalización.
- **Filosofía**: personalización, bajo peso, seguridad. El core no toca el DOM
  ni la media pasa por el servidor (salvo TURN).
- **Publicado**: `@opwebrtc/core`, `@opwebrtc/react`, `@opwebrtc/vue`,
  `@opwebrtc/angular`, `@opwebrtc/signaling-server` — todos en npm.
- **Repo**: https://github.com/TilsonF/opWebRTC (público).

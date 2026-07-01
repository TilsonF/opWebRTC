# Seguridad

Dos superficies distintas: **el código** (repo GitHub) y **la publicación**
(npm). Ambas endurecidas.

## Repo (GitHub)

| Medida | Estado | Detalle |
|--------|--------|---------|
| Branch protection en `master` | ✅ | Requiere PR + 1 aprobación, dismiss_stale. `enforce_admins=false` → el owner puede push directo (bypass). Force-push bloqueado. |
| Allowed actions | ✅ | Restringido a **solo actions de GitHub** (`github_owned_allowed`). Bloquea actions de terceros. |
| Dependabot | ✅ | Updates semanales de npm y github-actions. |
| CodeQL | ⬜ | Opcional (opdicom lo tiene; aquí no aún). |
| SHA pinning de actions | ⬜ | Opcional (más estricto: fijar actions a commit SHA en vez de tag). |

Cambiar allowed actions (referencia):
```bash
gh api repos/TilsonF/opWebRTC/actions/permissions            # ver
# restringir a github-owned: PUT allowed_actions=selected + selected-actions
```

## Publicación (npm)

- **Media cifrada E2E** (DTLS-SRTP) — propio de WebRTC, la media P2P no la ve
  nadie salvo los dos peers (ni el servidor).
- **Provenance** activo en releases CI (liga el paquete al commit/workflow).
- **Autenticación de release**: por **token** (`NPM_TOKEN` en secrets). Ver
  decisión abajo.

### OIDC vs Token (decisión)
- **Token** (elegido, como opdicom): un secreto publica todos los paquetes.
  Simple. Riesgo: secreto de larga vida; si se filtra, se pueden publicar todos.
- **OIDC / Trusted Publishing**: sin secreto, pero **por paquete** (tedioso con
  5 paquetes). `@opwebrtc/core` llegó a tener un Trusted Publisher configurado.

Recomendación de token: **granular**, acotado al scope `@opwebrtc`, permiso
read+write, bypass 2FA (para CI), con expiración → rotar.

### ⚠️ Pendiente de seguridad (IMPORTANTE)
- El primer `NPM_TOKEN` **se filtró en texto plano** durante el desarrollo y
  quedó como secreto de GitHub para desbloquear la publicación.
- **Acción requerida**: revocarlo en npmjs.com → Access Tokens, crear uno nuevo
  granular acotado y actualizar el secreto `NPM_TOKEN` (GitHub UI o
  `gh secret set NPM_TOKEN`). **Nunca** pegar tokens en chats/PRs/commits.

## Auth de sala y privacidad
- **Auth por token** de sala (opcional, `AUTH_ENABLED`).
- **Sala de espera**: el anfitrión admite/rechaza; identidad mínima por nombre.
- **TURN forzado** (`iceTransportPolicy: 'relay'`): oculta las IPs de ambos
  peers (útil en telemedicina). Costo: la media pasa por el TURN (bandwidth).
- **WSS**: TLS en la señalización (`TLS_CERT`/`TLS_KEY`).

> Cumplimiento (HIPAA/Res. 2654/Ley 1581, HCE, consentimiento) es
> responsabilidad de la **plataforma** que usa la librería, no de la librería.

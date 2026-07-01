# Publicación a npm

## Paquetes publicados
`@opwebrtc/core`, `@opwebrtc/react`, `@opwebrtc/vue`, `@opwebrtc/angular`,
`@opwebrtc/signaling-server` — todos bajo el scope **@opwebrtc** (org en npm,
owner: `fernandeztilson`). Todos públicos, MIT.

## Cómo se publica (CI, por token)

`release.yml` publica **todos** los paquetes con un único `NPM_TOKEN` (como el
repo opdicom). Ventaja vs OIDC: un solo secreto cubre todos los paquetes, sin
configurar un Trusted Publisher por paquete.

Se dispara por:
- **tag**: `git push` de un tag `vX.Y.Z`, o
- **manual**: Actions → Release → Run workflow (`workflow_dispatch`).

El workflow lee la versión de cada `package.json` y **salta las ya publicadas**,
así un tag que solo bumpea un paquete publica solo ese.

## Sacar una versión nueva
```bash
# 1. bump del/los paquete(s) que cambiaron
npm version patch -w @opwebrtc/react     # 0.1.0 -> 0.1.1

# 2. commit + tag + push
git commit -am "release @opwebrtc/react@0.1.1"
git tag v0.1.1 && git push && git push --tags
# release.yml publica los que subieron de versión
```

## Primer publish de un paquete nuevo
Con token no hay problema de "huevo y gallina": el token publica paquetes que
aún no existen. (Con OIDC sí lo habría, porque el Trusted Publisher es por
paquete y requiere que el paquete ya exista.)

## Publicar manualmente (sin CI)
```bash
npm login                                # login interactivo con 2FA
npm publish -w @opwebrtc/<paquete>       # corre prepublishOnly (build) solo
```

## Detalles de empaquetado
- Cada paquete publica solo `dist` (+ README). `files` en su `package.json`.
- `prepublishOnly: tsup` compila justo antes de publicar.
- Adaptadores: el framework va como **peerDependency** (no se empaqueta).
- `signaling-server`: se publica como binario (`opwebrtc-signaling`), ejecutable
  con `npx @opwebrtc/signaling-server`.
- Provenance: activo en CI (`--provenance` + `id-token: write`). El publish
  manual local no lleva provenance.

## Historial
- 2026-06-28: `@opwebrtc/core@0.1.0` (primero, vía OIDC).
- 2026-07-01: signaling + 3 adaptadores @0.1.0 (local, con token). Workflow
  migrado a token-based para publicar todos juntos.

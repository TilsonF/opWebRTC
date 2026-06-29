# @opwebrtc/vue

Composable Vue 3 para [`@opwebrtc/core`](https://www.npmjs.com/package/@opwebrtc/core).

```bash
npm install @opwebrtc/core @opwebrtc/vue vue
```

```vue
<script setup lang="ts">
import { watch, useTemplateRef } from 'vue';
import { useCall } from '@opwebrtc/vue';

const localEl = useTemplateRef<HTMLVideoElement>('localEl');
const remoteEl = useTemplateRef<HTMLVideoElement>('remoteEl');

const call = useCall({ signalingUrl: 'wss://tu-backend/ws', displayName: 'Ana' });

watch(call.localStream, (s) => { if (localEl.value) localEl.value.srcObject = s ?? null; });
watch(call.remoteStream, (s) => { if (remoteEl.value) remoteEl.value.srcObject = s ?? null; });
</script>

<template>
  <span>Estado: {{ call.state.value }}</span>
  <video ref="localEl" autoplay playsinline muted />
  <video ref="remoteEl" autoplay playsinline />
  <button @click="call.join('sala-123')">Entrar</button>
  <button @click="call.toggleMic(false)">Silenciar</button>
  <button @click="call.startScreenShare()">Compartir pantalla</button>
  <button @click="call.hangup()">Colgar</button>
  <p v-if="call.waiting.value">Esperando aprobación…</p>
  <div v-if="call.pendingApproval.value">
    {{ call.pendingApproval.value }} quiere entrar
    <button @click="call.admit()">Admitir</button>
    <button @click="call.reject()">Rechazar</button>
  </div>
</template>
```

Devuelve refs reactivas (`state`, `localStream`, `remoteStream`,
`remoteScreen`, `screenSharing`, `isAdmin`, `peerName`, `messages`, `waiting`,
`pendingApproval`, `error`) y acciones. Limpia solo al destruir el scope.

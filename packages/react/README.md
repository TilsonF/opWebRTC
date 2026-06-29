# @opwebrtc/react

Hook React para [`@opwebrtc/core`](https://www.npmjs.com/package/@opwebrtc/core).

```bash
npm install @opwebrtc/core @opwebrtc/react react
```

```tsx
import { useRef, useEffect } from 'react';
import { useCall } from '@opwebrtc/react';

export function VideoCall() {
  const localRef = useRef<HTMLVideoElement>(null);
  const remoteRef = useRef<HTMLVideoElement>(null);

  const call = useCall({
    signalingUrl: 'wss://tu-backend/ws',
    displayName: 'Ana',
  });

  useEffect(() => {
    if (localRef.current) localRef.current.srcObject = call.localStream ?? null;
  }, [call.localStream]);
  useEffect(() => {
    if (remoteRef.current) remoteRef.current.srcObject = call.remoteStream ?? null;
  }, [call.remoteStream]);

  return (
    <div>
      <span>Estado: {call.state}</span>
      <video ref={localRef} autoPlay playsInline muted />
      <video ref={remoteRef} autoPlay playsInline />
      <button onClick={() => call.join('sala-123')}>Entrar</button>
      <button onClick={() => call.toggleMic(false)}>Silenciar</button>
      <button onClick={() => call.startScreenShare()}>Compartir pantalla</button>
      <button onClick={() => call.hangup()}>Colgar</button>
      {call.waiting && <p>Esperando aprobación…</p>}
      {call.pendingApproval && (
        <div>
          {call.pendingApproval} quiere entrar
          <button onClick={call.admit}>Admitir</button>
          <button onClick={call.reject}>Rechazar</button>
        </div>
      )}
    </div>
  );
}
```

El hook expone estado reactivo (`state`, `localStream`, `remoteStream`,
`remoteScreen`, `screenSharing`, `isAdmin`, `peerName`, `messages`, `waiting`,
`pendingApproval`, `error`) y acciones (`join`, `hangup`, `toggleCamera`,
`toggleMic`, `startScreenShare`, `stopScreenShare`, `sendChat`, `admit`,
`reject`, `kick`). `call` es la instancia subyacente para uso avanzado.

> Nota: en `<StrictMode>` (desarrollo) React monta los efectos dos veces; usa
> el hook a nivel de página y llama `hangup()` explícitamente al salir.

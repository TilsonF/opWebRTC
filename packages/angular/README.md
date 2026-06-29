# @opwebrtc/angular

Servicio Angular para [`@opwebrtc/core`](https://www.npmjs.com/package/@opwebrtc/core).

```bash
npm install @opwebrtc/core @opwebrtc/angular
```

```ts
import { Component, ElementRef, ViewChild, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CallService } from '@opwebrtc/angular';

@Component({
  selector: 'app-call',
  standalone: true,
  imports: [CommonModule],
  template: `
    <span>Estado: {{ call.state$ | async }}</span>
    <video #remote autoplay playsinline></video>
    <button (click)="join()">Entrar</button>
    <button (click)="call.toggleMic(false)">Silenciar</button>
    <button (click)="call.hangup()">Colgar</button>
    <p *ngIf="call.waiting$ | async">Esperando aprobación…</p>
    <div *ngIf="call.pendingApproval$ | async as name">
      {{ name }} quiere entrar
      <button (click)="call.admit()">Admitir</button>
      <button (click)="call.reject()">Rechazar</button>
    </div>
  `,
})
export class CallComponent {
  @ViewChild('remote') remoteEl!: ElementRef<HTMLVideoElement>;
  readonly call = inject(CallService);

  constructor() {
    this.call.init({ signalingUrl: 'wss://tu-backend/ws', displayName: 'Ana' });
    this.call.remoteStream$.subscribe((s) => {
      if (this.remoteEl) this.remoteEl.nativeElement.srcObject = s ?? null;
    });
  }

  join() {
    this.call.join('sala-123');
  }
}
```

Expone observables (`state$`, `localStream$`, `remoteStream$`, `remoteScreen$`,
`screenSharing$`, `isAdmin$`, `peerName$`, `messages$`, `waiting$`,
`pendingApproval$`, `error$`) y métodos. Llama `init(config)` antes de `join()`.

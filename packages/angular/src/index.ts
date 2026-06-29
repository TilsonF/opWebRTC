import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { Call, type CallConfig, type CallState } from '@opwebrtc/core';

export interface ChatMsg {
  from: 'me' | 'them';
  text: string;
}

/**
 * Servicio Angular que envuelve `Call` y expone su estado como observables.
 * Inyéctalo, llama `init(config)` y luego `join(room)`.
 */
@Injectable({ providedIn: 'root' })
export class CallService {
  private call?: Call;

  readonly state$ = new BehaviorSubject<CallState>('idle');
  readonly localStream$ = new BehaviorSubject<MediaStream | undefined>(undefined);
  readonly remoteStream$ = new BehaviorSubject<MediaStream | undefined>(undefined);
  readonly remoteScreen$ = new BehaviorSubject<MediaStream | undefined>(undefined);
  readonly screenSharing$ = new BehaviorSubject<boolean>(false);
  readonly isAdmin$ = new BehaviorSubject<boolean>(false);
  readonly peerName$ = new BehaviorSubject<string | undefined>(undefined);
  readonly messages$ = new BehaviorSubject<ChatMsg[]>([]);
  readonly pendingApproval$ = new BehaviorSubject<string | undefined>(undefined);
  readonly waiting$ = new BehaviorSubject<boolean>(false);
  readonly error$ = new BehaviorSubject<Error | undefined>(undefined);

  /** Crea la llamada con la config. Llama esto antes de `join()`. */
  init(config: CallConfig): void {
    this.dispose();
    const call = new Call(config);
    this.call = call;

    call.on('stateChange', (s) => this.state$.next(s));
    call.on('localStream', (s) => this.localStream$.next(s));
    call.on('remoteStream', (s) => {
      this.remoteStream$.next(s);
      this.isAdmin$.next(call.isAdmin);
      this.peerName$.next(call.peerName);
      this.waiting$.next(false);
    });
    call.on('remoteScreen', (s) => this.remoteScreen$.next(s ?? undefined));
    call.on('screenShare', (active) => this.screenSharing$.next(active));
    call.on('remoteLeft', () => {
      this.remoteStream$.next(undefined);
      this.peerName$.next(undefined);
    });
    call.on('chatMessage', (text) =>
      this.messages$.next([...this.messages$.value, { from: 'them', text }]),
    );
    call.on('participantWaiting', (name) => this.pendingApproval$.next(name));
    call.on('waitingForApproval', () => this.waiting$.next(true));
    call.on('rejected', () => this.waiting$.next(false));
    call.on('error', (e) => this.error$.next(e));
  }

  join(room: string): Promise<void> {
    if (!this.call) throw new Error('Llama init(config) antes de join()');
    return this.call.join(room);
  }
  hangup(): Promise<void> {
    return this.call?.hangup() ?? Promise.resolve();
  }
  toggleCamera(on: boolean): void {
    this.call?.toggleCamera(on);
  }
  toggleMic(on: boolean): void {
    this.call?.toggleMic(on);
  }
  startScreenShare(): Promise<void> {
    return this.call?.startScreenShare() ?? Promise.resolve();
  }
  stopScreenShare(): Promise<void> {
    return this.call?.stopScreenShare() ?? Promise.resolve();
  }
  sendChat(text: string): void {
    if (this.call?.sendChat(text)) {
      this.messages$.next([...this.messages$.value, { from: 'me', text }]);
    }
  }
  admit(): void {
    this.call?.admit();
    this.pendingApproval$.next(undefined);
  }
  reject(): void {
    this.call?.reject();
    this.pendingApproval$.next(undefined);
  }
  kick(): void {
    this.call?.kickParticipant();
  }

  private dispose(): void {
    this.call?.removeAllListeners();
    void this.call?.hangup();
    this.call = undefined;
  }
}

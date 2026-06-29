import { EventEmitter } from 'eventemitter3';

/** Mensajes que viajan por el canal de señalización (cliente <-> servidor). */
export type SignalMessage =
  | { type: 'join'; room: string; token?: string; name?: string; requireApproval?: boolean }
  | { type: 'joined'; peerId: string; polite: boolean; admin: boolean; peerName?: string }
  | { type: 'peer-joined'; peerId: string; name?: string }
  | { type: 'peer-left'; peerId: string }
  | { type: 'room-full' }
  | { type: 'unauthorized' }
  | { type: 'screen'; active: boolean }
  | { type: 'kick' }
  | { type: 'kicked' }
  | { type: 'waiting' }
  | { type: 'participant-waiting'; name: string }
  | { type: 'admit' }
  | { type: 'reject' }
  | { type: 'rejected' }
  | { type: 'signal'; data: RTCSessionDescriptionInit | RTCIceCandidateInit | null };

interface SignalingEvents {
  open: () => void;
  message: (msg: SignalMessage) => void;
  close: () => void;
  error: (error: Error) => void;
}

/**
 * Envoltura mínima sobre WebSocket. No entiende SDP/ICE: solo transporta JSON.
 * El servidor de señalización reenvía estos mensajes entre los dos peers.
 */
export class SignalingChannel extends EventEmitter<SignalingEvents> {
  private ws?: WebSocket;

  constructor(private readonly url: string) {
    super();
  }

  connect(): void {
    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.onopen = () => this.emit('open');
    ws.onclose = () => this.emit('close');
    ws.onerror = () =>
      this.emit('error', new Error('Fallo en el canal de señalización'));
    ws.onmessage = (ev) => {
      try {
        this.emit('message', JSON.parse(ev.data as string) as SignalMessage);
      } catch {
        this.emit('error', new Error('Mensaje de señalización inválido'));
      }
    };
  }

  send(msg: SignalMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  close(): void {
    this.ws?.close();
    this.ws = undefined;
  }
}

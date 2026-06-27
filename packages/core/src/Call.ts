import { EventEmitter } from 'eventemitter3';
import { SignalingChannel, type SignalMessage } from './signaling.js';
import type { CallConfig, CallEvents, CallState, CallStats } from './types.js';

/** Constraints por defecto: HD 720p + audio limpio (eco/ruido cancelados). */
const DEFAULT_MEDIA: MediaStreamConstraints = {
  video: {
    width: { ideal: 1280 },
    height: { ideal: 720 },
    frameRate: { ideal: 30 },
  },
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  },
};

const DEFAULT_ICE: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
];

/**
 * Una videollamada 1‑a‑1 P2P.
 *
 * Headless por diseño: emite `MediaStream` y eventos, nunca toca el DOM.
 * El consumidor (React, Vue, vanilla...) conecta los streams a sus <video>.
 *
 * Usa el patrón "perfect negotiation" para manejar glare (ofertas simultáneas).
 */
export class Call extends EventEmitter<CallEvents> {
  private readonly config: Required<Pick<CallConfig, 'media' | 'iceServers'>> &
    CallConfig;
  private signaling?: SignalingChannel;
  private pc?: RTCPeerConnection;
  private localStream?: MediaStream;
  private readonly remoteStream = new MediaStream();
  private room = '';

  // Estado de perfect negotiation.
  private polite = false;
  private makingOffer = false;
  private ignoreOffer = false;

  private state: CallState = 'idle';
  private statsTimer?: ReturnType<typeof setInterval>;
  private prevBytes = { in: 0, out: 0, ts: 0 };

  constructor(config: CallConfig) {
    super();
    this.config = {
      ...config,
      media: config.media ?? DEFAULT_MEDIA,
      iceServers: config.iceServers ?? DEFAULT_ICE,
    };
  }

  /** Estado actual de la llamada. */
  get currentState(): CallState {
    return this.state;
  }

  /** Adquiere cámara/mic y se une a la sala. */
  async join(room: string): Promise<void> {
    if (this.state !== 'idle') {
      throw new Error(`No se puede unir desde el estado "${this.state}"`);
    }
    this.room = room;
    this.setState('connecting');

    this.localStream = await navigator.mediaDevices.getUserMedia(
      this.config.media,
    );
    this.emit('localStream', this.localStream);
    this.audit('media-acquired', {
      tracks: this.localStream.getTracks().map((t) => t.kind),
    });

    this.setupSignaling();
  }

  /** Enciende/apaga el track de video local. */
  toggleCamera(on: boolean): void {
    for (const t of this.localStream?.getVideoTracks() ?? []) t.enabled = on;
    this.audit('camera-toggle', { on });
  }

  /** Enciende/apaga el track de audio local. */
  toggleMic(on: boolean): void {
    for (const t of this.localStream?.getAudioTracks() ?? []) t.enabled = on;
    this.audit('mic-toggle', { on });
  }

  /** Métricas de calidad para tu UI o tu pipeline de auditoría. */
  async getStats(): Promise<CallStats> {
    const out: CallStats = {};
    if (!this.pc) return out;
    const report = await this.pc.getStats();
    report.forEach((s) => {
      if (s.type === 'candidate-pair' && s.nominated && s.currentRoundTripTime != null) {
        out.rtt = s.currentRoundTripTime * 1000;
      }
      if (s.type === 'inbound-rtp' && !s.isRemote) {
        out.jitter = s.jitter != null ? s.jitter * 1000 : out.jitter;
        out.packetsLost = s.packetsLost ?? out.packetsLost;
      }
    });
    return out;
  }

  /** Cuelga, cierra la conexión y libera cámara/mic. */
  async hangup(): Promise<void> {
    this.audit('hangup');
    if (this.statsTimer) clearInterval(this.statsTimer);
    this.signaling?.send({ type: 'signal', data: null });
    this.signaling?.close();
    this.pc?.close();
    for (const t of this.localStream?.getTracks() ?? []) t.stop();
    this.pc = undefined;
    this.localStream = undefined;
    this.setState('closed');
  }

  // ── interno ────────────────────────────────────────────────────────────

  private setupSignaling(): void {
    const ch = new SignalingChannel(this.config.signalingUrl);
    this.signaling = ch;
    ch.on('open', () =>
      ch.send({ type: 'join', room: this.room, token: this.config.token }),
    );
    ch.on('error', (e) => this.emit('error', e));
    ch.on('message', (m) => void this.onSignal(m));
    ch.connect();
  }

  private async onSignal(msg: SignalMessage): Promise<void> {
    switch (msg.type) {
      case 'joined':
        // El servidor asigna roles: el "polite" cede ante glare.
        this.polite = msg.polite;
        this.audit('joined', { polite: msg.polite });
        this.createPeerConnection();
        break;
      case 'peer-joined':
        // Hay alguien al otro lado: arrancamos negociación.
        this.audit('peer-joined');
        break;
      case 'room-full':
        this.emit('error', new Error('La sala ya tiene dos participantes'));
        break;
      case 'unauthorized':
        this.audit('unauthorized');
        this.emit('error', new Error('Token de sala inválido o ausente'));
        this.setState('failed');
        break;
      case 'peer-left':
        this.audit('peer-left');
        this.setState('disconnected');
        break;
      case 'signal':
        await this.handleSignalData(msg.data);
        break;
    }
  }

  private createPeerConnection(): void {
    const pc = new RTCPeerConnection({ iceServers: this.config.iceServers });
    this.pc = pc;

    for (const track of this.localStream?.getTracks() ?? []) {
      pc.addTrack(track, this.localStream!);
    }

    pc.ontrack = ({ track }) => {
      this.remoteStream.addTrack(track);
      this.emit('remoteStream', this.remoteStream);
    };

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        this.signaling?.send({ type: 'signal', data: candidate.toJSON() });
      }
    };

    pc.onnegotiationneeded = async () => {
      try {
        this.makingOffer = true;
        await pc.setLocalDescription();
        this.signaling?.send({ type: 'signal', data: pc.localDescription! });
      } catch (err) {
        this.emit('error', err as Error);
      } finally {
        this.makingOffer = false;
      }
    };

    pc.onconnectionstatechange = () => {
      switch (pc.connectionState) {
        case 'connected':
          this.setState('connected');
          this.startStatsLoop();
          break;
        case 'disconnected':
          this.setState('disconnected');
          break;
        case 'failed':
          this.setState('failed');
          break;
        case 'closed':
          this.setState('closed');
          break;
      }
    };
  }

  /** Núcleo del patrón perfect negotiation. */
  private async handleSignalData(
    data: RTCSessionDescriptionInit | RTCIceCandidateInit | null,
  ): Promise<void> {
    const pc = this.pc;
    if (!pc || data == null) return;

    try {
      if ('type' in data && (data.type === 'offer' || data.type === 'answer')) {
        const desc = data as RTCSessionDescriptionInit;
        const offerCollision =
          desc.type === 'offer' &&
          (this.makingOffer || pc.signalingState !== 'stable');

        this.ignoreOffer = !this.polite && offerCollision;
        if (this.ignoreOffer) return;

        await pc.setRemoteDescription(desc);
        if (desc.type === 'offer') {
          await pc.setLocalDescription();
          this.signaling?.send({ type: 'signal', data: pc.localDescription! });
        }
      } else {
        try {
          await pc.addIceCandidate(data as RTCIceCandidateInit);
        } catch (err) {
          if (!this.ignoreOffer) throw err;
        }
      }
    } catch (err) {
      this.emit('error', err as Error);
    }
  }

  private startStatsLoop(): void {
    if (this.statsTimer) return;
    this.statsTimer = setInterval(async () => {
      const stats = await this.getStats();
      if (this.config.audit) this.audit('stats', { ...stats });
    }, 5000);
  }

  private setState(state: CallState): void {
    if (state === this.state) return;
    this.state = state;
    this.emit('stateChange', state);
    this.audit('state', { state });
  }

  private audit(type: string, data?: Record<string, unknown>): void {
    if (!this.config.audit) return;
    this.emit('audit', {
      type,
      room: this.room,
      timestamp: Date.now(),
      data,
    });
  }
}

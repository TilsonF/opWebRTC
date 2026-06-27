import { EventEmitter } from 'eventemitter3';
import { SignalingChannel, type SignalMessage } from './signaling.js';
import type {
  CallConfig,
  CallEvents,
  CallState,
  CallStats,
  DeviceList,
} from './types.js';

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

const DEFAULT_ICE: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];

/**
 * Una videollamada 1‑a‑1 P2P.
 *
 * Headless por diseño: emite `MediaStream` y eventos, nunca toca el DOM.
 * El consumidor (React, Vue, vanilla...) conecta los streams a sus <video>.
 *
 * Usa el patrón "perfect negotiation" para manejar glare (ofertas simultáneas)
 * y `restartIce()` para reconectar ante caídas de red.
 */
export class Call extends EventEmitter<CallEvents> {
  private readonly config: CallConfig;
  private readonly maxReconnect: number;
  private signaling?: SignalingChannel;
  private pc?: RTCPeerConnection;
  private localStream?: MediaStream;
  private readonly remoteStream = new MediaStream();
  private room = '';
  private resolvedIce: RTCIceServer[] = DEFAULT_ICE;

  // Senders para reemplazar tracks (cambio de dispositivo / blur).
  private videoSender?: RTCRtpSender;
  private audioSender?: RTCRtpSender;
  // Screenshare como track ADICIONAL (no reemplaza la cámara).
  private screenSender?: RTCRtpSender;
  private screenStream?: MediaStream;
  private screenSharing = false;
  // Id del stream de cámara remoto, para distinguirlo del de pantalla.
  private remoteCameraStreamId?: string;

  // Estado de perfect negotiation.
  private polite = false;
  private makingOffer = false;
  private ignoreOffer = false;

  // Reconexión.
  private reconnectAttempts = 0;

  private state: CallState = 'idle';
  private statsTimer?: ReturnType<typeof setInterval>;

  constructor(config: CallConfig) {
    super();
    this.config = config;
    this.maxReconnect = config.maxReconnectAttempts ?? 5;
  }

  /** Estado actual de la llamada. */
  get currentState(): CallState {
    return this.state;
  }

  /** ¿Está compartiendo pantalla ahora mismo? */
  get isScreenSharing(): boolean {
    return this.screenSharing;
  }

  /** Adquiere cámara/mic y se une a la sala. */
  async join(room: string): Promise<void> {
    if (this.state !== 'idle') {
      throw new Error(`No se puede unir desde el estado "${this.state}"`);
    }
    this.room = room;
    this.setState('connecting');

    this.localStream = await navigator.mediaDevices.getUserMedia(
      this.config.media ?? DEFAULT_MEDIA,
    );
    this.emit('localStream', this.localStream);
    this.audit('media-acquired', {
      tracks: this.localStream.getTracks().map((t) => t.kind),
    });

    // Resuelve credenciales ICE (TURN efímero si hay provider).
    this.resolvedIce = this.config.iceServersProvider
      ? await this.config.iceServersProvider()
      : (this.config.iceServers ?? DEFAULT_ICE);

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

  /** Lista cámaras, micrófonos y altavoces disponibles. */
  async getDevices(): Promise<DeviceList> {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return {
      cameras: devices.filter((d) => d.kind === 'videoinput'),
      microphones: devices.filter((d) => d.kind === 'audioinput'),
      speakers: devices.filter((d) => d.kind === 'audiooutput'),
    };
  }

  /** Cambia la cámara activa preservando el estado de mute. */
  async switchCamera(deviceId: string): Promise<void> {
    await this.replaceLocalTrack('video', { deviceId: { exact: deviceId } });
    this.audit('switch-camera', { deviceId });
  }

  /** Cambia el micrófono activo preservando el estado de mute. */
  async switchMicrophone(deviceId: string): Promise<void> {
    await this.replaceLocalTrack('audio', { deviceId: { exact: deviceId } });
    this.audit('switch-microphone', { deviceId });
  }

  /**
   * Comparte la pantalla como pista ADICIONAL: el peer remoto sigue viendo
   * tu cámara y recibe además la pantalla. La pantalla va en su propio stream
   * para que el otro extremo pueda distinguirla de la cámara.
   */
  async startScreenShare(): Promise<void> {
    if (this.screenSharing || !this.pc) return;
    const screen = await navigator.mediaDevices.getDisplayMedia({ video: true });
    this.screenStream = screen;
    const track = screen.getVideoTracks()[0]!;
    // addTrack en su propio stream -> nueva negociación -> el remoto lo recibe.
    this.screenSender = this.pc.addTrack(track, screen);
    // Si el usuario detiene desde el diálogo nativo del navegador.
    track.onended = () => void this.stopScreenShare();
    this.screenSharing = true;
    this.signaling?.send({ type: 'screen', active: true });
    this.emit('screenShare', true, screen);
    this.audit('screenshare-start');
  }

  /** Deja de compartir pantalla (la cámara nunca se interrumpió). */
  async stopScreenShare(): Promise<void> {
    if (!this.screenSharing) return;
    if (this.screenSender) {
      this.pc?.removeTrack(this.screenSender);
      this.screenSender = undefined;
    }
    for (const t of this.screenStream?.getTracks() ?? []) t.stop();
    this.screenStream = undefined;
    this.screenSharing = false;
    this.signaling?.send({ type: 'screen', active: false });
    this.emit('screenShare', false);
    this.audit('screenshare-stop');
  }

  /** Reemplaza el track de video saliente por uno procesado (p. ej. blur). */
  async replaceOutgoingVideo(track: MediaStreamTrack): Promise<void> {
    await this.videoSender?.replaceTrack(track);
    this.audit('replace-video', { label: track.label });
  }

  /** Métricas de calidad para tu UI o tu pipeline de auditoría. */
  async getStats(): Promise<CallStats> {
    const out: CallStats = {};
    if (!this.pc) return out;
    const report = await this.pc.getStats();
    report.forEach((s) => {
      if (
        s.type === 'candidate-pair' &&
        s.nominated &&
        s.currentRoundTripTime != null
      ) {
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
    for (const t of this.screenStream?.getTracks() ?? []) t.stop();
    for (const t of this.localStream?.getTracks() ?? []) t.stop();
    this.pc = undefined;
    this.localStream = undefined;
    this.setState('closed');
  }

  // ── interno ────────────────────────────────────────────────────────────

  /** Adquiere un nuevo track y lo intercambia en el sender y en localStream. */
  private async replaceLocalTrack(
    kind: 'video' | 'audio',
    extra: MediaTrackConstraints,
  ): Promise<void> {
    const base =
      kind === 'video'
        ? (this.config.media?.video ?? DEFAULT_MEDIA.video)
        : (this.config.media?.audio ?? DEFAULT_MEDIA.audio);
    const constraints: MediaStreamConstraints = {
      [kind]: { ...(typeof base === 'object' ? base : {}), ...extra },
    };
    const fresh = await navigator.mediaDevices.getUserMedia(constraints);
    const newTrack = fresh.getTracks()[0]!;

    const old =
      kind === 'video'
        ? this.localStream?.getVideoTracks()[0]
        : this.localStream?.getAudioTracks()[0];
    newTrack.enabled = old?.enabled ?? true;

    const sender = kind === 'video' ? this.videoSender : this.audioSender;
    if (!(kind === 'video' && this.screenSharing)) {
      await sender?.replaceTrack(newTrack);
    }

    if (old) {
      this.localStream?.removeTrack(old);
      old.stop();
    }
    this.localStream?.addTrack(newTrack);
    if (this.localStream) this.emit('localStream', this.localStream);
  }

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
        this.polite = msg.polite;
        this.audit('joined', { polite: msg.polite });
        this.createPeerConnection();
        break;
      case 'peer-joined':
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
      case 'screen':
        // El remoto dejó de compartir: oculta su pantalla.
        if (!msg.active) this.emit('remoteScreen', null);
        break;
      case 'peer-left':
        this.audit('peer-left');
        this.clearRemote();
        this.setState('disconnected');
        break;
      case 'signal':
        await this.handleSignalData(msg.data);
        break;
    }
  }

  private createPeerConnection(): void {
    const pc = new RTCPeerConnection({ iceServers: this.resolvedIce });
    this.pc = pc;

    for (const track of this.localStream?.getTracks() ?? []) {
      const sender = pc.addTrack(track, this.localStream!);
      if (track.kind === 'video') this.videoSender = sender;
      else this.audioSender = sender;
    }

    pc.ontrack = (ev) => {
      const stream = ev.streams[0];
      // El primer stream remoto es la cámara; cualquier stream distinto que
      // llegue después es la pantalla compartida.
      if (stream && this.remoteCameraStreamId && stream.id !== this.remoteCameraStreamId) {
        this.emit('remoteScreen', stream);
        ev.track.onended = () => this.emit('remoteScreen', null);
        ev.track.onmute = () => this.emit('remoteScreen', null);
        this.audit('remote-screen-track');
        return;
      }
      if (stream && !this.remoteCameraStreamId) this.remoteCameraStreamId = stream.id;
      this.remoteStream.addTrack(ev.track);
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
          this.reconnectAttempts = 0;
          this.setState('connected');
          this.startStatsLoop();
          break;
        case 'disconnected':
          this.setState('disconnected');
          this.tryReconnect();
          break;
        case 'failed':
          this.tryReconnect();
          break;
        case 'closed':
          this.setState('closed');
          break;
      }
    };
  }

  /** Limpia las vistas remotas cuando el otro peer se va (sin frame congelado). */
  private clearRemote(): void {
    for (const t of this.remoteStream.getTracks()) this.remoteStream.removeTrack(t);
    this.remoteCameraStreamId = undefined;
    this.emit('remoteScreen', null);
    this.emit('remoteLeft');
  }

  /** Reconexión por ICE restart. Solo el peer impolite la inicia (evita doble). */
  private tryReconnect(): void {
    if (this.polite || !this.pc) return;
    if (this.reconnectAttempts >= this.maxReconnect) {
      this.setState('failed');
      this.audit('reconnect-gaveup', { attempts: this.reconnectAttempts });
      return;
    }
    this.reconnectAttempts++;
    this.audit('ice-restart', { attempt: this.reconnectAttempts });
    this.pc.restartIce();
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

/**
 * Tipos públicos de @opwebrtc/core.
 * Nada de esto depende de un framework de UI: solo objetos estándar del navegador.
 */

/** Estado del ciclo de vida de una llamada. */
export type CallState =
  | 'idle' // creada, sin unirse aún
  | 'connecting' // negociando con el peer
  | 'connected' // media fluyendo
  | 'disconnected' // caída temporal de red (puede reconectar)
  | 'failed' // conexión fallida sin recuperación
  | 'closed'; // colgada / liberada

/** Configuración con la que se construye una llamada. */
export interface CallConfig {
  /** URL del servidor de señalización (ws:// o wss://). */
  signalingUrl: string;
  /**
   * Servidores ICE (STUN/TURN). Para producción usa siempre un TURN
   * con credenciales efímeras emitidas por tu backend.
   */
  iceServers?: RTCIceServer[];
  /**
   * Constraints de getUserMedia. Aquí se personaliza cámara/mic, HD, etc.
   * Por defecto: video HD 720p + audio con cancelación de eco.
   */
  media?: MediaStreamConstraints;
  /** Emite eventos `audit` con metadatos de la sesión (no contenido). */
  audit?: boolean;
}

/** Evento de auditoría: solo metadatos, nunca media. */
export interface AuditEvent {
  type: string;
  room?: string;
  /** epoch ms */
  timestamp: number;
  data?: Record<string, unknown>;
}

/** Snapshot de métricas de calidad derivado de RTCStatsReport. */
export interface CallStats {
  /** Round-trip time en ms, si está disponible. */
  rtt?: number;
  /** Jitter de recepción en ms. */
  jitter?: number;
  /** Paquetes perdidos acumulados (inbound). */
  packetsLost?: number;
  /** Bitrate de bajada estimado en kbps. */
  inboundKbps?: number;
  /** Bitrate de subida estimado en kbps. */
  outboundKbps?: number;
}

/** Mapa de eventos que emite `Call`. El consumidor se suscribe con `.on(...)`. */
export interface CallEvents {
  /** Stream local listo (tu cámara/mic). Conéctalo a un <video> muted. */
  localStream: (stream: MediaStream) => void;
  /** Stream remoto del otro peer. Conéctalo a un <video>. */
  remoteStream: (stream: MediaStream) => void;
  /** Cambió el estado de la llamada. */
  stateChange: (state: CallState) => void;
  /** Error recuperable o fatal. */
  error: (error: Error) => void;
  /** Evento de auditoría (solo si `audit: true`). */
  audit: (event: AuditEvent) => void;
}

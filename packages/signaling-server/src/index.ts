import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer as createHttp, type IncomingMessage, type ServerResponse } from 'node:http';
import { createServer as createHttps } from 'node:https';
import { WebSocketServer, type WebSocket } from 'ws';
import { config } from './config.js';

/**
 * Servidor de señalización para videollamadas 1‑a‑1.
 *
 * Responsabilidades (NO toca la media):
 *  - Agrupa peers en salas (máx. 2) y asigna el rol "polite".
 *  - Reenvía mensajes `signal` (SDP/ICE) al otro peer.
 *  - Auth de sala opcional por token.
 *  - Sirve GET /ice con credenciales TURN efímeras (HMAC coturn).
 *  - Soporta WSS si se le pasan certificados TLS.
 */

const PORT = config.port;

// ── Auth de sala (opcional) ────────────────────────────────────────────────
function isAuthorized(token: unknown): boolean {
  if (!config.auth.enabled) return true;
  return typeof token === 'string' && token.length > 0 && token === config.auth.token;
}

// ── TURN efímero (coturn REST: user = expiry:id, pass = HMAC-SHA1) ──────────
function iceServers(): RTCIceServerLike[] {
  const { secret, urls, ttl, stunUrl } = config.turn;
  const servers: RTCIceServerLike[] = [{ urls: stunUrl }];
  if (secret && urls.length) {
    const expiry = Math.floor(Date.now() / 1000) + ttl;
    const username = `${expiry}:opwebrtc`;
    const credential = createHmac('sha1', secret).update(username).digest('base64');
    servers.push({ urls, username, credential });
  }
  return servers;
}

interface RTCIceServerLike {
  urls: string | string[];
  username?: string;
  credential?: string;
}

// ── TLS opcional (WSS) ─────────────────────────────────────────────────────
const useTls = Boolean(config.tls.cert && config.tls.key);

function handleHttp(req: IncomingMessage, res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'GET' && req.url?.startsWith('/ice')) {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ iceServers: iceServers() }));
    return;
  }
  if (req.method === 'GET' && req.url === '/health') {
    res.end('ok');
    return;
  }
  res.statusCode = 404;
  res.end('not found');
}

const server = useTls
  ? createHttps(
      { cert: readFileSync(config.tls.cert!), key: readFileSync(config.tls.key!) },
      handleHttp,
    )
  : createHttp(handleHttp);

// ── Señalización WebSocket ─────────────────────────────────────────────────
interface Peer {
  id: string;
  socket: WebSocket;
  room: string;
  isAdmin: boolean;
  name: string;
}

interface Room {
  members: Peer[];
  requireApproval: boolean;
  pending?: Peer; // participante en sala de espera
}

const rooms = new Map<string, Room>();

function audit(event: string, data: Record<string, unknown>): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...data }));
}

const wss = new WebSocketServer({ server });

wss.on('connection', (socket) => {
  const peer: Peer = { id: randomUUID(), socket, room: '', isAdmin: false, name: '' };

  socket.on('message', (raw) => {
    let msg: {
      type: string;
      room?: string;
      token?: unknown;
      name?: string;
      requireApproval?: boolean;
    };
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.type === 'join' && msg.room) {
      if (!isAuthorized(msg.token)) {
        peer.socket.send(JSON.stringify({ type: 'unauthorized' }));
        audit('unauthorized', { room: msg.room, peer: peer.id });
        peer.socket.close();
        return;
      }
      peer.name = (msg.name ?? '').slice(0, 80);
      joinRoom(peer, msg.room, Boolean(msg.requireApproval));
      return;
    }

    if (msg.type === 'signal' || msg.type === 'screen') relay(peer, raw.toString());
    if (msg.type === 'kick') kick(peer);
    if (msg.type === 'admit') admit(peer);
    if (msg.type === 'reject') reject(peer);
  });

  socket.on('close', () => leaveRoom(peer));
});

function send(peer: Peer, msg: unknown): void {
  peer.socket.send(JSON.stringify(msg));
}

function admin(room: Room): Peer | undefined {
  return room.members.find((m) => m.isAdmin);
}

function joinRoom(peer: Peer, roomId: string, requireApproval: boolean): void {
  let room = rooms.get(roomId);

  // Primer participante: crea la sala, es admin y fija si requiere aprobación.
  if (!room) {
    room = { members: [peer], requireApproval };
    rooms.set(roomId, room);
    peer.room = roomId;
    peer.isAdmin = true;
    send(peer, { type: 'joined', peerId: peer.id, polite: true, admin: true });
    audit('join', { room: roomId, peer: peer.id, admin: true, requireApproval });
    return;
  }

  // Sala llena (ya hay 2 o hay uno en espera).
  if (room.members.length >= 2 || room.pending) {
    send(peer, { type: 'room-full' });
    audit('room-full', { room: roomId, peer: peer.id });
    return;
  }

  peer.room = roomId;

  // Sala de espera: el segundo queda pendiente hasta que el admin lo admita.
  if (room.requireApproval) {
    room.pending = peer;
    send(peer, { type: 'waiting' });
    const host = admin(room);
    if (host) send(host, { type: 'participant-waiting', name: peer.name });
    audit('waiting', { room: roomId, peer: peer.id, name: peer.name });
    return;
  }

  // Sin aprobación: conexión inmediata (comportamiento por defecto).
  admitToRoom(room, peer);
}

/** Mete al peer como miembro y dispara la negociación con el admin. */
function admitToRoom(room: Room, peer: Peer): void {
  const host = admin(room);
  room.members.push(peer);
  send(peer, {
    type: 'joined',
    peerId: peer.id,
    polite: false,
    admin: false,
    peerName: host?.name,
  });
  if (host) send(host, { type: 'peer-joined', peerId: peer.id, name: peer.name });
  audit('join', { room: peer.room, peer: peer.id, admin: false });
}

function admit(host: Peer): void {
  const room = rooms.get(host.room);
  if (!host.isAdmin || !room?.pending) return;
  const pending = room.pending;
  room.pending = undefined;
  admitToRoom(room, pending);
  audit('admit', { room: host.room, by: host.id, peer: pending.id });
}

function reject(host: Peer): void {
  const room = rooms.get(host.room);
  if (!host.isAdmin || !room?.pending) return;
  const pending = room.pending;
  room.pending = undefined;
  send(pending, { type: 'rejected' });
  pending.socket.close();
  audit('reject', { room: host.room, by: host.id, peer: pending.id });
}

function relay(from: Peer, rawJson: string): void {
  const room = rooms.get(from.room);
  for (const other of room?.members ?? []) {
    if (other.id !== from.id) other.socket.send(rawJson);
  }
}

function kick(host: Peer): void {
  if (!host.isAdmin) return;
  const room = rooms.get(host.room);
  for (const other of room?.members ?? []) {
    if (other.id !== host.id) {
      send(other, { type: 'kicked' });
      other.socket.close();
    }
  }
  audit('kick', { room: host.room, by: host.id });
}

function leaveRoom(peer: Peer): void {
  const room = rooms.get(peer.room);
  if (!room) return;

  // Si el que sale estaba en sala de espera, solo límpialo.
  if (room.pending?.id === peer.id) {
    room.pending = undefined;
    audit('leave-pending', { room: peer.room, peer: peer.id });
    return;
  }

  const remaining = room.members.filter((m) => m.id !== peer.id);
  for (const other of remaining) send(other, { type: 'peer-left', peerId: peer.id });

  // Si se va el admin y hay alguien esperando, recházalo (sala sin moderador).
  if (peer.isAdmin && room.pending) {
    send(room.pending, { type: 'rejected' });
    room.pending.socket.close();
    room.pending = undefined;
  }

  if (remaining.length) {
    room.members = remaining;
  } else if (!room.pending) {
    rooms.delete(peer.room);
  } else {
    room.members = remaining;
  }

  audit('leave', { room: peer.room, peer: peer.id });
}

server.listen(PORT, () => {
  const proto = useTls ? 'wss' : 'ws';
  console.log(`✅ Señalización opWebRTC en ${proto}://localhost:${PORT}`);
  console.log(`   auth: ${config.auth.enabled ? 'ACTIVADA (token requerido)' : 'desactivada'}`);
  console.log(`   TURN: ${config.turn.secret && config.turn.urls.length ? 'efímero activo' : 'solo STUN'}`);
  console.log(`   ICE endpoint: ${useTls ? 'https' : 'http'}://localhost:${PORT}/ice`);
});

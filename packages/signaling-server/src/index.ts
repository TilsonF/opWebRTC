import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer as createHttp, type IncomingMessage, type ServerResponse } from 'node:http';
import { createServer as createHttps } from 'node:https';
import { WebSocketServer, type WebSocket } from 'ws';

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

const PORT = Number(process.env.PORT ?? 8080);

// ── Auth de sala (opcional) ────────────────────────────────────────────────
const AUTH_ENABLED = (process.env.AUTH_ENABLED ?? 'false').toLowerCase() === 'true';
const AUTH_TOKEN = process.env.AUTH_TOKEN ?? '';

function isAuthorized(token: unknown): boolean {
  if (!AUTH_ENABLED) return true;
  return typeof token === 'string' && token.length > 0 && token === AUTH_TOKEN;
}

// ── TURN efímero (coturn REST: user = expiry:id, pass = HMAC-SHA1) ──────────
const TURN_SECRET = process.env.TURN_SECRET ?? '';
const TURN_URLS = (process.env.TURN_URLS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const TURN_TTL = Number(process.env.TURN_TTL ?? 3600);
const STUN_URL = process.env.STUN_URL ?? 'stun:stun.l.google.com:19302';

function iceServers(): RTCIceServerLike[] {
  const servers: RTCIceServerLike[] = [{ urls: STUN_URL }];
  if (TURN_SECRET && TURN_URLS.length) {
    const expiry = Math.floor(Date.now() / 1000) + TURN_TTL;
    const username = `${expiry}:opwebrtc`;
    const credential = createHmac('sha1', TURN_SECRET).update(username).digest('base64');
    servers.push({ urls: TURN_URLS, username, credential });
  }
  return servers;
}

interface RTCIceServerLike {
  urls: string | string[];
  username?: string;
  credential?: string;
}

// ── TLS opcional (WSS) ─────────────────────────────────────────────────────
const TLS_CERT = process.env.TLS_CERT;
const TLS_KEY = process.env.TLS_KEY;
const useTls = Boolean(TLS_CERT && TLS_KEY);

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
  ? createHttps({ cert: readFileSync(TLS_CERT!), key: readFileSync(TLS_KEY!) }, handleHttp)
  : createHttp(handleHttp);

// ── Señalización WebSocket ─────────────────────────────────────────────────
interface Peer {
  id: string;
  socket: WebSocket;
  room: string;
  isAdmin: boolean;
}

const rooms = new Map<string, Peer[]>();

function audit(event: string, data: Record<string, unknown>): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...data }));
}

const wss = new WebSocketServer({ server });

wss.on('connection', (socket) => {
  const peer: Peer = { id: randomUUID(), socket, room: '', isAdmin: false };

  socket.on('message', (raw) => {
    let msg: { type: string; room?: string; token?: unknown };
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
      joinRoom(peer, msg.room);
      return;
    }

    if (msg.type === 'signal' || msg.type === 'screen') relay(peer, raw.toString());
    if (msg.type === 'kick') kick(peer);
  });

  socket.on('close', () => leaveRoom(peer));
});

function joinRoom(peer: Peer, room: string): void {
  const members = rooms.get(room) ?? [];
  if (members.length >= 2) {
    peer.socket.send(JSON.stringify({ type: 'room-full' }));
    audit('room-full', { room, peer: peer.id });
    return;
  }

  peer.room = room;
  // El primero en entrar es polite (perfect negotiation) y admin (moderador).
  const isFirst = members.length === 0;
  peer.isAdmin = isFirst;
  members.push(peer);
  rooms.set(room, members);

  peer.socket.send(
    JSON.stringify({ type: 'joined', peerId: peer.id, polite: isFirst, admin: isFirst }),
  );

  for (const other of members) {
    if (other.id !== peer.id) {
      other.socket.send(JSON.stringify({ type: 'peer-joined', peerId: peer.id }));
    }
  }
  audit('join', { room, peer: peer.id, admin: isFirst, size: members.length });
}

function relay(from: Peer, rawJson: string): void {
  const members = rooms.get(from.room) ?? [];
  for (const other of members) {
    if (other.id !== from.id) other.socket.send(rawJson);
  }
}

function kick(admin: Peer): void {
  if (!admin.isAdmin) return;
  const members = rooms.get(admin.room) ?? [];
  for (const other of members) {
    if (other.id !== admin.id) {
      other.socket.send(JSON.stringify({ type: 'kicked' }));
      other.socket.close();
    }
  }
  audit('kick', { room: admin.room, by: admin.id });
}

function leaveRoom(peer: Peer): void {
  const members = rooms.get(peer.room);
  if (!members) return;
  const remaining = members.filter((m) => m.id !== peer.id);

  for (const other of remaining) {
    other.socket.send(JSON.stringify({ type: 'peer-left', peerId: peer.id }));
  }

  if (remaining.length) rooms.set(peer.room, remaining);
  else rooms.delete(peer.room);

  audit('leave', { room: peer.room, peer: peer.id });
}

server.listen(PORT, () => {
  const proto = useTls ? 'wss' : 'ws';
  console.log(`✅ Señalización opWebRTC en ${proto}://localhost:${PORT}`);
  console.log(`   auth: ${AUTH_ENABLED ? 'ACTIVADA (token requerido)' : 'desactivada'}`);
  console.log(`   TURN: ${TURN_SECRET && TURN_URLS.length ? 'efímero activo' : 'solo STUN'}`);
  console.log(`   ICE endpoint: ${useTls ? 'https' : 'http'}://localhost:${PORT}/ice`);
});

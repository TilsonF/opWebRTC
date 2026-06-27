import { randomUUID } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';

/**
 * Servidor de señalización para videollamadas 1‑a‑1.
 *
 * Responsabilidades (NO toca la media):
 *  - Agrupa peers en salas (máx. 2).
 *  - Asigna el rol "polite" del patrón perfect negotiation.
 *  - Reenvía mensajes `signal` (SDP/ICE) al otro peer de la sala.
 *  - Registra auditoría de metadatos.
 *
 * Pendiente para producción: autenticación por token, WSS (TLS) y
 * emisión de credenciales TURN efímeras.
 */

const PORT = Number(process.env.PORT ?? 8080);

interface Peer {
  id: string;
  socket: WebSocket;
  room: string;
}

/** room -> peers */
const rooms = new Map<string, Peer[]>();

function audit(event: string, data: Record<string, unknown>): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...data }));
}

const wss = new WebSocketServer({ port: PORT });

wss.on('connection', (socket) => {
  const peer: Peer = { id: randomUUID(), socket, room: '' };

  socket.on('message', (raw) => {
    let msg: { type: string; room?: string; data?: unknown };
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.type === 'join' && msg.room) {
      joinRoom(peer, msg.room);
      return;
    }

    if (msg.type === 'signal') {
      relay(peer, raw.toString());
    }
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
  members.push(peer);
  rooms.set(room, members);

  // El primero en entrar es "polite": cederá ante una colisión de ofertas.
  const polite = members.length === 1;
  peer.socket.send(JSON.stringify({ type: 'joined', peerId: peer.id, polite }));

  // Avisar al otro miembro que ya hay con quién negociar.
  for (const other of members) {
    if (other.id !== peer.id) {
      other.socket.send(JSON.stringify({ type: 'peer-joined', peerId: peer.id }));
    }
  }
  audit('join', { room, peer: peer.id, polite, size: members.length });
}

function relay(from: Peer, rawJson: string): void {
  const members = rooms.get(from.room) ?? [];
  for (const other of members) {
    if (other.id !== from.id) other.socket.send(rawJson);
  }
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

console.log(`✅ Señalización opWebRTC escuchando en ws://localhost:${PORT}`);

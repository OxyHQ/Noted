import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import http from 'http';
import { getRedisClient, getRedisSubClient } from './lib/redis.js';
import { oxyClient } from './middleware/auth.js';
import { log } from './lib/logger.js';
import type { NoteDTO, LabelDTO } from './lib/serializers.js';

const ALLOWED_ORIGINS = [
  process.env.WEB_URL || 'http://localhost:3000',
  'https://noted.oxy.so',
  'https://console.noted.oxy.so',
  'https://gateway.noted.oxy.so',
];

let io: Server | null = null;

export function initSocket(server: http.Server) {
  io = new Server(server, {
    cors: {
      origin: ALLOWED_ORIGINS,
      methods: ['GET', 'POST'],
      credentials: true,
    },
    transports: ['websocket', 'polling'],
  });

  // Attach Redis adapter for horizontal scaling
  const pubClient = getRedisClient();
  const subClient = getRedisSubClient();
  if (pubClient && subClient) {
    Promise.all([pubClient.connect(), subClient.connect()])
      .then(() => {
        io!.adapter(createAdapter(pubClient, subClient));
        log.general.info('Socket.IO Redis adapter attached');
      })
      .catch((err) => {
        log.general.warn({ err }, 'Socket.IO Redis adapter failed — using in-memory');
      });
  }

  // Authenticate EVERY connection: validates the Oxy session from
  // `handshake.auth.token` and sets `socket.data.userId`. Unauthenticated
  // connections are rejected. This is the ONLY source of the room identity —
  // clients can no longer name the room they join.
  io.use(oxyClient.authSocket());

  io.on('connection', (socket) => {
    const userId = (socket.data as { userId?: string }).userId;
    if (!userId) {
      // authSocket() guarantees userId, but fail closed if it is ever missing.
      socket.disconnect(true);
      return;
    }
    // Auto-join the user's own room using the SERVER-VERIFIED id only.
    socket.join(`user:${userId}`);

    // Parameterless opt-in events kept for client compatibility — they are
    // no-ops because the verified room is already joined above. They NEVER
    // join a client-supplied id.
    socket.on('subscribe-notes', () => {});
    socket.on('subscribe-notifications', () => {});
  });

  return io;
}

export function getIO(): Server | null {
  return io;
}

// ── Notes real-time sync ───────────────────────────────────────────
// Every mutation is broadcast to the owning user's room so all of their open
// sessions/devices stay in sync.

export function emitNoteCreated(userId: string, note: NoteDTO): void {
  io?.to(`user:${userId}`).emit('note:created', { note });
}

export function emitNoteUpdated(userId: string, note: NoteDTO): void {
  io?.to(`user:${userId}`).emit('note:updated', { note });
}

export function emitNoteDeleted(userId: string, id: string): void {
  io?.to(`user:${userId}`).emit('note:deleted', { id });
}

export function emitLabelCreated(userId: string, label: LabelDTO): void {
  io?.to(`user:${userId}`).emit('label:created', { label });
}

export function emitLabelUpdated(userId: string, label: LabelDTO): void {
  io?.to(`user:${userId}`).emit('label:updated', { label });
}

export function emitLabelDeleted(userId: string, id: string): void {
  io?.to(`user:${userId}`).emit('label:deleted', { id });
}

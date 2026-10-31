// Worker entry. Static files (the built game in dist/) are served by the
// assets binding; only /api/* and /ws/* reach this code (see wrangler.jsonc).
export { GameRoom } from './room.js';
import { PROTOCOL_VERSION, PUBLIC_ROOMS } from '../src/net/protocol.js';

const ROOM_ID = /^[a-z0-9-]{1,32}$/;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/api/health') return json({ ok: true, protocol: PROTOCOL_VERSION });

    // How many people are in each quick play room, for the menu.
    if (path === '/api/rooms' && request.method === 'GET') {
      const counts = {};
      await Promise.all(Object.values(PUBLIC_ROOMS).map(async (room) => {
        const stub = env.ROOMS.get(env.ROOMS.idFromName(room));
        counts[room] = await stub.humanCount().catch(() => 0);
      }));
      return json({ rooms: counts });
    }

    if (path === '/api/rooms' && request.method === 'POST') {
      return json({ room: crypto.randomUUID().slice(0, 8) });
    }

    const ws = path.match(/^\/ws\/([^/]+)$/);
    if (ws) {
      const room = decodeURIComponent(ws[1]).toLowerCase();
      if (!ROOM_ID.test(room)) return json({ error: 'bad room id' }, 400);
      if (request.headers.get('Upgrade') !== 'websocket') return json({ error: 'expected websocket' }, 426);
      const stub = env.ROOMS.get(env.ROOMS.idFromName(room));
      return stub.fetch(request);
    }

    if (path.startsWith('/api/') || path.startsWith('/ws/')) return json({ error: 'not found' }, 404);
    return env.ASSETS.fetch(request);
  },
};

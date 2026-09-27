'use strict';

const http = require('node:http');
const Redis = require('ioredis');

// ── Config from environment ──────────────────────────────────────────
const PORT = parseInt(process.env.PORT, 10) || 3001;
const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = parseInt(process.env.REDIS_PORT, 10) || 6379;

const redisOpts = {
  host: REDIS_HOST,
  port: REDIS_PORT,
  retryStrategy(times) {
    return Math.min(times * 500, 5000);
  },
  maxRetriesPerRequest: null,
};

// Subscriber — dedicated connection (can't run normal commands while subscribed)
const subscriber = new Redis(redisOpts);
// Health-check connection — for ping
const redis = new Redis(redisOpts);

subscriber.on('error', (err) => console.error('Subscriber error:', err.message));
redis.on('error',      (err) => console.error('Redis error:', err.message));

// ── Stats (stored in Redis so they survive restarts and are shared by replicas)
const KEY_COUNT = 'stats:notes_created';
const KEY_LAST  = 'stats:last_note_at';
const startedAt = new Date().toISOString();   // per-process, informational only

// ── Pub/Sub ──────────────────────────────────────────────────────────
subscriber.subscribe('notes:created', (err) => {
  if (err) {
    console.error('Subscribe failed:', err.message);
  } else {
    console.log('Subscribed to notes:created');
  }
});

subscriber.on('message', async (channel) => {
  if (channel !== 'notes:created') return;
  try {
    // Subscriber connection can't run commands, so use the regular one
    const total = await redis.incr(KEY_COUNT);
    await redis.set(KEY_LAST, new Date().toISOString());
    console.log(`Note created — total: ${total}`);
  } catch (err) {
    console.error('Failed to update stats:', err.message);
  }
});

// ── HTTP server (Node built-in — no Express needed) ──────────────────
function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  if (req.method !== 'GET') {
    return sendJson(res, 405, { error: 'Method not allowed' });
  }

  switch (req.url) {
    case '/health':
      return sendJson(res, 200, { status: 'ok' });

    case '/ready':
      try {
        await redis.ping();
        return sendJson(res, 200, { status: 'ready' });
      } catch {
        return sendJson(res, 503, { status: 'not ready' });
      }

    case '/stats':
      try {
        const [count, last] = await redis.mget(KEY_COUNT, KEY_LAST);
        return sendJson(res, 200, {
          notesCreated: parseInt(count, 10) || 0,
          lastNoteAt: last,
          startedAt,
        });
      } catch {
        return sendJson(res, 503, { error: 'stats unavailable' });
      }

    default:
      return sendJson(res, 404, { error: 'Not found' });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Worker listening on port ${PORT}`);
});

// ── Graceful shutdown ────────────────────────────────────────────────
function shutdown(signal) {
  console.log(`${signal} received — shutting down`);

  server.close(() => {
    try {
      subscriber.disconnect();
      redis.disconnect();
    } catch { /* best-effort */ }
    console.log('Connections closed');
    process.exit(0);
  });

  setTimeout(() => {
    console.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

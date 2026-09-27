//test
'use strict';

const express = require('express');
const { Pool } = require('pg');
const Redis = require('ioredis');

// ── Config from environment ──────────────────────────────────────────
const PORT = parseInt(process.env.PORT, 10) || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

// ── PostgreSQL ───────────────────────────────────────────────────────
const pool = new Pool({
  host:     process.env.POSTGRES_HOST     || 'localhost',
  port:     parseInt(process.env.POSTGRES_PORT, 10) || 5432,
  database: process.env.POSTGRES_DB       || 'notes',
  user:     process.env.POSTGRES_USER     || 'notes',
  password: process.env.POSTGRES_PASSWORD || 'notes',
});

// ── Redis (single connection for cache + publish) ────────────────────
const redisOpts = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT, 10) || 6379,
  retryStrategy(times) {
    return Math.min(times * 500, 5000);
  },
  maxRetriesPerRequest: null,   // let ioredis retry indefinitely on startup
};

const redis = new Redis(redisOpts);

redis.on('connect', () => console.log('Redis connected'));
redis.on('error',   (err) => console.error('Redis error:', err.message));

// ── Cache settings ───────────────────────────────────────────────────
const CACHE_KEY = 'notes:list';
const CACHE_TTL = 60;           // seconds

// ── Express app ──────────────────────────────────────────────────────
const app = express();
app.use(express.json());

// ── Health / Readiness ───────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.get('/ready', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    await redis.ping();
    res.json({ status: 'ready' });
  } catch (err) {
    res.status(503).json({ status: 'not ready', error: err.message });
  }
});

// ── CRUD ─────────────────────────────────────────────────────────────
// GET /api/notes — list all notes (cached)
app.get('/api/notes', async (_req, res) => {
  try {
    const cached = await redis.get(CACHE_KEY);
    if (cached) {
      return res.json(JSON.parse(cached));
    }

    const { rows } = await pool.query(
      'SELECT * FROM notes ORDER BY created_at DESC'
    );
    await redis.set(CACHE_KEY, JSON.stringify(rows), 'EX', CACHE_TTL);
    res.json(rows);
  } catch (err) {
    console.error('GET /api/notes error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/notes — create a note
app.post('/api/notes', async (req, res) => {
  const { title, content } = req.body;
  if (!title || !content) {
    return res.status(400).json({ error: 'title and content are required' });
  }

  try {
    const { rows } = await pool.query(
      'INSERT INTO notes (title, content) VALUES ($1, $2) RETURNING *',
      [title, content]
    );
    const note = rows[0];

    // Invalidate cache and publish event
    await redis.del(CACHE_KEY);
    await redis.publish('notes:created', JSON.stringify(note));

    res.status(201).json(note);
  } catch (err) {
    console.error('POST /api/notes error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/notes/:id
app.delete('/api/notes/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'DELETE FROM notes WHERE id = $1 RETURNING *',
      [req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Note not found' });
    }

    await redis.del(CACHE_KEY);
    res.json(rows[0]);
  } catch (err) {
    console.error('DELETE /api/notes error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Startup with dependency retry ────────────────────────────────────
async function waitForPostgres() {
  for (let attempt = 1; attempt <= 30; attempt++) {
    try {
      await pool.query('SELECT 1');
      console.log('PostgreSQL is ready');
      return;
    } catch (err) {
      console.log(`Waiting for PostgreSQL (${attempt}/30): ${err.message}`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  console.error('Could not connect to PostgreSQL after 30 attempts');
  process.exit(1);
}

const server = app.listen(PORT, '0.0.0.0', async () => {
  console.log(`API listening on port ${PORT} (${NODE_ENV})`);
  await waitForPostgres();
});

// ── Graceful shutdown ────────────────────────────────────────────────
function shutdown(signal) {
  console.log(`${signal} received — shutting down`);

  server.close(async () => {
    console.log('HTTP server closed');
    try {
      await pool.end();
      redis.disconnect();
    } catch { /* best-effort */ }
    console.log('Connections closed');
    process.exit(0);
  });

  // Force exit after 10 s
  setTimeout(() => {
    console.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

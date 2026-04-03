const fs = require("fs/promises");
const path = require("path");
let sharedPool;

async function readJsonFile(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function ensureJsonFile(filePath) {
  try {
    await fs.access(filePath);
  } catch (error) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, "[]\n", "utf8");
  }
}

function getDatabaseSsl(connectionString) {
  if (process.env.DATABASE_SSL === "false" || /sslmode=disable/i.test(connectionString || "")) return false;
  if (/localhost|127\.0\.0\.1/i.test(connectionString || "")) return false;
  return { rejectUnauthorized: false };
}

async function getPostgresPool() {
  if (!process.env.DATABASE_URL) return null;
  if (sharedPool) return sharedPool;
  let Pool;
  try {
    ({ Pool } = require("pg"));
  } catch (error) {
    error.message = `PostgreSQL support requires the 'pg' package. ${error.message}`;
    throw error;
  }
  sharedPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: getDatabaseSsl(process.env.DATABASE_URL)
  });
  return sharedPool;
}

function createJsonStore(files) {
  const writeQueue = new Map();

  return {
    async init() {
      await Promise.all(Object.values(files).map(ensureJsonFile));
    },
    async readCollection(name) {
      return readJsonFile(files[name]);
    },
    async writeCollection(name, value) {
      const previous = writeQueue.get(name) || Promise.resolve();
      const next = previous.then(() => fs.writeFile(files[name], `${JSON.stringify(value, null, 2)}\n`, "utf8"));
      writeQueue.set(name, next.catch(() => undefined));
      await next;
    }
  };
}

function createPostgresStore(files) {
  return {
    async init() {
      const db = await getPostgresPool();
      await db.query(`
        CREATE TABLE IF NOT EXISTS app_collections (
          name TEXT PRIMARY KEY,
          payload JSONB NOT NULL DEFAULT '[]'::jsonb,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);

      for (const [name, filePath] of Object.entries(files)) {
        const existing = await db.query("SELECT 1 FROM app_collections WHERE name = $1", [name]);
        if (existing.rowCount) continue;
        const seed = await readJsonFile(filePath);
        await db.query(
          "INSERT INTO app_collections (name, payload, updated_at) VALUES ($1, $2::jsonb, NOW())",
          [name, JSON.stringify(seed)]
        );
      }
    },
    async readCollection(name) {
      const db = await getPostgresPool();
      const result = await db.query("SELECT payload FROM app_collections WHERE name = $1", [name]);
      if (!result.rowCount) {
        await db.query(
          "INSERT INTO app_collections (name, payload, updated_at) VALUES ($1, '[]'::jsonb, NOW()) ON CONFLICT (name) DO NOTHING",
          [name]
        );
        return [];
      }
      return Array.isArray(result.rows[0].payload) ? result.rows[0].payload : [];
    },
    async writeCollection(name, value) {
      const db = await getPostgresPool();
      await db.query(
        `INSERT INTO app_collections (name, payload, updated_at)
         VALUES ($1, $2::jsonb, NOW())
         ON CONFLICT (name)
         DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()`,
        [name, JSON.stringify(value)]
      );
    }
  };
}

function createStore(files) {
  return process.env.DATABASE_URL ? createPostgresStore(files) : createJsonStore(files);
}

function createSessionStore(session, options = {}) {
  if (!process.env.DATABASE_URL) return null;

  const ttlMs = Number(options.ttlMs) || 1000 * 60 * 60 * 12;

  class PostgresSessionStore extends session.Store {
    async init() {
      const db = await getPostgresPool();
      await db.query(`
        CREATE TABLE IF NOT EXISTS app_sessions (
          sid TEXT PRIMARY KEY,
          sess JSONB NOT NULL,
          expire TIMESTAMPTZ NOT NULL
        )
      `);
      await db.query("CREATE INDEX IF NOT EXISTS app_sessions_expire_idx ON app_sessions (expire)");
      await db.query("DELETE FROM app_sessions WHERE expire < NOW()");
    }

    get(sid, callback) {
      (async () => {
        const db = await getPostgresPool();
        const result = await db.query(
          "SELECT sess FROM app_sessions WHERE sid = $1 AND expire >= NOW()",
          [sid]
        );
        callback(null, result.rowCount ? result.rows[0].sess : null);
      })().catch((error) => callback(error));
    }

    set(sid, sess, callback) {
      (async () => {
        const db = await getPostgresPool();
        const expire = new Date(sess?.cookie?.expires || Date.now() + ttlMs);
        await db.query(
          `INSERT INTO app_sessions (sid, sess, expire)
           VALUES ($1, $2::jsonb, $3)
           ON CONFLICT (sid)
           DO UPDATE SET sess = EXCLUDED.sess, expire = EXCLUDED.expire`,
          [sid, JSON.stringify(sess), expire]
        );
        callback?.(null);
      })().catch((error) => callback?.(error));
    }

    destroy(sid, callback) {
      (async () => {
        const db = await getPostgresPool();
        await db.query("DELETE FROM app_sessions WHERE sid = $1", [sid]);
        callback?.(null);
      })().catch((error) => callback?.(error));
    }

    touch(sid, sess, callback) {
      (async () => {
        const db = await getPostgresPool();
        const expire = new Date(sess?.cookie?.expires || Date.now() + ttlMs);
        await db.query(
          "UPDATE app_sessions SET expire = $2, sess = $3::jsonb WHERE sid = $1",
          [sid, expire, JSON.stringify(sess)]
        );
        callback?.(null);
      })().catch((error) => callback?.(error));
    }
  }

  return new PostgresSessionStore();
}

module.exports = { createStore, createSessionStore };

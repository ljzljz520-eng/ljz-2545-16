const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const pool = require('./pool');
const { routes: seedRouteData } = require('./seed');

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = await new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (err, key) => (err ? reject(err) : resolve(key)));
  });
  return `scrypt$${salt}$${derived.toString('hex')}`;
}

async function ensureAdmin(client) {
  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD || (process.env.NODE_ENV === 'production' ? '' : 'change-me');
  if (!password) throw new Error('ADMIN_PASSWORD is required for first migration');
  const existing = await client.query('SELECT id FROM users WHERE username=$1', [username]);
  if (existing.rowCount) return;
  await client.query(
    'INSERT INTO users(username,password_hash) VALUES($1,$2)',
    [username, await hashPassword(password)]
  );
}

async function seedRoutes(client) {
  const count = await client.query('SELECT count(*)::int AS n FROM routes');
  if (count.rows[0].n > 0) return;

  for (const route of seedRouteData) {
    const routeResult = await client.query(
      `INSERT INTO routes(title, short_title, status, updated_at)
       VALUES ($1,$2,'published',$3) RETURNING id`,
      [route.title, route.short_title, new Date()]
    );
    const routeId = routeResult.rows[0].id;
    const versionResult = await client.query(
      `INSERT INTO route_versions(route_id, version_code, revision, status, content, editor_private, change_note, published_at)
       VALUES ($1,$2,1,'published',$3,$4,'初始发布版本',$5) RETURNING id`,
      [
        routeId,
        `v1.0-${new Date(route.sources[0].info_date).toISOString().slice(0, 10)}`,
        JSON.stringify(route),
        JSON.stringify({ editor: route.sources[0].editor, internal_note: route.sources[0].internal_note }),
        new Date(route.sources[0].published_at)
      ]
    );
    await client.query('UPDATE routes SET current_version_id=$1 WHERE id=$2', [versionResult.rows[0].id, routeId]);
  }
}

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    await client.query(sql);
    await ensureAdmin(client);
    await seedRoutes(client);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  migrate()
    .then(() => {
      console.log('Database migration completed.');
      return pool.end();
    })
    .catch(async (err) => {
      console.error(err);
      await pool.end();
      process.exit(1);
    });
}

module.exports = migrate;

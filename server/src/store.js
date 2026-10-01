const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');
const { routeVersions: seedRoutes } = require('./routes-data');

function uuid() {
  return crypto.randomUUID();
}

function parseJob(input) {
  if (!input) return null;
  // PostgreSQL rows are snake_case; in-memory jobs are camelCase.
  const row = Object.fromEntries(Object.entries(input).map(([key, value]) => {
    const camel = key.replace(/_([a-z])/g, (_, ch) => ch.toUpperCase());
    return [camel, value];
  }));
  return {
    id: row.id,
    ownerKey: row.ownerKey,
    routeVersionId: row.routeVersionId,
    status: row.status,
    walkingMode: row.walkingMode,
    fields: row.fields,
    summaryRule: row.summaryRule,
    layoutParams: row.layoutParams,
    frozenContent: row.frozenContent,
    estimate: row.estimate,
    sourceRefs: row.sourceRefs,
    filePath: row.filePath,
    error: row.error,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt
  };
}

function parseRoute(row) {
  if (!row) return null;
  return {
    id: row.id,
    routeId: row.route_id,
    version: Number(row.version),
    shortTitle: row.short_title,
    title: row.title,
    status: row.status,
    publishedAt: row.published_at,
    infoDate: typeof row.info_date === 'string' ? row.info_date : row.info_date?.toISOString?.()?.slice(0, 10),
    data: row.data
  };
}

class MemoryStore {
  constructor() {
    this.routes = new Map();
    this.jobs = new Map();
    this.tokens = new Map();
    for (const route of seedRoutes) {
      this.routes.set(route.id, {
        id: route.id,
        routeId: route.routeId,
        version: route.version,
        shortTitle: route.shortTitle,
        title: route.title,
        status: route.status,
        publishedAt: route.publishedAt,
        infoDate: route.infoDate,
        data: route
      });
    }
  }

  async init() {
    for (const job of this.jobs.values()) {
      if (job.status === 'rendering') {
        job.status = 'queued';
        job.startedAt = null;
        job.updatedAt = new Date().toISOString();
      }
    }
  }

  listRoutes() {
    return Array.from(this.routes.values()).sort((a, b) => b.version - a.version);
  }

  getRoute(id) {
    return this.routes.get(id) || null;
  }

  async withdrawRoute(id, reason) {
    const route = this.routes.get(id);
    if (!route) return null;
    route.status = 'withdrawn';
    route.data = { ...route.data, status: 'withdrawn', withdrawnAt: new Date().toISOString(), withdrawnReason: reason };
    return parseRoute(route);
  }

  async createJob(data) {
    const now = new Date().toISOString();
    const job = {
      id: data.id || uuid(),
      ownerKey: data.ownerKey,
      routeVersionId: data.routeVersionId,
      status: 'queued',
      walkingMode: data.walkingMode,
      fields: data.fields,
      summaryRule: data.summaryRule,
      layoutParams: data.layoutParams,
      frozenContent: data.frozenContent,
      estimate: data.estimate,
      sourceRefs: data.sourceRefs,
      filePath: null,
      error: null,
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      finishedAt: null
    };
    this.jobs.set(job.id, job);
    return parseJob(job);
  }

  listJobs(ownerKey) {
    return Array.from(this.jobs.values())
      .filter(j => j.ownerKey === ownerKey)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .map(parseJob);
  }

  getJob(id, ownerKey) {
    const job = this.jobs.get(id);
    if (!job || job.ownerKey !== ownerKey) return null;
    return parseJob(job);
  }

  async claimNextQueued() {
    const queued = Array.from(this.jobs.values())
      .filter(j => j.status === 'queued')
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))[0];
    if (!queued) return null;
    queued.status = 'rendering';
    queued.startedAt = new Date().toISOString();
    queued.updatedAt = queued.startedAt;
    return parseJob(queued);
  }

  async completeJob(id, filePath) {
    const job = this.jobs.get(id);
    if (!job) return null;
    job.status = 'completed';
    job.filePath = filePath;
    job.error = null;
    job.finishedAt = new Date().toISOString();
    job.updatedAt = job.finishedAt;
    return parseJob(job);
  }

  async failJob(id, error) {
    const job = this.jobs.get(id);
    if (!job) return null;
    job.status = 'failed';
    job.error = String(error?.message || error).slice(0, 800);
    job.finishedAt = new Date().toISOString();
    job.updatedAt = job.finishedAt;
    return parseJob(job);
  }

  async createToken(data) {
    const token = {
      id: data.id || uuid(),
      jobId: data.jobId,
      ownerKey: data.ownerKey,
      signature: data.signature,
      expiresAt: data.expiresAt,
      usedAt: null,
      createdAt: new Date().toISOString()
    };
    this.tokens.set(token.id, token);
    return { id: token.id };
  }

  async consumeToken(tokenId, signature) {
    const token = this.tokens.get(tokenId);
    if (!token || token.signature !== signature || token.usedAt || new Date(token.expiresAt) <= new Date()) return null;
    token.usedAt = new Date().toISOString();
    return this.getJob(token.jobId, token.ownerKey);
  }
}

class PgStore {
  constructor(connectionString) {
    this.pool = new Pool({ connectionString, max: 5 });
  }

  async init() {
    const sql = await fs.readFile(path.join(__dirname, '..', 'sql', 'schema.sql'), 'utf8');
    await this.pool.query(sql);
    for (const route of seedRoutes) {
      await this.pool.query(`
        INSERT INTO route_versions (id, route_id, version, short_title, title, status, published_at, info_date, data)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
        ON CONFLICT (id) DO NOTHING`,
        [route.id, route.routeId, route.version, route.shortTitle, route.title, route.status, route.publishedAt, route.infoDate, JSON.stringify(route)]
      );
    }
    await this.pool.query(`UPDATE card_jobs SET status='queued', started_at=NULL, updated_at=now() WHERE status='rendering'`);
  }

  async listRoutes() {
    const result = await this.pool.query('SELECT * FROM route_versions ORDER BY version DESC');
    return result.rows.map(parseRoute);
  }

  async getRoute(id) {
    const result = await this.pool.query('SELECT * FROM route_versions WHERE id=$1', [id]);
    return parseRoute(result.rows[0]);
  }

  async withdrawRoute(id, reason) {
    const existing = await this.getRoute(id);
    if (!existing) return null;
    const data = { ...existing.data, status: 'withdrawn', withdrawnAt: new Date().toISOString(), withdrawnReason: reason };
    const result = await this.pool.query(`
      UPDATE route_versions
      SET status='withdrawn', data=$2::jsonb, updated_at=now()
      WHERE id=$1 RETURNING *`, [id, data]);
    return parseRoute(result.rows[0]);
  }

  async createJob(data) {
    const result = await this.pool.query(`
      INSERT INTO card_jobs (id, owner_key, route_version_id, status, walking_mode, fields, summary_rule, layout_params, frozen_content, estimate, source_refs)
      VALUES ($1,$2,$3,'queued',$4,$5::jsonb,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb)
      RETURNING *`,
      [
        data.id, data.ownerKey, data.routeVersionId, data.walkingMode,
        JSON.stringify(data.fields), data.summaryRule, JSON.stringify(data.layoutParams),
        JSON.stringify(data.frozenContent), JSON.stringify(data.estimate), JSON.stringify(data.sourceRefs)
      ]);
    return parseJob(result.rows[0]);
  }

  async listJobs(ownerKey) {
    const result = await this.pool.query('SELECT * FROM card_jobs WHERE owner_key=$1 ORDER BY created_at DESC', [ownerKey]);
    return result.rows.map(parseJob);
  }

  async getJob(id, ownerKey) {
    const result = await this.pool.query('SELECT * FROM card_jobs WHERE id=$1 AND owner_key=$2', [id, ownerKey]);
    return parseJob(result.rows[0]);
  }

  async claimNextQueued() {
    const result = await this.pool.query(`
      UPDATE card_jobs
      SET status='rendering', started_at=now(), updated_at=now()
      WHERE id = (
        SELECT id FROM card_jobs
        WHERE status='queued'
        ORDER BY created_at
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      ) RETURNING *`);
    return parseJob(result.rows[0]);
  }

  async completeJob(id, filePath) {
    const result = await this.pool.query(`
      UPDATE card_jobs SET status='completed', file_path=$2, error=NULL, finished_at=now(), updated_at=now()
      WHERE id=$1 RETURNING *`, [id, filePath]);
    return parseJob(result.rows[0]);
  }

  async failJob(id, error) {
    const result = await this.pool.query(`
      UPDATE card_jobs SET status='failed', error=$2, finished_at=now(), updated_at=now()
      WHERE id=$1 RETURNING *`, [id, String(error?.message || error).slice(0, 800)]);
    return parseJob(result.rows[0]);
  }

  async createToken(data) {
    await this.pool.query(`
      INSERT INTO download_tokens (id, job_id, owner_key, signature, expires_at)
      VALUES ($1,$2,$3,$4,$5)`,
      [data.id, data.jobId, data.ownerKey, data.signature, data.expiresAt]);
    return { id: data.id };
  }

  async consumeToken(tokenId, signature) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const tokenResult = await client.query(`
        UPDATE download_tokens
        SET used_at=now()
        WHERE id=$1 AND signature=$2 AND used_at IS NULL AND expires_at > now()
        RETURNING job_id, owner_key`, [tokenId, signature]);
      if (!tokenResult.rows[0]) {
        await client.query('ROLLBACK');
        return null;
      }
      const jobResult = await client.query('SELECT * FROM card_jobs WHERE id=$1 AND owner_key=$2',
        [tokenResult.rows[0].job_id, tokenResult.rows[0].owner_key]);
      await client.query('COMMIT');
      return parseJob(jobResult.rows[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}

async function createStore() {
  const databaseUrl = process.env.DATABASE_URL;
  const store = databaseUrl ? new PgStore(databaseUrl) : new MemoryStore();
  await store.init();
  return store;
}

module.exports = { createStore, MemoryStore, PgStore, uuid };

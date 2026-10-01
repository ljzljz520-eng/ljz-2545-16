-- 路线打印卡 PostgreSQL 结构
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS route_versions (
  id TEXT PRIMARY KEY,
  route_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  short_title TEXT NOT NULL CHECK (char_length(short_title) <= 16),
  title TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('published', 'withdrawn')),
  published_at TIMESTAMPTZ NOT NULL,
  info_date DATE NOT NULL,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (route_id, version)
);

CREATE TABLE IF NOT EXISTS card_jobs (
  id UUID PRIMARY KEY,
  owner_key TEXT NOT NULL,
  route_version_id TEXT NOT NULL REFERENCES route_versions(id),
  status TEXT NOT NULL CHECK (status IN ('queued', 'rendering', 'completed', 'failed')),
  walking_mode TEXT NOT NULL,
  "fields" JSONB NOT NULL,
  summary_rule TEXT NOT NULL,
  layout_params JSONB NOT NULL,
  frozen_content JSONB NOT NULL,
  estimate JSONB NOT NULL,
  source_refs JSONB NOT NULL,
  file_path TEXT,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_card_jobs_owner_created ON card_jobs(owner_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_card_jobs_status_created ON card_jobs(status, created_at);

CREATE TABLE IF NOT EXISTS download_tokens (
  id UUID PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES card_jobs(id) ON DELETE CASCADE,
  owner_key TEXT NOT NULL,
  signature TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_download_tokens_job ON download_tokens(job_id);

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS routes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  short_title TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'withdrawn')),
  current_version_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS route_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id UUID NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  version_code TEXT NOT NULL,
  revision INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'withdrawn')),
  content JSONB NOT NULL,
  editor_private JSONB,
  change_note TEXT,
  published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  withdrawn_at TIMESTAMPTZ,
  UNIQUE (route_id, version_code)
);

ALTER TABLE routes
  DROP CONSTRAINT IF EXISTS routes_current_version_fk;
ALTER TABLE routes
  ADD CONSTRAINT routes_current_version_fk
  FOREIGN KEY (current_version_id) REFERENCES route_versions(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS card_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  route_id UUID NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  route_version_id UUID NOT NULL REFERENCES route_versions(id) ON DELETE RESTRICT,
  route_version_code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'rendering', 'completed', 'failed', 'expired')),
  frozen_content JSONB NOT NULL,
  layout_params JSONB NOT NULL,
  source_snapshot JSONB NOT NULL,
  estimate JSONB NOT NULL,
  file_path TEXT,
  file_sha256 TEXT,
  file_size BIGINT,
  error_message TEXT,
  idempotency_key TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_route_versions_route_revision ON route_versions(route_id, revision DESC);
CREATE INDEX IF NOT EXISTS idx_card_tasks_status_created ON card_tasks(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_card_tasks_user_created ON card_tasks(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_card_tasks_version ON card_tasks(route_version_id);

CREATE TABLE IF NOT EXISTS download_tokens (
  token_hash TEXT PRIMARY KEY,
  task_id UUID NOT NULL REFERENCES card_tasks(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_download_tokens_task ON download_tokens(task_id);

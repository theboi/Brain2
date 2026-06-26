-- 0037_sources_mode: persist source ingest mode for downstream dispatch.

ALTER TABLE sources ADD COLUMN mode TEXT NOT NULL DEFAULT 'wiki';

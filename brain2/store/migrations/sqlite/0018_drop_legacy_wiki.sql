-- 0018_drop_legacy_wiki: cut over to vault-first storage. RUN AFTER brain2-migrate-to-vault.

DROP TABLE IF EXISTS wiki_pages;
DROP TABLE IF EXISTS wiki_revisions;
DROP TABLE IF EXISTS wiki_fts;
DROP TABLE IF EXISTS wiki_audits;
DROP TABLE IF EXISTS wiki_audit_suggestions;
DROP TABLE IF EXISTS ingestion_jobs;
DROP TABLE IF EXISTS sources;
DROP TABLE IF EXISTS source_tags;
DROP TABLE IF EXISTS source_folders;

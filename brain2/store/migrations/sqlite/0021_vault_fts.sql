-- 0021_vault_fts: FTS5 over vault_pages topic + tldr

CREATE VIRTUAL TABLE IF NOT EXISTS vault_pages_fts USING fts5(
    project_id UNINDEXED,
    path       UNINDEXED,
    topic,
    tldr
);

-- Populate from existing rows (no-op on fresh DBs).
INSERT INTO vault_pages_fts(project_id, path, topic, tldr)
SELECT project_id, path, COALESCE(topic, ''), COALESCE(tldr, '')
FROM vault_pages;

CREATE TRIGGER IF NOT EXISTS vault_pages_fts_ai AFTER INSERT ON vault_pages BEGIN
    INSERT INTO vault_pages_fts(project_id, path, topic, tldr)
    VALUES (new.project_id, new.path,
            COALESCE(new.topic, ''), COALESCE(new.tldr, ''));
END;

CREATE TRIGGER IF NOT EXISTS vault_pages_fts_au AFTER UPDATE ON vault_pages BEGIN
    DELETE FROM vault_pages_fts
    WHERE project_id=old.project_id AND path=old.path;
    INSERT INTO vault_pages_fts(project_id, path, topic, tldr)
    VALUES (new.project_id, new.path,
            COALESCE(new.topic, ''), COALESCE(new.tldr, ''));
END;

CREATE TRIGGER IF NOT EXISTS vault_pages_fts_ad AFTER DELETE ON vault_pages BEGIN
    DELETE FROM vault_pages_fts
    WHERE project_id=old.project_id AND path=old.path;
END;

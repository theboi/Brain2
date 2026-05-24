-- 0002_secrets: encrypted credentials + per-subject data keys for crypto-shredding.

CREATE TABLE secrets (
    tenant_id   TEXT NOT NULL,
    key         TEXT NOT NULL,
    value_enc   BLOB NOT NULL,  -- AES-256-GCM: iv(12) || ciphertext || tag(16)
    created_at  TEXT NOT NULL,
    accessed_at TEXT,
    PRIMARY KEY (tenant_id, key)
);

-- Per-subject data keys enable GDPR crypto-shredding (Phase 4 §9.3).
-- Erasure = set key_enc to NULL; ciphertext remains but is unrecoverable.
CREATE TABLE subject_data_keys (
    tenant_id   TEXT NOT NULL,
    subject_id  TEXT NOT NULL,  -- typically user_id
    key_enc     BLOB,           -- AES-256-GCM encrypted data key; NULL after shredding
    created_at  TEXT NOT NULL,
    shredded_at TEXT,
    PRIMARY KEY (tenant_id, subject_id)
);

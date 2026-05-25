-- 0009_metering: hourly usage rollup (P5 §8.8).
CREATE TABLE tenant_usage (
    tenant_id    TEXT NOT NULL,
    window_start TEXT NOT NULL,            -- ISO hour bucket
    metric       TEXT NOT NULL,            -- llm_tokens_in|llm_tokens_out|storage_bytes|queries|ingests|llm_cost_est
    value        INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (tenant_id, window_start, metric)
);

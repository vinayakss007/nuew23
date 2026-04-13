-- Per-tenant backup and restore tracking tables
-- This tracks individual tenant-level backups (not full DB dumps)
-- so that any single tenant's data can be restored without touching others.

CREATE TABLE IF NOT EXISTS tenant_backup_records (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    status          VARCHAR(20) NOT NULL DEFAULT 'pending',  -- pending | running | completed | failed
    backup_type     VARCHAR(20) DEFAULT 'full',              -- full | critical_only
    data_size       BIGINT DEFAULT 0,                        -- bytes of JSON backup data
    table_count     INT DEFAULT 0,
    record_count    BIGINT DEFAULT 0,
    backup_data     JSONB,                                   -- Actual exported data (tables + rows)
    backup_note     TEXT,
    include_tables  JSONB,                                   -- Specific tables included
    initiated_by    UUID,                                    -- user_id who triggered
    initiated_auto  BOOLEAN DEFAULT FALSE,                   -- true = cron/system triggered
    duration_ms     INT,
    error_message   TEXT,
    retention_days  INT DEFAULT 90,                          -- How long to keep this backup
    expires_at      TIMESTAMP GENERATED ALWAYS AS (created_at + (retention_days || ' days')::INTERVAL) STORED,
    created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
    completed_at    TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tenant_backup_tenant ON tenant_backup_records(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_tenant_backup_status ON tenant_backup_records(status, created_at);
CREATE INDEX IF NOT EXISTS idx_tenant_backup_expires ON tenant_backup_records(expires_at) WHERE status = 'completed';

-- Restore tracking
CREATE TABLE IF NOT EXISTS tenant_restore_records (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    backup_id       UUID NOT NULL REFERENCES tenant_backup_records(id) ON DELETE CASCADE,
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    status          VARCHAR(20) NOT NULL DEFAULT 'running',  -- running | completed | failed
    restore_options JSONB,                                   -- { deleteExisting, skipTables }
    tables_restored INT DEFAULT 0,
    records_restored BIGINT DEFAULT 0,
    initiated_by    UUID,
    duration_ms     INT,
    error_message   TEXT,
    initiated_at    TIMESTAMP NOT NULL DEFAULT NOW(),
    completed_at    TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tenant_restore_tenant ON tenant_restore_records(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_tenant_restore_backup ON tenant_restore_records(backup_id);

-- Automated backup schedule configuration (per tenant or global)
CREATE TABLE IF NOT EXISTS backup_schedules (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID REFERENCES tenants(id) ON DELETE CASCADE,  -- NULL = global schedule
    schedule_type   VARCHAR(20) NOT NULL DEFAULT 'monthly',        -- daily | weekly | monthly
    backup_type     VARCHAR(20) NOT NULL DEFAULT 'full',           -- full | critical_only
    retention_days  INT NOT NULL DEFAULT 90,
    enabled         BOOLEAN NOT NULL DEFAULT TRUE,
    last_run_at     TIMESTAMP,
    next_run_at     TIMESTAMP,
    created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_backup_schedules_tenant ON backup_schedules(tenant_id) WHERE tenant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_backup_schedules_next ON backup_schedules(next_run_at, enabled) WHERE enabled = TRUE;

-- Critical data audit log (tracks what gets backed up even after deletion)
CREATE TABLE IF NOT EXISTS critical_data_backups (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL,
    table_name      VARCHAR(100) NOT NULL,
    record_id       UUID NOT NULL,
    backup_data     JSONB NOT NULL,                              -- Full row snapshot
    operation       VARCHAR(10) NOT NULL,                        -- insert | update | delete
    backed_up_at    TIMESTAMP NOT NULL DEFAULT NOW(),
    retained_until  TIMESTAMP NOT NULL DEFAULT (NOW() + INTERVAL '90 days'),
    deleted_by      UUID,                                        -- Who deleted it (if applicable)
    can_restore     BOOLEAN DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS idx_critical_backups_tenant ON critical_data_backups(tenant_id, table_name);
CREATE INDEX IF NOT EXISTS idx_critical_backups_retain ON critical_data_backups(retained_until);
CREATE INDEX IF NOT EXISTS idx_critical_backups_record ON critical_data_backups(table_name, record_id);

COMMENT ON TABLE tenant_backup_records IS 'Tracks per-tenant full data backups for point-in-time restore';
COMMENT ON TABLE tenant_restore_records IS 'Tracks restore operations and their status';
COMMENT ON TABLE backup_schedules IS 'Configures automated backup schedules (global or per-tenant)';
COMMENT ON TABLE critical_data_backups IS 'Stores snapshots of critical data before deletion — retained 90 days minimum';

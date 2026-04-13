import { Pool, PoolClient } from 'pg';

/**
 * TenantDataExporter
 * 
 * Exports ALL data for a single tenant from the database.
 * This produces a clean, tenant-scoped data dump that can later be restored
 * without affecting any other tenant.
 */

// All per-tenant tables in dependency order (parents before children)
const TENANT_TABLES = [
  // Core tenant data
  { table: 'tenants', keyColumn: 'id', filterColumn: 'id' },

  // Settings & config
  { table: 'roles', keyColumn: 'id', filterColumn: 'tenant_id' },
  { table: 'tenant_members', keyColumn: 'id', filterColumn: 'tenant_id' },
  { table: 'invitations', keyColumn: 'id', filterColumn: 'tenant_id' },
  { table: 'onboarding_progress', keyColumn: 'id', filterColumn: 'tenant_id' },
  { table: 'subscriptions', keyColumn: 'id', filterColumn: 'tenant_id' },

  // CRM core
  { table: 'contacts', keyColumn: 'id', filterColumn: 'tenant_id' },
  { table: 'companies', keyColumn: 'id', filterColumn: 'tenant_id' },
  { table: 'pipelines', keyColumn: 'id', filterColumn: 'tenant_id' },
  { table: 'deal_stages', keyColumn: 'id', filterColumn: 'tenant_id' },
  { table: 'deals', keyColumn: 'id', filterColumn: 'tenant_id' },
  { table: 'leads', keyColumn: 'id', filterColumn: 'tenant_id' },
  { table: 'tags', keyColumn: 'id', filterColumn: 'tenant_id' },

  // Communication
  { table: 'email_templates', keyColumn: 'id', filterColumn: 'tenant_id' },
  { table: 'email_tracking', keyColumn: 'id', filterColumn: 'tenant_id' },
  { table: 'sequences', keyColumn: 'id', filterColumn: 'tenant_id' },
  { table: 'sequence_steps', keyColumn: 'id', filterColumn: 'sequence_id' },
  { table: 'sequence_enrollments', keyColumn: 'id', filterColumn: 'tenant_id' },
  { table: 'sequence_step_logs', keyColumn: 'id', filterColumn: 'tenant_id' },

  // Tasks & activities
  { table: 'tasks', keyColumn: 'id', filterColumn: 'tenant_id' },
  { table: 'activities', keyColumn: 'id', filterColumn: 'tenant_id' },
  { table: 'notifications', keyColumn: 'id', filterColumn: 'tenant_id' },

  // Automation & workflows
  { table: 'workflows', keyColumn: 'id', filterColumn: 'tenant_id' },
  { table: 'workflow_actions', keyColumn: 'id', filterColumn: 'workflow_id' },
  { table: 'workflow_execution_logs', keyColumn: 'id', filterColumn: 'tenant_id' },
  { table: 'workflow_action_logs', keyColumn: 'id', filterColumn: 'tenant_id' },
  { table: 'automations', keyColumn: 'id', filterColumn: 'tenant_id' },
  { table: 'automation_workflows', keyColumn: 'id', filterColumn: 'tenant_id' },
  { table: 'automation_runs', keyColumn: 'id', filterColumn: 'tenant_id' },

  // AI & analytics
  { table: 'ai_insights', keyColumn: 'id', filterColumn: 'tenant_id' },
  { table: 'ai_email_drafts', keyColumn: 'id', filterColumn: 'tenant_id' },
  { table: 'contact_scores', keyColumn: 'id', filterColumn: 'tenant_id' },
  { table: 'ai_usage_logs', keyColumn: 'id', filterColumn: 'tenant_id' },
  { table: 'churn_predictions', keyColumn: 'id', filterColumn: 'tenant_id' },
  { table: 'deal_forecasts', keyColumn: 'id', filterColumn: 'tenant_id' },
  { table: 'revenue_projections', keyColumn: 'id', filterColumn: 'tenant_id' },
  { table: 'pipeline_health_metrics', keyColumn: 'id', filterColumn: 'tenant_id' },

  // Reports & dashboards
  { table: 'saved_reports', keyColumn: 'id', filterColumn: 'tenant_id' },
  { table: 'report_executions', keyColumn: 'id', filterColumn: 'tenant_id' },
  { table: 'dashboards', keyColumn: 'id', filterColumn: 'tenant_id' },

  // Integration & webhooks
  { table: 'webhooks', keyColumn: 'id', filterColumn: 'tenant_id' },
  { table: 'webhook_deliveries', keyColumn: 'id', filterColumn: 'webhook_id' },
  { table: 'webhook_inbound_logs', keyColumn: 'id', filterColumn: 'tenant_id' },
  { table: 'failed_webhooks', keyColumn: 'id', filterColumn: 'tenant_id' },
  { table: 'api_keys', keyColumn: 'id', filterColumn: 'tenant_id' },
  { table: 'api_key_usage', keyColumn: 'id', filterColumn: 'api_key_id' },
  { table: 'integrations', keyColumn: 'id', filterColumn: 'tenant_id' },

  // Enterprise features
  { table: 'field_permissions', keyColumn: 'id', filterColumn: 'tenant_id' },
  { table: 'record_permissions', keyColumn: 'id', filterColumn: 'tenant_id' },
  { table: 'products', keyColumn: 'id', filterColumn: 'tenant_id' },
  { table: 'price_books', keyColumn: 'id', filterColumn: 'tenant_id' },
  { table: 'price_book_entries', keyColumn: 'id', filterColumn: 'price_book_id' },
  { table: 'quotes', keyColumn: 'id', filterColumn: 'tenant_id' },
  { table: 'quote_line_items', keyColumn: 'id', filterColumn: 'quote_id' },
  { table: 'sso_providers', keyColumn: 'id', filterColumn: 'tenant_id' },

  // Lead management
  { table: 'lead_scoring_rules', keyColumn: 'id', filterColumn: 'tenant_id' },
  { table: 'lead_activities', keyColumn: 'id', filterColumn: 'tenant_id' },

  // Contact lifecycle & merge
  { table: 'contact_lifecycle_history', keyColumn: 'id', filterColumn: 'tenant_id' },
  { table: 'contact_merge_history', keyColumn: 'id', filterColumn: 'tenant_id' },

  // Audit & impersonation
  { table: 'audit_logs', keyColumn: 'id', filterColumn: 'tenant_id' },
  { table: 'impersonation_sessions', keyColumn: 'id', filterColumn: 'tenant_id' },

  // Modules & forms
  { table: 'modules', keyColumn: 'id', filterColumn: 'tenant_id' },
  { table: 'tenant_modules', keyColumn: 'id', filterColumn: 'tenant_id' },
  { table: 'forms', keyColumn: 'id', filterColumn: 'tenant_id' },
  { table: 'form_submissions', keyColumn: 'id', filterColumn: 'form_id' },

  // Meetings & calls
  { table: 'meetings', keyColumn: 'id', filterColumn: 'tenant_id' },
  { table: 'call_recordings', keyColumn: 'id', filterColumn: 'tenant_id' },
  { table: 'call_notes', keyColumn: 'id', filterColumn: 'tenant_id' },
  { table: 'conversation_metrics', keyColumn: 'id', filterColumn: 'tenant_id' },
  { table: 'conversation_keywords', keyColumn: 'id', filterColumn: 'tenant_id' },

  // Notes & files
  { table: 'notes', keyColumn: 'id', filterColumn: 'tenant_id' },
  { table: 'file_attachments', keyColumn: 'id', filterColumn: 'tenant_id' },

  // Email & billing
  { table: 'email_log', keyColumn: 'id', filterColumn: 'tenant_id' },
  { table: 'billing_events', keyColumn: 'id', filterColumn: 'tenant_id' },
  { table: 'usage_snapshots', keyColumn: 'id', filterColumn: 'tenant_id' },

  // Custom fields
  { table: 'custom_field_defs', keyColumn: 'id', filterColumn: 'tenant_id' },

  // Deal products
  { table: 'deal_products', keyColumn: 'id', filterColumn: 'deal_id' },

  // Superadmin-only (per-tenant but managed globally)
  // These are NOT exported — they are platform-level records
  // error_logs, health_checks, support_tickets, announcements, limit_violations, rate_limits
];

export interface TenantExportResult {
  tables: Record<string, { columns: string[]; rows: Record<string, any>[] }>;
  dataSize: number;
  tableCount: number;
  totalRecords: number;
  exportedAt: string;
  tenantId: string;
  tenantName?: string;
}

export class TenantDataExporter {
  private pool: Pool;
  private tenantId: string;

  constructor(pool: Pool, tenantId: string) {
    this.pool = pool;
    this.tenantId = tenantId;
  }

  /**
   * Export all tenant data
   */
  async exportAll(includeTables?: string[]): Promise<TenantExportResult> {
    const client = await this.pool.connect();
    const result: TenantExportResult = {
      tables: {},
      dataSize: 0,
      tableCount: 0,
      totalRecords: 0,
      exportedAt: new Date().toISOString(),
      tenantId: this.tenantId,
    };

    try {
      // Get tenant name
      const tenantInfo = await client.query(
        'SELECT name, subdomain FROM tenants WHERE id = $1',
        [this.tenantId]
      );
      if (tenantInfo.rows.length > 0) {
        result.tenantName = tenantInfo.rows[0]?.name;
      }

      // Determine which tables to export
      const tablesToExport = includeTables
        ? TENANT_TABLES.filter(t => includeTables.includes(t.table))
        : TENANT_TABLES;

      for (const tableDef of tablesToExport) {
        try {
          const tableData = await this.exportTable(client, tableDef);
          if (tableData.rows.length > 0 || true) { // Include even empty tables for schema
            result.tables[tableDef.table] = tableData;
            result.totalRecords += tableData.rows.length;
          }
          result.tableCount++;
        } catch (err: any) {
          // Table might not exist yet (migrations not run) — skip gracefully
          console.warn(`[Export] Table ${tableDef.table} not found, skipping:`, err.message);
          result.tableCount++; // Count it anyway so progress is accurate
        }
      }

      // Calculate data size
      result.dataSize = Buffer.byteLength(JSON.stringify(result.tables), 'utf8');

    } finally {
      client.release();
    }

    return result;
  }

  /**
   * Export a single table's data for this tenant
   */
  private async exportTable(
    client: PoolClient,
    tableDef: { table: string; filterColumn: string }
  ): Promise<{ columns: string[]; rows: Record<string, any>[] }> {
    // Get all rows for this tenant
    const query = `SELECT * FROM ${tableDef.table} WHERE ${tableDef.filterColumn} = $1 ORDER BY id`;
    const result = await client.query(query, [this.tenantId]);

    // Convert BigInt and Date to serializable formats
    const rows = result.rows.map(row => {
      const cleanRow: Record<string, any> = {};
      for (const [key, value] of Object.entries(row)) {
        if (typeof value === 'bigint') {
          cleanRow[key] = Number(value);
        } else if (value instanceof Date) {
          cleanRow[key] = value.toISOString();
        } else if (Buffer.isBuffer(value)) {
          cleanRow[key] = value.toString('base64');
        } else {
          cleanRow[key] = value;
        }
      }
      return cleanRow;
    });

    return {
      columns: result.fields.map(f => f.name),
      rows,
    };
  }

  /**
   * Export as SQL INSERT statements (alternative format)
   */
  async exportAsSQL(includeTables?: string[]): Promise<string> {
    const data = await this.exportAll(includeTables);
    const sqlParts: string[] = [];

    sqlParts.push(`-- NuCRM Tenant Data Export`);
    sqlParts.push(`-- Tenant: ${data.tenantName || data.tenantId}`);
    sqlParts.push(`-- Tenant ID: ${data.tenantId}`);
    sqlParts.push(`-- Exported: ${data.exportedAt}`);
    sqlParts.push(`-- Tables: ${data.tableCount}, Records: ${data.totalRecords}`);
    sqlParts.push('');
    sqlParts.push('BEGIN;');
    sqlParts.push('');

    for (const [tableName, tableData] of Object.entries(data.tables)) {
      if (tableData.rows.length === 0) continue;

      sqlParts.push(`-- Table: ${tableName} (${tableData.rows.length} rows)`);

      for (const row of tableData.rows) {
        const columns = Object.keys(row);
        const values = columns.map(col => {
          const val = row[col];
          if (val === null || val === undefined) return 'NULL';
          if (typeof val === 'number') return val.toString();
          if (typeof val === 'boolean') return val.toString();
          // Escape single quotes and wrap in quotes
          const escaped = String(val).replace(/'/g, "''");
          return `'${escaped}'`;
        });

        const colList = columns.map(c => `"${c}"`).join(', ');
        const valList = values.join(', ');
        sqlParts.push(`INSERT INTO "${tableName}" (${colList}) VALUES (${valList}) ON CONFLICT DO NOTHING;`);
      }
      sqlParts.push('');
    }

    sqlParts.push('COMMIT;');
    return sqlParts.join('\n');
  }

  /**
   * Get table list with row counts (for preview)
   */
  async getTableStats(): Promise<{ table: string; rowCount: number }[]> {
    const client = await this.pool.connect();
    const stats: { table: string; rowCount: number }[] = [];

    try {
      for (const tableDef of TENANT_TABLES) {
        try {
          const result = await client.query(
            `SELECT COUNT(*) FROM ${tableDef.table} WHERE ${tableDef.filterColumn} = $1`,
            [this.tenantId]
          );
          stats.push({
            table: tableDef.table,
            rowCount: parseInt(result.rows[0]?.count || '0', 10),
          });
        } catch {
          // Table doesn't exist
        }
      }
    } finally {
      client.release();
    }

    return stats.filter(s => s.rowCount > 0);
  }
}

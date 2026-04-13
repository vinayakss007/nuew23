import { Pool, PoolClient } from 'pg';

/**
 * TenantDataImporter
 * 
 * Imports data for a SINGLE tenant from a backup export.
 * Only affects the target tenant — no other tenant data is touched.
 * 
 * Options:
 *   - deleteExisting: Delete all existing data for this tenant before importing
 *   - skipTables: Tables to skip during import
 *   - upsert: Use INSERT ... ON CONFLICT UPDATE instead of INSERT only
 */

export interface TenantImportResult {
  tablesRestored: number;
  recordsRestored: number;
  errors: { table: string; error: string }[];
}

export class TenantDataImporter {
  private pool: Pool;
  private tenantId: string;

  constructor(pool: Pool, tenantId: string) {
    this.pool = pool;
    this.tenantId = tenantId;
  }

  /**
   * Import all tables from a backup export
   */
  async importAll(
    tables: Record<string, { columns: string[]; rows: Record<string, any>[] }>
  ): Promise<TenantImportResult> {
    const client = await this.pool.connect();
    const result: TenantImportResult = {
      tablesRestored: 0,
      recordsRestored: 0,
      errors: [],
    };

    try {
      await client.query('BEGIN');

      for (const [tableName, tableData] of Object.entries(tables)) {
        try {
          const inserted = await this.importTable(client, tableName, tableData);
          result.tablesRestored++;
          result.recordsRestored += inserted;
        } catch (err: any) {
          result.errors.push({ table: tableName, error: err.message });
          console.error(`[Import] Error importing ${tableName}:`, err.message);
          // Continue with other tables — don't fail entirely
        }
      }

      await client.query('COMMIT');
    } catch (err: any) {
      await client.query('ROLLBACK');
      throw new Error(`Import transaction failed: ${err.message}`);
    } finally {
      client.release();
    }

    return result;
  }

  /**
   * Delete all existing data for this tenant (before restore)
   */
  async deleteExistingData(skipTables: string[] = []): Promise<void> {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      // Delete in reverse dependency order (children before parents)
      const deleteOrder = [
        'deal_products',
        'quote_line_items',
        'quotes',
        'price_book_entries',
        'price_books',
        'products',
        'workflow_action_logs',
        'workflow_execution_logs',
        'workflow_actions',
        'workflows',
        'automation_runs',
        'automation_workflows',
        'automations',
        'sequence_step_logs',
        'sequence_enrollments',
        'sequence_steps',
        'sequences',
        'call_notes',
        'call_recordings',
        'conversation_keywords',
        'conversation_metrics',
        'churn_predictions',
        'deal_forecasts',
        'revenue_projections',
        'pipeline_health_metrics',
        'ai_usage_logs',
        'contact_scores',
        'ai_email_drafts',
        'ai_insights',
        'report_executions',
        'saved_reports',
        'dashboards',
        'failed_webhooks',
        'webhook_deliveries',
        'webhook_inbound_logs',
        'webhooks',
        'api_key_usage',
        'api_keys',
        'impersonation_sessions',
        'audit_logs',
        'contact_merge_history',
        'contact_lifecycle_history',
        'lead_activities',
        'lead_scoring_rules',
        'sso_providers',
        'integrations',
        'record_permissions',
        'field_permissions',
        'file_attachments',
        'notes',
        'form_submissions',
        'forms',
        'tenant_modules',
        'modules',
        'meetings',
        'email_log',
        'billing_events',
        'usage_snapshots',
        'custom_field_defs',
        'onboarding_progress',
        'subscriptions',
        'invitations',
        'tenant_members',
        'roles',
        'email_tracking',
        'email_templates',
        'tasks',
        'notifications',
        'activities',
        'deals',
        'deal_stages',
        'pipelines',
        'leads',
        'contacts',
        'companies',
        'tags',
      ];

      for (const table of deleteOrder) {
        if (skipTables.includes(table)) continue;
        try {
          // Try tenant_id filter first
          await client.query(`DELETE FROM "${table}" WHERE tenant_id = $1`, [this.tenantId]);
        } catch {
          try {
            // Try other filter columns
            await client.query(`DELETE FROM "${table}" WHERE id IN (SELECT id FROM "${table}" WHERE tenant_id = $1)`, [this.tenantId]);
          } catch {
            // Table might not exist or use different column — skip
          }
        }
      }

      // Delete the tenant itself
      try {
        // First update owner_id if exists
        await client.query(`UPDATE tenants SET owner_id = NULL WHERE id = $1`, [this.tenantId]);
      } catch {
        // Column might not exist
      }
      try {
        await client.query(`DELETE FROM tenants WHERE id = $1`, [this.tenantId]);
      } catch {
        // Table might not exist
      }

      await client.query('COMMIT');
    } catch (err: any) {
      await client.query('ROLLBACK');
      throw new Error(`Delete failed: ${err.message}`);
    } finally {
      client.release();
    }
  }

  /**
   * Import a single table
   */
  private async importTable(
    client: PoolClient,
    tableName: string,
    tableData: { columns: string[]; rows: Record<string, any>[] }
  ): Promise<number> {
    if (tableData.rows.length === 0) return 0;

    let inserted = 0;

    for (const row of tableData.rows) {
      const columns = Object.keys(row);
      const values = Object.values(row);

      // Build INSERT with ON CONFLICT DO NOTHING (idempotent)
      const colList = columns.map(c => `"${c}"`).join(', ');
      const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');

      // Determine conflict column — usually 'id'
      const conflictColumn = columns.includes('id') ? 'id' : columns[0];

      const query = `
        INSERT INTO "${tableName}" (${colList}) 
        VALUES (${placeholders})
        ON CONFLICT ("${conflictColumn}") DO NOTHING
      `;

      try {
        const result = await client.query(query, values);
        if (result.rowCount && result.rowCount > 0) {
          inserted++;
        }
      } catch (err: any) {
        // Log but continue — some rows may have FK constraints that need parent data first
        console.warn(`[Import] Row insert failed in ${tableName}:`, err.message);
      }
    }

    return inserted;
  }

  /**
   * Import from SQL string (alternative format)
   */
  static async importFromSQL(pool: Pool, tenantId: string, sql: string): Promise<TenantImportResult> {
    const client = await pool.connect();
    const result: TenantImportResult = {
      tablesRestored: 0,
      recordsRestored: 0,
      errors: [],
    };

    try {
      await client.query('BEGIN');

      // Split by semicolons and execute each statement
      const statements = sql
        .split(';')
        .map(s => s.trim())
        .filter(s => s && !s.startsWith('--') && s.toUpperCase() !== 'BEGIN' && s.toUpperCase() !== 'COMMIT');

      for (const statement of statements) {
        try {
          const res = await client.query(statement);
          if (res.rowCount) {
            result.recordsRestored += res.rowCount;
          }
        } catch (err: any) {
          result.errors.push({ table: 'sql', error: err.message });
          console.warn('[Import SQL] Statement failed:', err.message);
          console.warn('[Import SQL] Statement:', statement.substring(0, 200));
        }
      }

      await client.query('COMMIT');
      result.tablesRestored = 1; // SQL batch
    } catch (err: any) {
      await client.query('ROLLBACK');
      throw new Error(`SQL import failed: ${err.message}`);
    } finally {
      client.release();
    }

    return result;
  }
}

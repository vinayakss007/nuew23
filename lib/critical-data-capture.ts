import { Pool } from 'pg';

/**
 * Critical Data Capture System
 * 
 * Before ANY critical data is deleted, this captures a full snapshot
 * of the row so it can be restored even after deletion.
 * 
 * Retained for 90 days minimum.
 * 
 * Usage: Call this BEFORE running DELETE statements on critical tables.
 * 
 * Can also be wired to database triggers for automatic capture.
 */

const CRITICAL_TABLES = [
  'contacts', 'leads', 'deals', 'companies',
  'tenants', 'tasks', 'tenant_members', 'roles',
  'subscriptions', 'invitations',
];

const RETENTION_DAYS = 90;

export class CriticalDataCapture {
  private pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  /**
   * Capture a snapshot of data before it's deleted
   * 
   * Call this BEFORE running your DELETE query.
   * 
   * @param tenantId - The tenant who owns this data
   * @param tableName - Which table (e.g., 'contacts')
   * @param recordIds - IDs of records about to be deleted
   * @param deletedBy - Who is doing the deletion (user ID)
   */
  async captureBeforeDelete(
    tenantId: string,
    tableName: string,
    recordIds: string[],
    deletedBy?: string
  ): Promise<number> {
    if (!CRITICAL_TABLES.includes(tableName)) {
      console.log(`[CriticalDataCapture] Table ${tableName} is not in critical list, skipping capture`);
      return 0;
    }

    if (recordIds.length === 0) return 0;

    let captured = 0;

    for (const recordId of recordIds) {
      try {
        // Fetch the full row before deletion
        const result = await this.pool.query(
          `SELECT * FROM "${tableName}" WHERE id = $1`,
          [recordId]
        );

        if (result.rows.length === 0) continue;

        const rowData = result.rows[0];

        // Clean non-serializable values
        const cleanData: Record<string, any> = {};
        for (const [key, value] of Object.entries(rowData)) {
          if (typeof value === 'bigint') {
            cleanData[key] = Number(value);
          } else if (value instanceof Date) {
            cleanData[key] = value.toISOString();
          } else if (Buffer.isBuffer(value)) {
            cleanData[key] = value.toString('base64');
          } else {
            cleanData[key] = value;
          }
        }

        // Save to critical backup table
        await this.pool.query(
          `INSERT INTO critical_data_backups 
           (tenant_id, table_name, record_id, backup_data, operation, deleted_by, retained_until)
           VALUES ($1, $2, $3, $4, 'delete', $5, NOW() + INTERVAL '${RETENTION_DAYS} days')`,
          [tenantId, tableName, recordId, JSON.stringify(cleanData), deletedBy || null]
        );

        captured++;
      } catch (err: any) {
        console.error(`[CriticalDataCapture] Failed to capture ${tableName}:${recordId}:`, err.message);
        // Don't throw — we don't want backup failures to block the actual delete
      }
    }

    if (captured > 0) {
      console.log(`[CriticalDataCapture] Captured ${captured} ${tableName} record(s) before deletion`);
    }

    return captured;
  }

  /**
   * Capture a snapshot before UPDATE (useful for audit trail)
   */
  async captureBeforeUpdate(
    tenantId: string,
    tableName: string,
    recordId: string
  ): Promise<void> {
    if (!CRITICAL_TABLES.includes(tableName)) return;

    try {
      const result = await this.pool.query(
        `SELECT * FROM "${tableName}" WHERE id = $1`,
        [recordId]
      );

      if (result.rows.length === 0) return;

      const rowData = result.rows[0];
      const cleanData: Record<string, any> = {};
      for (const [key, value] of Object.entries(rowData)) {
        if (typeof value === 'bigint') {
          cleanData[key] = Number(value);
        } else if (value instanceof Date) {
          cleanData[key] = value.toISOString();
        } else {
          cleanData[key] = value;
        }
      }

      await this.pool.query(
        `INSERT INTO critical_data_backups 
         (tenant_id, table_name, record_id, backup_data, operation, retained_until)
         VALUES ($1, $2, $3, $4, 'update', NOW() + INTERVAL '${RETENTION_DAYS} days')`,
        [tenantId, tableName, recordId, JSON.stringify(cleanData)]
      );
    } catch (err: any) {
      console.error(`[CriticalDataCapture] Failed to capture update for ${tableName}:${recordId}:`, err.message);
    }
  }

  /**
   * Search critical backups for deleted data that can be restored
   */
  async searchDeletedData(filters: {
    tenantId?: string;
    tableName?: string;
    recordId?: string;
    deletedAfter?: string;
    deletedBefore?: string;
    canRestore?: boolean;
    page?: number;
    limit?: number;
  }): Promise<{ backups: any[]; total: number }> {
    const conditions: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (filters.tenantId) {
      conditions.push(`tenant_id = $${paramIndex}`);
      params.push(filters.tenantId);
      paramIndex++;
    }
    if (filters.tableName) {
      conditions.push(`table_name = $${paramIndex}`);
      params.push(filters.tableName);
      paramIndex++;
    }
    if (filters.recordId) {
      conditions.push(`record_id = $${paramIndex}`);
      params.push(filters.recordId);
      paramIndex++;
    }
    if (filters.deletedAfter) {
      conditions.push(`backed_up_at >= $${paramIndex}`);
      params.push(filters.deletedAfter);
      paramIndex++;
    }
    if (filters.deletedBefore) {
      conditions.push(`backed_up_at <= $${paramIndex}`);
      params.push(filters.deletedBefore);
      paramIndex++;
    }
    if (filters.canRestore !== undefined) {
      conditions.push(`can_restore = $${paramIndex}`);
      params.push(filters.canRestore);
      paramIndex++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const page = filters.page || 1;
    const limit = Math.min(100, filters.limit || 50);
    const offset = (page - 1) * limit;

    // Get total
    const countResult = await this.pool.query(
      `SELECT count(*) FROM critical_data_backups ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0]?.count || '0', 10);

    // Get records
    const records = await this.pool.query(
      `SELECT * FROM critical_data_backups 
       ${whereClause}
       ORDER BY backed_up_at DESC 
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, limit, offset]
    );

    return {
      backups: records.rows.map(row => ({
        ...row,
        backup_data: typeof row.backup_data === 'string' ? JSON.parse(row.backup_data) : row.backup_data,
      })),
      total,
    };
  }

  /**
   * Restore a specific deleted record from critical backup
   */
  async restoreFromBackup(backupId: string): Promise<{ success: boolean; message: string; data?: any }> {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      // Get the backup
      const backupResult = await client.query(
        `SELECT * FROM critical_data_backups WHERE id = $1 AND can_restore = true`,
        [backupId]
      );

      if (backupResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return { success: false, message: 'Backup not found or already restored' };
      }

      const backup = backupResult.rows[0];
      const data = typeof backup.backup_data === 'string' ? JSON.parse(backup.backup_data) : backup.backup_data;

      // Re-insert the record (ON CONFLICT DO NOTHING in case it was recreated)
      const columns = Object.keys(data);
      const values = Object.values(data);
      const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
      const colList = columns.map(c => `"${c}"`).join(', ');

      await client.query(
        `INSERT INTO "${backup.table_name}" (${colList}) VALUES (${placeholders}) ON CONFLICT (id) DO NOTHING`,
        values
      );

      // Mark backup as restored
      await client.query(
        `UPDATE critical_data_backups SET can_restore = false WHERE id = $1`,
        [backupId]
      );

      await client.query('COMMIT');

      return {
        success: true,
        message: `Restored ${backup.table_name} record ${backup.record_id}`,
        data,
      };
    } catch (err: any) {
      await client.query('ROLLBACK');
      return { success: false, message: `Restore failed: ${err.message}` };
    } finally {
      client.release();
    }
  }

  /**
   * Get stats on critical backups
   */
  async getStats(tenantId?: string): Promise<any> {
    const conditions: string[] = [];
    const params: any[] = [];

    if (tenantId) {
      conditions.push(`tenant_id = $1`);
      params.push(tenantId);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await this.pool.query(
      `SELECT 
         count(*) as total_backups,
         count(*) FILTER (WHERE can_restore = true) as restorable,
         count(*) FILTER (WHERE operation = 'delete') as deleted_records,
         count(*) FILTER (WHERE operation = 'update') as updated_records
       FROM critical_data_backups 
       ${whereClause}`,
      params
    );

    const byTable = await this.pool.query(
      `SELECT table_name, count(*) as count
       FROM critical_data_backups 
       ${whereClause}
       GROUP BY table_name
       ORDER BY count DESC`,
      params
    );

    return {
      ...result.rows[0],
      by_table: byTable.rows,
    };
  }
}

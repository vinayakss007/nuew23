/**
 * Row Level Security (RLS) Helper
 * Sets tenant context for database-enforced isolation
 *
 * SECURITY FIX (SEC-003): Now uses transaction-local settings (is_local=true)
 * to prevent connection pool contamination. When a connection is returned to
 * the pool, the settings are automatically discarded, preventing the next
 * request from inheriting the previous tenant's context.
 */

import { query, withTransaction } from '@/lib/db/client';

/**
 * Set tenant context for RLS policies
 *
 * Uses is_local=true — settings are scoped to the current transaction only.
 * When the connection returns to the pool, the settings are automatically
 * discarded. This prevents cross-tenant data leakage on connection reuse.
 *
 * IMPORTANT: Because is_local=true requires a transaction context, callers
 * should use withTenantContext() which wraps the operation in a transaction.
 */
export async function setTenantContext(tenantId: string, userId: string): Promise<void> {
  try {
    // is_local=true — scoped to current transaction only
    // This prevents connection pool contamination
    await query(
      'SELECT set_config($1, $2, true), set_config($3, $4, true)',
      [
        'app.current_tenant',
        tenantId,
        'app.current_user',
        userId,
      ]
    );
  } catch (error) {
    console.error('[RLS] Failed to set tenant context:', error);
    throw error;
  }
}

/**
 * Clear tenant context (no longer strictly needed with is_local=true,
 * but kept for compatibility with code that calls it explicitly).
 */
export async function clearTenantContext(): Promise<void> {
  try {
    await query(
      'SELECT set_config($1, $2, true), set_config($3, $4, true)',
      [
        'app.current_tenant',
        '',
        'app.current_user',
        '',
      ]
    );
  } catch (error) {
    console.error('[RLS] Failed to clear tenant context:', error);
  }
}

/**
 * Execute a function with tenant context.
 * Wraps the operation in a transaction so that set_config(..., true) works.
 * This is the RECOMMENDED way to run tenant-scoped queries.
 *
 * Example:
 *   const contacts = await withTenantContext(tenantId, userId, async () => {
 *     return await query('SELECT * FROM contacts');
 *   });
 */
export async function withTenantContext<T>(
  tenantId: string,
  userId: string,
  fn: () => Promise<T>
): Promise<T> {
  return withTransaction(async (client) => {
    await client.query(
      'SELECT set_config($1, $2, true), set_config($3, $4, true)',
      ['app.current_tenant', tenantId, 'app.current_user', userId]
    );
    return fn();
  });
}

/**
 * Execute a query with tenant context in a single transaction.
 * Convenience wrapper for single-query operations.
 */
export async function queryWithTenantContext<T extends { rows: any[] }>(
  tenantId: string,
  userId: string,
  queryFn: (client: any) => Promise<T>
): Promise<T> {
  return withTransaction(async (client) => {
    await client.query(
      'SELECT set_config($1, $2, true), set_config($3, $4, true)',
      ['app.current_tenant', tenantId, 'app.current_user', userId]
    );
    return queryFn(client);
  });
}

/**
 * Verify RLS is enabled on a table
 */
export async function verifyRLSEnabled(tableName: string): Promise<boolean> {
  try {
    const result = await query<{ rowsecurity: boolean }>(
      'SELECT rowsecurity FROM pg_tables WHERE schemaname = $1 AND tablename = $2',
      ['public', tableName]
    );
    return result.rows[0]?.rowsecurity ?? false;
  } catch (error) {
    console.error('[RLS] Failed to verify RLS status:', error);
    return false;
  }
}

/**
 * Verify all critical tables have RLS enabled
 */
export async function verifyAllRLSEnabled(): Promise<{ table: string; enabled: boolean }[]> {
  const criticalTables = [
    'contacts',
    'companies',
    'deals',
    'tasks',
    'activities',
    'notes',
    'meetings',
    'automations',
    'notifications',
    'webhook_deliveries',
    'api_keys',
    'audit_logs',
  ];

  const results = await Promise.all(
    criticalTables.map(async (table) => ({
      table,
      enabled: await verifyRLSEnabled(table),
    }))
  );

  return results;
}

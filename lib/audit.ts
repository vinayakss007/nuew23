import { query } from '@/lib/db/client';
import { logger } from '@/lib/logger';

export async function logAudit(opts: {
  tenantId?: string;
  userId?: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  oldData?: any;
  newData?: any;
}) {
  try {
    await query(
      `INSERT INTO public.audit_logs
         (tenant_id, user_id, action, resource_type, resource_id, old_data, new_data)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        opts.tenantId ?? null,
        opts.userId ?? null,
        opts.action,
        opts.resourceType,
        opts.resourceId ?? null,
        opts.oldData ? JSON.stringify(opts.oldData) : null,
        opts.newData ? JSON.stringify(opts.newData) : null,
      ]
    );
  } catch (err) {
    // Never throw from audit logging, but always log the failure
    logger.error('[audit] Failed to write audit log', {
      action: opts.action,
      resourceType: opts.resourceType,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

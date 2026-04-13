/**
 * Export Service
 * Enqueue CSV exports for contacts, deals, companies, tasks
 * 
 * SAFETY LIMITS:
 * - Max 1000 contacts per import (prevents system overload)
 * - Batch processing for large datasets
 */

import { addJob } from '@/lib/queue';

export interface ExportOptions {
  type: 'contacts' | 'deals' | 'companies' | 'tasks';
  tenantId: string;
  userId: string;
  filters?: Record<string, any>;
  callbackUrl?: string;
}

// Maximum contacts per import to prevent system overload
export const MAX_IMPORT_CONTACTS = 1000;

/**
 * Import limit error
 */
export class ImportLimitError extends Error {
  constructor(limit: number, actual: number) {
    super(`Import limit exceeded: maximum ${limit} contacts allowed, but ${actual} provided. Split into multiple batches.`);
    this.name = 'ImportLimitError';
  }
}

/**
 * Enqueue a CSV export job
 */
export async function enqueueExport(options: ExportOptions): Promise<void> {
  await addJob('export-csv', {
    type: 'export',
    payload: {
      type: options.type,
      filters: options.filters || {},
      callbackUrl: options.callbackUrl,
    },
    tenantId: options.tenantId,
    userId: options.userId,
  }, {
    priority: 5,
    attempts: 3,
  });
}

/**
 * Enqueue a contact import job
 * VALIDATES: Max 1000 contacts per batch to prevent system overload
 */
export async function enqueueContactImport(
  tenantId: string,
  userId: string,
  csv: string,
  options: { skipDuplicates: boolean; updateExisting: boolean },
  totalRows: number
): Promise<void> {
  // Enforce 1000 contact limit per import
  if (totalRows > MAX_IMPORT_CONTACTS) {
    throw new ImportLimitError(MAX_IMPORT_CONTACTS, totalRows);
  }

  await addJob('contact-import', {
    type: 'import',
    payload: { csv, options, totalRows },
    tenantId,
    userId,
  }, {
    priority: 3,
    attempts: 1,
  });
}

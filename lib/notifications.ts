import { query } from '@/lib/db/client';
import { logger } from '@/lib/logger';

export type NotificationType =
  | 'task_assigned'    | 'task_due'       | 'task_overdue'
  | 'deal_stage'       | 'deal_assigned'  | 'deal_won'
  | 'contact_assigned' | 'mention'
  | 'invite_accepted'  | 'team_joined'
  | 'limit_warning'    | 'trial_expiring'
  | 'system';

export async function createNotification(opts: {
  userId: string;
  tenantId: string;
  type: NotificationType;
  title: string;
  body?: string;
  link?: string;
  /** Structured entity reference — enables deep-linking from notification list */
  entity_type?: 'contact' | 'deal' | 'task' | 'company' | 'lead' | 'sequence';
  entity_id?: string;
  metadata?: Record<string, any>;
}) {
  try {
    // Build enriched metadata that includes entity reference for deep links
    const meta: Record<string, any> = opts.metadata ?? {};
    if (opts.entity_type) meta['entity_type'] = opts.entity_type;
    if (opts.entity_id)   meta['entity_id']   = opts.entity_id;

    // Auto-derive link from entity if not explicitly provided
    let link = opts.link ?? null;
    if (!link && opts.entity_type && opts.entity_id) {
      const linkMap: Record<string, string> = {
        contact:  `/tenant/contacts/${opts.entity_id}`,
        deal:     `/tenant/deals/${opts.entity_id}`,
        task:     `/tenant/tasks`,
        company:  `/tenant/companies/${opts.entity_id}`,
        lead:     `/tenant/leads/${opts.entity_id}`,
        sequence: `/tenant/sequences/${opts.entity_id}`,
      };
      link = linkMap[opts.entity_type] ?? null;
    }

    await query(
      `INSERT INTO public.notifications
         (user_id, tenant_id, type, title, body, link, metadata, is_read)
       VALUES ($1, $2, $3, $4, $5, $6, $7, false)`,
      [
        opts.userId, opts.tenantId, opts.type,
        opts.title.slice(0, 200),
        opts.body?.slice(0, 500) ?? null,
        link,
        JSON.stringify(meta),
      ]
    );
  } catch (err) {
    logger.error('[notifications] Failed to create notification', {
      type: opts.type,
      userId: opts.userId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// Notify all members of a tenant (except excludeUserId)
export async function notifyTenantMembers(opts: {
  tenantId: string;
  excludeUserId?: string;
  type: NotificationType;
  title: string;
  body?: string;
  link?: string;
  entity_type?: 'contact' | 'deal' | 'task' | 'company' | 'lead' | 'sequence';
  entity_id?: string;
}) {
  try {
    const where = opts.excludeUserId
      ? `WHERE tm.tenant_id=$1 AND tm.status='active' AND tm.user_id!=$2`
      : `WHERE tm.tenant_id=$1 AND tm.status='active'`;
    const params = opts.excludeUserId
      ? [opts.tenantId, opts.excludeUserId]
      : [opts.tenantId];

    const { rows: members } = await query<{ user_id: string }>(
      `SELECT tm.user_id FROM public.tenant_members tm ${where}`,
      params
    );

    if (!members.length) return;

    // Build entity metadata
    const meta: Record<string, any> = {};
    if (opts.entity_type) meta['entity_type'] = opts.entity_type;
    if (opts.entity_id)   meta['entity_id']   = opts.entity_id;

    // Auto-derive link from entity if not explicitly provided
    let resolvedLink = opts.link ?? null;
    if (!resolvedLink && opts.entity_type && opts.entity_id) {
      const linkMap: Record<string, string> = {
        contact: `/tenant/contacts/${opts.entity_id}`,
        deal:    `/tenant/deals/${opts.entity_id}`,
        task:    `/tenant/tasks`,
        company: `/tenant/companies/${opts.entity_id}`,
        lead:    `/tenant/leads/${opts.entity_id}`,
        sequence:`/tenant/sequences/${opts.entity_id}`,
      };
      resolvedLink = linkMap[opts.entity_type] ?? null;
    }

    // Batch insert all notifications
    const values = members.map((m, i) => {
      const base = i * 7;
      return `($${base+1},$${base+2},$${base+3},$${base+4},$${base+5},$${base+6},$${base+7},false)`;
    }).join(',');

    const metaJson = JSON.stringify(meta);
    const flatParams = members.flatMap(m => [
      m.user_id, opts.tenantId, opts.type,
      opts.title.slice(0, 200),
      opts.body?.slice(0, 500) ?? null,
      resolvedLink,
      metaJson,
    ]);

    await query(
      `INSERT INTO public.notifications (user_id,tenant_id,type,title,body,link,metadata,is_read) VALUES ${values}`,
      flatParams
    );
  } catch (err) {
    logger.error('[notifications] Failed to notify tenant members', {
      tenantId: opts.tenantId,
      type: opts.type,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// Parse @mentions from text and notify mentioned users
export async function processMentions(text: string, tenantId: string, authorId: string, link?: string) {
  const mentions = text.match(/@(\w+)/g);
  if (!mentions) return;

  for (const mention of mentions) {
    const username = mention.slice(1);
    try {
      const { rows: [user] } = await query(
        `SELECT u.id FROM public.users u
         JOIN public.tenant_members tm ON tm.user_id=u.id
         WHERE tm.tenant_id=$1 AND tm.status='active'
           AND (lower(u.full_name) LIKE lower($2) OR lower(split_part(u.email,'@',1)) = lower($3))
           AND u.id != $4
         LIMIT 1`,
        [tenantId, `%${username}%`, username, authorId]
      );
      if (user) {
        await createNotification({
          userId: user.id, tenantId, type: 'mention',
          title: `You were mentioned`,
          body: text.slice(0, 150),
          link,
        });
      }
    } catch (err) {
      logger.error('[notifications] Failed to process mention', {
        mention: username,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

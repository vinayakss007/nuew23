import { requireTenantCtx } from '@/lib/tenant/context';
import { queryOne, queryMany } from '@/lib/db/client';
import { notFound } from 'next/navigation';
import LeadDetailClient from '@/components/tenant/lead-detail-client';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function LeadDetailPage({ params }: PageProps) {
  const ctx = await requireTenantCtx();
  const { id } = await params;
  
  // Get lead details
  const lead = await queryOne<any>(
    `SELECT 
      l.*,
      u.full_name as assigned_name,
      u.avatar_url as assigned_avatar,
      u.email as assigned_email,
      c.full_name as created_by_name
    FROM public.leads l
    LEFT JOIN public.users u ON u.id = l.assigned_to
    LEFT JOIN public.users c ON c.id = l.created_by
    WHERE l.id = $1 AND l.tenant_id = $2 AND l.deleted_at IS NULL`,
    [id, ctx.tenantId]
  );
  
  if (!lead) {
    notFound();
  }
  
  // Get activities
  const activities = await queryMany<any>(
    `SELECT
      la.id, la.lead_id, la.tenant_id, la.performed_by, la.activity_type,
      la.description, la.activity_data, la.performed_at,
      u.full_name as performed_by_name,
      u.avatar_url as performed_by_avatar
    FROM public.lead_activities la
    LEFT JOIN public.users u ON u.id = la.performed_by
    WHERE la.lead_id = $1 AND la.tenant_id = $2
    ORDER BY la.performed_at DESC
    LIMIT 100`,
    [id, ctx.tenantId]
  );
  
  // Get related contacts
  const relatedContacts = await queryMany<any>(
    `SELECT id, first_name, last_name, email, phone, company_id
     FROM public.contacts
     WHERE tenant_id = $1 
       AND deleted_at IS NULL
       AND (
         lower(email) = lower($2)
         OR (phone IS NOT NULL AND phone = $3)
       )
     LIMIT 5`,
    [ctx.tenantId, lead.email, lead.phone]
  );
  
  // Get team members for assignment
  const teamMembers = await queryMany<any>(
    `SELECT tm.user_id, u.full_name, u.avatar_url, u.email
     FROM public.tenant_members tm
     JOIN public.users u ON u.id = tm.user_id
     WHERE tm.tenant_id = $1 AND tm.status = 'active'
     ORDER BY u.full_name`,
    [ctx.tenantId]
  );
  
  return (
    <LeadDetailClient
      lead={lead}
      activities={activities}
      relatedContacts={relatedContacts}
      teamMembers={teamMembers}
      tenantId={ctx.tenantId}
      userId={ctx.userId}
    />
  );
}

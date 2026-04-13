import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { queryMany, queryOne } from '@/lib/db/client';
import { can } from '@/lib/auth/middleware';

/**
 * POST /api/tenant/ai/email-draft
 * Generate AI-powered email draft
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!can(ctx, 'contacts.edit')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    // Ensure tenant has the AI Assistant module installed (mirrors /api/tenant/ai/route.ts)
    const moduleInstalled = await queryOne(
      `SELECT id FROM public.tenant_modules WHERE tenant_id=$1 AND module_id='ai-assistant' AND status='active'`,
      [ctx.tenantId]
    );
    if (!moduleInstalled) {
      return NextResponse.json({ error: 'AI Assistant module not installed' }, { status: 403 });
    }

    const body = await request.json();
    const {
      contact_id,
      deal_id,
      purpose,
      tone = 'professional',
      length = 'medium',
      custom_instructions,
    } = body;

    if (!purpose) {
      return NextResponse.json({ error: 'purpose is required' }, { status: 400 });
    }

    // Get contact data
    let contactData: any = null;
    if (contact_id) {
      contactData = await queryOne(
        `SELECT c.*, co.name as company_name
         FROM public.contacts c
         LEFT JOIN public.companies co ON co.id = c.company_id
         WHERE c.id = $1 AND c.tenant_id = $2`,
        [contact_id, ctx.tenantId]
      );
    }

    // Get deal data
    let dealData: any = null;
    if (deal_id) {
      dealData = await queryOne(
        `SELECT d.*, c.first_name, c.last_name, co.name as company_name
         FROM public.deals d
         LEFT JOIN public.contacts c ON c.id = d.contact_id
         LEFT JOIN public.companies co ON co.id = d.company_id
         WHERE d.id = $1 AND d.tenant_id = $2`,
        [deal_id, ctx.tenantId]
      );
    }

    // Generate email based on purpose
    const emailTemplates: Record<string, { subject: string; body: string }> = {
      follow_up: {
        subject: `Following up{{${contactData?.first_name ? `, ${contactData.first_name}` : ''}}}`,
        body: `Hi {{first_name}},

I hope this email finds you well. I wanted to follow up on our {{last_interaction}}.

{{custom_message}}

Would you be available for a quick call this week to discuss further?

Best regards,
{{sender_name}}`,
      },
      introduction: {
        subject: `Introduction from {{sender_company}}`,
        body: `Hi {{first_name}},

I came across {{company_name}} and was impressed by {{company_achievement}}.

I help companies like yours {{value_proposition}}. I'd love to explore if there's a fit.

Are you open to a brief conversation next week?

Best,
{{sender_name}}`,
      },
      check_in: {
        subject: `Checking in{{${contactData?.first_name ? `, ${contactData.first_name}` : ''}}}`,
        body: `Hi {{first_name}},

It's been a while since we last connected. I wanted to check in and see how things are going at {{company_name}}.

{{custom_message}}

Let me know if there's anything I can help with!

Best,
{{sender_name}}`,
      },
      proposal: {
        subject: `Proposal for {{company_name}}`,
        body: `Hi {{first_name}},

Thank you for the opportunity to put together this proposal for {{company_name}}.

Based on our discussions, I believe we can help you {{value_proposition}}.

Key highlights:
- {{highlight_1}}
- {{highlight_2}}
- {{highlight_3}}

I've attached the detailed proposal. Let's schedule a time to review and answer any questions.

Looking forward to your feedback!

Best regards,
{{sender_name}}`,
      },
      closing: {
        subject: `Next steps for {{deal_name}}`,
        body: `Hi {{first_name}},

I'm excited about the opportunity to work together!

To move forward, here are the next steps:
1. {{step_1}}
2. {{step_2}}
3. {{step_3}}

Please let me know if you have any questions or concerns. I'm here to help make this process smooth.

Looking forward to partnering with you!

Best,
{{sender_name}}`,
      },
    };

    const template = emailTemplates[purpose] || emailTemplates['follow_up'];
    if (!template) {
      return NextResponse.json({ error: 'No email template found for this purpose' }, { status: 404 });
    }

    // Replace variables with actual data
    let emailSubject = template.subject;
    let emailBody = template.body;

    if (contactData) {
      emailSubject = emailSubject.replace(/{{first_name}}/g, contactData.first_name || '');
      emailBody = emailBody.replace(/{{first_name}}/g, contactData.first_name || '');
      emailBody = emailBody.replace(/{{company_name}}/g, contactData.company_name || 'your company');
    }

    // Add custom instructions if provided
    if (custom_instructions) {
      emailBody = emailBody.replace(/{{custom_message}}/g, custom_instructions);
    } else {
      emailBody = emailBody.replace(/{{custom_message}}/, '');
    }

    // Save draft
    const drafts = await queryMany<any>(
      `INSERT INTO public.ai_email_drafts
       (tenant_id, contact_id, deal_id, purpose, subject, body, tone, length, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [ctx.tenantId, contact_id || null, deal_id || null, purpose, emailSubject, emailBody, tone, length, ctx.userId]
    );
    const draft = drafts[0];

    return NextResponse.json({
      ok: true,
      draft,
      variables: {
        first_name: contactData?.first_name || '',
        company_name: contactData?.company_name || '',
        sender_name: '[Your Name]',
        sender_company: '[Your Company]',
      },
    });
  } catch (error: any) {
    console.error('[AI Email Draft] POST error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * GET /api/tenant/ai/email-drafts
 * Get email drafts
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const { searchParams } = new URL(request.url);
    const contact_id = searchParams.get('contact_id');
    const deal_id = searchParams.get('deal_id');
    const limit = parseInt(searchParams.get('limit') || '20');

    let whereClause = 'WHERE tenant_id = $1';
    let params: any[] = [ctx.tenantId];

    if (contact_id) {
      params.push(contact_id);
      whereClause += ` AND contact_id = $${params.length}`;
    }

    if (deal_id) {
      params.push(deal_id);
      whereClause += ` AND deal_id = $${params.length}`;
    }

    const drafts = await queryMany(
      `SELECT d.*, c.first_name, c.last_name, c.email
       FROM public.ai_email_drafts d
       LEFT JOIN public.contacts c ON c.id = d.contact_id
       ${whereClause}
       ORDER BY d.created_at DESC
       LIMIT $${params.length + 1}`,
      [...params, limit]
    );

    return NextResponse.json({
      data: drafts,
    });
  } catch (error: any) {
    console.error('[AI Email Drafts] GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

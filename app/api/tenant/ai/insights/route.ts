import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { queryMany, queryOne } from '@/lib/db/client';
import { can } from '@/lib/auth/middleware';

/**
 * POST /api/tenant/ai/insights
 * Generate AI insights for a contact/deal
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!can(ctx, 'contacts.view_all')) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    const body = await request.json();
    const { entity_type, entity_id } = body;

    if (!entity_type || !entity_id) {
      return NextResponse.json({ 
        error: 'entity_type and entity_id are required' 
      }, { status: 400 });
    }

    // Get entity data
    let entityData: any;
    if (entity_type === 'contact') {
      entityData = await queryOne(
        `SELECT c.*, 
                (SELECT count(*) FROM public.activities WHERE contact_id = c.id) as activity_count,
                (SELECT count(*) FROM public.activities WHERE contact_id = c.id AND created_at > now() - interval '30 days') as recent_activity_count
         FROM public.contacts c
         WHERE c.id = $1 AND c.tenant_id = $2`,
        [entity_id, ctx.tenantId]
      );
    } else if (entity_type === 'deal') {
      entityData = await queryOne(
        `SELECT d.*, 
                (SELECT count(*) FROM public.activities WHERE deal_id = d.id) as activity_count
         FROM public.deals d
         WHERE d.id = $1 AND d.tenant_id = $2`,
        [entity_id, ctx.tenantId]
      );
    } else {
      return NextResponse.json({ error: 'Invalid entity_type' }, { status: 400 });
    }

    if (!entityData) {
      return NextResponse.json({ error: 'Entity not found' }, { status: 404 });
    }

    // Generate insights based on data
    const insights: any[] = [];

    // Engagement insight
    if (entityData.recent_activity_count > 10) {
      insights.push({
        insight_type: 'engagement',
        title: 'High Engagement Detected',
        description: `This ${entity_type} has ${entityData.recent_activity_count} activities in the last 30 days. Consider reaching out while they're engaged.`,
        confidence_score: 85,
        priority: 'high',
      });
    }

    // Follow-up insight
    const lastActivity = await queryOne(
      `SELECT created_at FROM public.activities 
       WHERE ${entity_type}_id = $1 
       ORDER BY created_at DESC LIMIT 1`,
      [entity_id]
    );

    if (lastActivity?.created_at) {
      const daysSinceLastActivity = Math.floor(
        (Date.now() - new Date(lastActivity.created_at).getTime()) / (1000 * 60 * 60 * 24)
      );

      if (daysSinceLastActivity > 14) {
        insights.push({
          insight_type: 'follow_up',
          title: 'Follow-up Needed',
          description: `No activity in ${daysSinceLastActivity} days. Consider reaching out to re-engage.`,
          confidence_score: 90,
          priority: 'medium',
        });
      }
    }

    // Lifecycle insight
    if (entity_type === 'contact' && entityData.lifecycle_stage === 'lead') {
      insights.push({
        insight_type: 'opportunity',
        title: 'Nurture Opportunity',
        description: 'This lead hasn\'t progressed to qualified stage. Consider a nurturing campaign or direct outreach.',
        confidence_score: 70,
        priority: 'medium',
      });
    }

    // Save insights to database
    const savedInsights = [];
    for (const insight of insights) {
      const savedRows = await queryMany<any>(
        `INSERT INTO public.ai_insights
         (tenant_id, entity_type, entity_id, insight_type, title, description, confidence_score, priority)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [ctx.tenantId, entity_type, entity_id, insight.insight_type, insight.title, insight.description, insight.confidence_score, insight.priority]
      );
      const saved = savedRows[0];
      savedInsights.push(saved);
    }

    return NextResponse.json({
      ok: true,
      insights: savedInsights,
      entity: entityData,
    });
  } catch (error: any) {
    console.error('[AI Insights] POST error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * GET /api/tenant/ai/insights
 * Get AI insights
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const { searchParams } = new URL(request.url);
    const entity_type = searchParams.get('entity_type');
    const entity_id = searchParams.get('entity_id');
    const unread_only = searchParams.get('unread_only') === 'true';

    let whereClause = 'WHERE tenant_id = $1';
    let params: any[] = [ctx.tenantId];

    if (entity_type && entity_id) {
      params.push(entity_type, entity_id);
      whereClause += ` AND entity_type = $${params.length - 1} AND entity_id = $${params.length}`;
    }

    if (unread_only) {
      whereClause += ' AND is_read = false';
    }

    const insights = await queryMany(
      `SELECT id, tenant_id, insight_type, description, confidence, entity_id, entity_type, created_at FROM public.ai_insights ${whereClause} ORDER BY 
        CASE priority 
          WHEN 'urgent' THEN 1 
          WHEN 'high' THEN 2 
          WHEN 'medium' THEN 3 
          ELSE 4 
        END,
        created_at DESC
        LIMIT 50`,
      params
    );

    return NextResponse.json({
      data: insights,
    });
  } catch (error: any) {
    console.error('[AI Insights] GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

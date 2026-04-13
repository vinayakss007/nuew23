import { queryOne, queryMany } from '@/lib/db/client';

/**
 * Shared AI Utilities — Token Control & Usage Tracking
 * 
 * Every AI module MUST call checkTokenAndLimits() before making an API call
 * and recordUsage() after the call completes.
 * 
 * This ensures:
 *   - Global budgets are respected
 *   - Tenant limits are enforced
 *   - User limits are enforced
 *   - Anomalies are detected
 *   - Usage is tracked for billing
 *   - Alerts are triggered when thresholds are crossed
 */

// ── Token Check ──────────────────────────────────────────────────────────────

export interface TokenCheckResult {
  allowed: boolean;
  reason?: string;
  remaining?: {
    tenant_monthly?: number;
    user_daily?: number;
    global_budget?: number;
  };
}

/**
 * Check if an AI call is allowed before making it.
 * Call this BEFORE any OpenAI/WhatsApp/Voice API call.
 * 
 * @param tenantId - The tenant making the request
 * @param userId - The user making the request
 * @param module - Which AI module ('lead_scoring', 'whatsapp', 'voice', etc.)
 * @param service - Which external service ('openai', 'whatsapp', 'twilio', etc.)
 * @param estimatedCostCents - Estimated cost of this call (in paise)
 */
export async function checkTokenAndLimits(
  tenantId: string,
  userId: string,
  module: string,
  service: string,
  estimatedCostCents: number
): Promise<TokenCheckResult> {

  // 1. Check global budget
  const globalBudget = await getGlobalBudget(service);
  if (globalBudget.hard_cap_enabled && globalBudget.monthly_budget_cents > 0) {
    if (globalBudget.current_month_cents >= globalBudget.monthly_budget_cents) {
      return { allowed: false, reason: 'PLATFORM_BUDGET_EXHAUSTED' };
    }
    // Check soft cap alerts
    const pctUsed = (globalBudget.current_month_cents / globalBudget.monthly_budget_cents) * 100;
    if (pctUsed >= 100 && globalBudget.alert_at_100pct) {
      await createAlert({
        alert_type: 'budget_100',
        target_type: 'platform',
        service,
        current_value: globalBudget.current_month_cents,
        threshold_value: globalBudget.monthly_budget_cents,
        message: `${service} budget exhausted (${formatCurrency(globalBudget.current_month_cents)}/${formatCurrency(globalBudget.monthly_budget_cents)})`,
      });
    } else if (pctUsed >= 80 && globalBudget.alert_at_80pct) {
      // Only alert once per threshold crossing
      await checkAndAlertThreshold('platform', null, service, 'budget_80', globalBudget.current_month_cents, globalBudget.monthly_budget_cents);
    }
  }

  // 2. Check tenant limits
  const tenantLimits = await getTenantLimits(tenantId);
  if (tenantLimits) {
    const usage = await getTenantUsage(tenantId, module);
    const limit = getLimitForModule(tenantLimits, module);

    if (limit >= 0 && usage.monthly_count >= limit) {
      return {
        allowed: false,
        reason: 'TENANT_LIMIT_EXCEEDED',
        remaining: { tenant_monthly: 0 },
      };
    }

    // Check total monthly cost limit
    if (tenantLimits.total_monthly_cost >= 0 && usage.monthly_cost_cents >= tenantLimits.total_monthly_cost) {
      return {
        allowed: false,
        reason: 'TENANT_COST_LIMIT_EXCEEDED',
        remaining: { tenant_monthly: 0 },
      };
    }

    // Alert at 80% of tenant limit
    if (limit >= 0) {
      const pctUsed = (usage.monthly_count / limit) * 100;
      if (pctUsed >= 80 && pctUsed < 85) { // Alert once around 80%
        await checkAndAlertThreshold('tenant', tenantId, module, 'tenant_80', usage.monthly_count, limit);
      }
      if (pctUsed >= 100 && tenantLimits.hard_cap_action === 'alert_only') {
        await createAlert({
          alert_type: 'tenant_limit_hit',
          target_type: 'tenant',
          target_id: tenantId,
          service: module,
          current_value: usage.monthly_count,
          threshold_value: limit,
          message: `Tenant hit ${module} limit: ${usage.monthly_count}/${limit}. Action: ${tenantLimits.hard_cap_action}`,
        });
      }
    }
  }

  // 3. Check user limits
  const userLimits = await getUserLimits(tenantId, userId, module);
  if (userLimits) {
    const dailyUsage = await getUserDailyUsage(tenantId, userId, module);
    if (userLimits.daily_limit >= 0 && dailyUsage.count >= userLimits.daily_limit) {
      return {
        allowed: false,
        reason: 'USER_DAILY_LIMIT_EXCEEDED',
        remaining: { user_daily: 0 },
      };
    }

    if (userLimits.max_cost_per_call >= 0 && estimatedCostCents > userLimits.max_cost_per_call) {
      return {
        allowed: false,
        reason: 'CALL_TOO_EXPENSIVE',
      };
    }
  }

  // All checks passed
  const tenantRemaining = tenantLimits ? getLimitForModule(tenantLimits, module) - (await getTenantUsage(tenantId, module)).monthly_count : undefined;

  return {
    allowed: true,
    remaining: {
      tenant_monthly: tenantRemaining !== undefined && tenantRemaining >= 0 ? tenantRemaining : undefined,
      global_budget: globalBudget.monthly_budget_cents > 0
        ? globalBudget.monthly_budget_cents - globalBudget.current_month_cents
        : undefined,
    },
  };
}

// ── Usage Recording ──────────────────────────────────────────────────────────

/**
 * Record usage AFTER a successful AI API call.
 * Call this with the ACTUAL cost (not estimated).
 */
export async function recordUsage(
  tenantId: string,
  userId: string,
  module: string,
  service: string,
  actualCostCents: number,
  tokensUsed: number = 0,
  responseData?: any
) {
  // 1. Update global budget
  await queryMany(
    `UPDATE token_budgets SET 
       current_month_cents = current_month_cents + $1,
       updated_at = NOW()
     WHERE service = $2 AND billing_period = TO_CHAR(NOW(), 'YYYY-MM')`,
    [actualCostCents, service]
  );

  // 2. Update tenant usage
  await queryMany(
    `INSERT INTO ai_usage_aggregated (tenant_id, module_name, billing_period, count, tokens_used, cost_cents)
     VALUES ($1, $2, TO_CHAR(NOW(), 'YYYY-MM'), 1, $3, $4)
     ON CONFLICT (tenant_id, module_name, billing_period) DO UPDATE SET
       count = ai_usage_aggregated.count + 1,
       tokens_used = ai_usage_aggregated.tokens_used + $3,
       cost_cents = ai_usage_aggregated.cost_cents + $4,
       updated_at = NOW()`,
    [tenantId, module, tokensUsed, actualCostCents]
  );

  // 3. Update api_keys_registry current spend
  await queryMany(
    `UPDATE api_keys_registry SET 
       current_month_cents = current_month_cents + $1,
       last_used_at = NOW(),
       updated_at = NOW()
     WHERE service = $2 AND is_primary = true AND is_active = true`,
    [actualCostCents, service]
  );

  // 4. Log individual call
  await queryMany(
    `INSERT INTO ai_usage_logs (tenant_id, user_id, module, service, tokens_used, cost_cents, response_summary, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
    [tenantId, userId, module, service, tokensUsed, actualCostCents,
     responseData ? JSON.stringify(responseData).substring(0, 500) : null]
  );
}

// ── Anomaly Detection ────────────────────────────────────────────────────────

/**
 * Check if today's spending is unusually high for this tenant.
 * Call after recording usage.
 */
export async function checkForAnomaly(
  tenantId: string,
  service: string,
  costCents: number
): Promise<{ anomaly: boolean; severity: 'low' | 'medium' | 'high' } | null> {
  // Get average daily spend for this tenant over last 7 days
  const avgResult = await queryOne(
    `SELECT COALESCE(AVG(daily_cost), 0) as avg_daily
     FROM (
       SELECT SUM(cost_cents) as daily_cost
       FROM ai_usage_logs
       WHERE tenant_id = $1 AND service = $2
         AND created_at > NOW() - INTERVAL '7 days'
         AND created_at < NOW() - INTERVAL '1 day'
       GROUP BY DATE(created_at)
     ) daily`,
    [tenantId, service]
  );

  const avgDaily = Number(avgResult?.avg_daily || 0);
  if (avgDaily === 0) return null; // No history yet

  const todaySoFar = await queryOne(
    `SELECT SUM(cost_cents) as today_total
     FROM ai_usage_logs
     WHERE tenant_id = $1 AND service = $2
       AND created_at > NOW()::date`,
    [tenantId, service]
  );

  const todayTotal = Number(todaySoFar?.today_total || 0);
  const deviation = avgDaily > 0 ? ((todayTotal - avgDaily) / avgDaily) * 100 : 0;

  if (deviation > 500) {
    // More than 5x normal — HIGH severity
    await queryMany(
      `INSERT INTO cost_anomalies (tenant_id, service, expected_daily_cents, actual_daily_cents, deviation_pct, suspected_cause, action_taken)
       VALUES ($1, $2, $3, $4, $5, 'bulk_usage', 'alerted')`,
      [tenantId, service, Math.round(avgDaily), todayTotal, Math.round(deviation)]
    );

    await createAlert({
      alert_type: 'spike_detected',
      target_type: 'tenant',
      target_id: tenantId,
      service,
      current_value: todayTotal,
      threshold_value: Math.round(avgDaily),
      message: `${service} spending ${deviation.toFixed(0)}% above average (₹${formatCurrency(todayTotal)} vs ₹${formatCurrency(Math.round(avgDaily))})`,
    });

    return { anomaly: true, severity: 'high' };
  }

  if (deviation > 200) {
    // More than 2x normal — MEDIUM severity
    await queryMany(
      `INSERT INTO cost_anomalies (tenant_id, service, expected_daily_cents, actual_daily_cents, deviation_pct, suspected_cause)
       VALUES ($1, $2, $3, $4, $5, 'elevated_usage')`,
      [tenantId, service, Math.round(avgDaily), todayTotal, Math.round(deviation)]
    );

    return { anomaly: true, severity: 'medium' };
  }

  return null;
}

// ── Helper Functions ─────────────────────────────────────────────────────────

async function getGlobalBudget(service: string) {
  const result = await queryOne(
    `SELECT * FROM token_budgets 
     WHERE service = $1 AND billing_period = TO_CHAR(NOW(), 'YYYY-MM')`,
    [service]
  );
  return result || {
    service,
    monthly_budget_cents: 0,
    current_month_cents: 0,
    hard_cap_enabled: true,
    alert_at_50pct: true,
    alert_at_80pct: true,
    alert_at_100pct: true,
  };
}

async function getTenantLimits(tenantId: string) {
  return queryOne(
    `SELECT * FROM tenant_token_limits WHERE tenant_id = $1`,
    [tenantId]
  );
}

async function getTenantUsage(tenantId: string, module: string) {
  const result = await queryOne(
    `SELECT COALESCE(count, 0) as monthly_count, COALESCE(cost_cents, 0) as monthly_cost_cents
     FROM ai_usage_aggregated
     WHERE tenant_id = $1 AND module_name = $2 AND billing_period = TO_CHAR(NOW(), 'YYYY-MM')`,
    [tenantId, module]
  );
  return result || { monthly_count: 0, monthly_cost_cents: 0 };
}

function getLimitForModule(limits: any, module: string): number {
  const map: Record<string, number> = {
    'lead_scoring': limits.score_monthly_cnt,
    'revenue_agent': limits.followup_monthly_cnt,
    'whatsapp_agent': limits.whatsapp_monthly_msgs,
    'voice_agent': limits.voice_monthly_mins,
    'content_gen': limits.content_monthly_gen,
    'proposals': limits.proposal_monthly_gen,
  };
  return map[module] ?? -1;
}

async function getUserLimits(tenantId: string, userId: string, module: string) {
  return queryOne(
    `SELECT * FROM user_token_limits 
     WHERE tenant_id = $1 AND user_id = $2 AND module = $3`,
    [tenantId, userId, module]
  );
}

async function getUserDailyUsage(tenantId: string, userId: string, module: string) {
  const result = await queryOne(
    `SELECT COUNT(*) as count
     FROM ai_usage_logs
     WHERE tenant_id = $1 AND user_id = $2 AND module = $3
       AND created_at > NOW()::date`,
    [tenantId, userId, module]
  );
  return result || { count: 0 };
}

async function createAlert(data: {
  alert_type: string;
  target_type: string;
  target_id?: string;
  service?: string;
  current_value?: number;
  threshold_value?: number;
  message: string;
}) {
  // Check if similar alert was created in last hour (avoid spam)
  const existing = await queryOne(
    `SELECT id FROM usage_alerts 
     WHERE alert_type = $1 AND target_type = $2 AND target_id = $3
       AND created_at > NOW() - INTERVAL '1 hour'`,
    [data.alert_type, data.target_type, data.target_id || null]
  );

  if (existing) return; // Already alerted

  await queryMany(
    `INSERT INTO usage_alerts (alert_type, target_type, target_id, service, current_value, threshold_value, message, notification_sent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'in_app')`,
    [data.alert_type, data.target_type, data.target_id || null, data.service || null,
     data.current_value || null, data.threshold_value || null, data.message]
  );
}

async function checkAndAlertThreshold(
  targetType: string,
  targetId: string | null,
  service: string,
  alertType: string,
  currentValue: number,
  thresholdValue: number
) {
  const existing = await queryOne(
    `SELECT id FROM usage_alerts 
     WHERE alert_type = $1 AND target_type = $2 AND target_id = $3
       AND created_at > NOW() - INTERVAL '6 hours'`,
    [alertType, targetType, targetId]
  );

  if (!existing) {
    await createAlert({
      alert_type: alertType,
      target_type: targetType,
      target_id: targetId || undefined,
      service,
      current_value: currentValue,
      threshold_value: thresholdValue,
      message: `${targetType} ${targetId || 'platform'} reached ${((currentValue / thresholdValue) * 100).toFixed(0)}% of ${service} limit`,
    });
  }
}

function formatCurrency(cents: number): string {
  return `₹${(cents / 100).toLocaleString('en-IN')}`;
}

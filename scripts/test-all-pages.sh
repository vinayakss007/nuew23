#!/bin/bash
# NuCRM Page Tester - hits every route and checks for errors

BASE="http://localhost:3000"
ERRORS=0
OK=0
SKIPPED=0

echo "🧪 NuCRM Page-by-Page Test"
echo "=========================="

# Clear old logs
docker compose logs --tail=0 >/dev/null 2>&1

test_page() {
  local url="$1"
  local name="$2"
  local expect_redirect="$3"
  
  local status=$(curl -s -o /dev/null -w "%{http_code}" "$BASE$url" 2>/dev/null)
  
  # Give time for any server-side rendering
  sleep 0.5
  
  # Check logs for errors
  local errs=$(docker compose logs app --tail=5 2>&1 | grep -i "error\|exception\|failed" | grep -v "DEPRECATION" | grep -v "⚠" | wc -l)
  
  if [ "$status" = "200" ] && [ "$errs" -eq 0 ]; then
    echo "✅ $url ($name)"
    OK=$((OK+1))
  elif [ "$status" = "200" ] && [ "$errs" -gt 0 ]; then
    echo "⚠️  $url ($name) - 200 but has warnings/errors in logs"
    docker compose logs app --tail=3 2>&1 | grep -i "error\|exception\|failed" | grep -v "DEPRECATION" | head -1
    ERRORS=$((ERRORS+1))
  elif [ "$status" = "307" ] || [ "$status" = "302" ]; then
    if [ "$expect_redirect" = "true" ]; then
      echo "✅ $url ($name) - redirects as expected ($status)"
      OK=$((OK+1))
    else
      echo "🔀 $url ($name) - redirect ($status), may need auth"
      SKIPPED=$((SKIPPED+1))
    fi
  elif [ "$status" = "404" ]; then
    echo "❌ $url ($name) - 404 NOT FOUND"
    ERRORS=$((ERRORS+1))
  elif [ "$status" = "500" ]; then
    echo "💥 $url ($name) - 500 SERVER ERROR"
    docker compose logs app --tail=5 2>&1 | grep -i "error\|exception" | tail -2
    ERRORS=$((ERRORS+1))
  else
    echo "❓ $url ($name) - HTTP $status"
    SKIPPED=$((SKIPPED+1))
  fi
}

# ── Public Pages ──
echo -e "\n📄 Public Pages:"
test_page "/" "Landing" "true"
test_page "/health" "Health Check" "true"
test_page "/docs" "Docs" "true"
test_page "/setup" "Setup Wizard" "true"
test_page "/auth/login" "Login" "true"
test_page "/auth/signup" "Signup" "true"
test_page "/auth/forgot-password" "Forgot Password" "true"

# ── Tenant Pages (require auth - expect redirects) ──
echo -e "\n🏢 Tenant Pages (auth required):"
test_page "/tenant/dashboard" "Tenant Dashboard" "true"
test_page "/tenant/contacts" "Contacts List" "true"
test_page "/tenant/companies" "Companies List" "true"
test_page "/tenant/deals" "Deals Pipeline" "true"
test_page "/tenant/tasks" "Tasks" "true"
test_page "/tenant/leads" "Leads" "true"
test_page "/tenant/analytics" "Analytics" "true"
test_page "/tenant/calendar" "Calendar" "true"
test_page "/tenant/automation" "Automation" "true"
test_page "/tenant/automation/sequences" "Sequences" "true"
test_page "/tenant/reports" "Reports" "true"
test_page "/tenant/search" "Search" "true"
test_page "/tenant/notifications" "Notifications" "true"
test_page "/tenant/modules" "Modules" "true"
test_page "/tenant/forms" "Forms" "true"
test_page "/tenant/sequences" "Sequences (alt)" "true"
test_page "/tenant/email-templates" "Email Templates" "true"
test_page "/tenant/trash" "Trash" "true"
test_page "/tenant/trial-expired" "Trial Expired" "true"

# ── Tenant Settings ──
echo -e "\n⚙️  Tenant Settings:"
test_page "/tenant/settings/general" "Settings: General" "true"
test_page "/tenant/settings/profile" "Settings: Profile" "true"
test_page "/tenant/settings/team" "Settings: Team" "true"
test_page "/tenant/settings/roles" "Settings: Roles" "true"
test_page "/tenant/settings/billing" "Settings: Billing" "true"
test_page "/tenant/settings/pipelines" "Settings: Pipelines" "true"
test_page "/tenant/settings/security" "Settings: Security" "true"
test_page "/tenant/settings/sessions" "Settings: Sessions" "true"
test_page "/tenant/settings/api-keys" "Settings: API Keys" "true"
test_page "/tenant/settings/audit" "Settings: Audit" "true"
test_page "/tenant/settings/webhooks" "Settings: Webhooks" "true"
test_page "/tenant/settings/integrations" "Settings: Integrations" "true"
test_page "/tenant/settings/email" "Settings: Email" "true"
test_page "/tenant/settings/custom-fields" "Settings: Custom Fields" "true"
test_page "/tenant/settings/backup" "Settings: Backup" "true"
test_page "/tenant/settings/telegram" "Settings: Telegram" "true"
test_page "/tenant/settings/admin" "Settings: Admin" "true"

# ── Tenant Integrations ──
echo -e "\n🔗 Tenant Integrations:"
test_page "/tenant/integrations/webhooks" "Webhooks" "true"
test_page "/tenant/integrations/connected" "Connected Apps" "true"

# ── Superadmin Pages ──
echo -e "\n👑 Superadmin Pages (auth required):"
test_page "/superadmin/dashboard" "Superadmin Dashboard" "true"
test_page "/superadmin/tenants" "Tenants Management" "true"
test_page "/superadmin/users" "Users" "true"
test_page "/superadmin/analytics" "Analytics" "true"
test_page "/superadmin/usage" "Usage" "true"
test_page "/superadmin/billing" "Billing" "true"
test_page "/superadmin/revenue" "Revenue" "true"
test_page "/superadmin/monitoring" "Monitoring" "true"
test_page "/superadmin/health" "Health" "true"
test_page "/superadmin/backups" "Backups" "true"
test_page "/superadmin/errors" "Errors" "true"
test_page "/superadmin/tickets" "Tickets" "true"
test_page "/superadmin/announcements" "Announcements" "true"
test_page "/superadmin/modules" "Modules" "true"
test_page "/superadmin/settings" "Settings" "true"
test_page "/superadmin/token-control" "Token Control" "true"
test_page "/superadmin/data-explorer" "Data Explorer" "true"

# ── API Endpoints ──
echo -e "\n🔌 API Endpoints:"
test_page "/api/health" "Health API" "true"

echo -e "\n=========================="
echo "✅ OK: $OK"
echo "❌ Errors: $ERRORS"
echo "🔀 Skipped/Redirects: $SKIPPED"
echo "Total: $((OK + ERRORS + SKIPPED))"

if [ $ERRORS -gt 0 ]; then
  echo -e "\n🔍 Error details from logs:"
  docker compose logs app --tail=30 2>&1 | grep -i "error\|exception\|failed" | grep -v "DEPRECATION" | grep -v "⚠" | tail -10
fi

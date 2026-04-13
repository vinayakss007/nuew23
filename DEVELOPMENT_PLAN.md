# NuCRM — Detailed Development Plan

> Created: April 10, 2026
> Rule: Fix one thing → Test → Commit → Next fix. NEVER batch changes.

---

## STATUS TRACKER

| Phase | Status | Progress |
|-------|--------|----------|
| Phase 1: Deal Form Fix | ✅ Done | 2/2 |
| Phase 2: Task Form Fix | ✅ Done | 2/2 |
| Phase 3: Deal Detail Page | ✅ Done | 2/2 |
| Phase 4: Task Detail Page | ✅ Done | 1/1 |
| Phase 5: Links & Navigation | ⬜ Not Started | 0/14 |
| Phase 6: Form Polish | ⬜ Not Started | 0/7 |
| Phase 7: Audit Logs Fix | ✅ Done | 1/1 |
| Phase 12: Calendar Fix — tasks clickable, improved layout | ✅ Done |
| Phase 13: Reports — 7 types, category filter, CSV export | ✅ Done |
| Phase 14: Analytics API — forecast, funnel, team performance | ✅ Done | 1/1 |

---

## PHASE 1: Deal Form Fix (CRITICAL)

### Fix 1.1: Add Contact, Company, Assigned To dropdowns to Deal creation form
- **File:** `components/tenant/deals-data-table.tsx`
- **Problem:** Form state has `contact_id`, `company_id`, `assigned_to` but form only renders Title/Value/Stage/Close Date
- **Fix:** Add 3 `<select>` elements using `contacts`, `companies`, `teamMembers` props
- **Risk:** Low — only adds new form fields, doesn't change existing ones
- **Test:** Open /tenant/deals → Add Deal → verify dropdowns appear with data

### Fix 1.2: Make deal detail link work (create page)
- **File:** `app/tenant/deals/[id]/page.tsx` (NEW)
- **Fix:** Create deal detail page similar to lead detail page
- **Test:** Click deal name → see full detail

---

## PHASE 2: Task Form Fix (CRITICAL)

### Fix 2.1: Add Contact, Deal, Assigned To dropdowns to Task creation form
- **File:** `components/tenant/tasks-data-table.tsx`
- **Problem:** Form state has `contact_id`, `deal_id`, `assigned_to` but form only renders Title/Description/Priority/Due Date
- **Fix:** Add 3 `<select>` elements using `contacts`, `deals`, `teamMembers` props
- **Risk:** Low — only adds new form fields
- **Test:** Open /tenant/tasks → Add Task → verify dropdowns appear

---

## PHASE 3: Deal Detail Page (MEDIUM)

### Fix 3.1: Create /tenant/deals/[id]/page.tsx
- **File:** NEW
- **Shows:** Deal info, activities timeline, related contact, related tasks, notes
- **Test:** Click deal → see all details

---

## PHASE 4: Task Detail Page (MEDIUM)

### Fix 4.1: Create /tenant/tasks/[id]/page.tsx
- **File:** NEW
- **Shows:** Task info, mark complete, related contact/deal
- **Test:** Click task → see all details

---

## PHASE 5: Links & Navigation (HIGH)

### Fix 5.1: DealsDataTable — Contact name clickable
- **File:** `components/tenant/deals-data-table.tsx`
- **Fix:** Wrap contact_name in `<Link href="/tenant/contacts/${contact_id}">`

### Fix 5.2: DealsDataTable — Company name clickable
- **File:** `components/tenant/deals-data-table.tsx`
- **Fix:** Wrap company_name in `<Link href="/tenant/companies/${company_id}">`

### Fix 5.3: DealsDataTable — Deal title clickable
- **File:** `components/tenant/deals-data-table.tsx`
- **Fix:** Wrap title in `<Link href="/tenant/deals/${id}">`

### Fix 5.4: ContactsDataTable — Contact name clickable
- **File:** `components/tenant/contacts-data-table.tsx`
- **Fix:** Wrap name in `<Link href="/tenant/contacts/${id}">`

### Fix 5.5: ContactsDataTable — Company name clickable
- **File:** `components/tenant/contacts-data-table.tsx`
- **Fix:** Wrap in `<Link href="/tenant/companies/${company_id}">`

### Fix 5.6: ContactsDataTable — Email mailto link
- **File:** `components/tenant/contacts-data-table.tsx`
- **Fix:** Wrap in `<a href="mailto:...">`

### Fix 5.7: ContactsDataTable — Phone tel link
- **File:** `components/tenant/contacts-data-table.tsx`
- **Fix:** Wrap in `<a href="tel:...">`

### Fix 5.8: TasksDataTable — Contact name clickable
- **File:** `components/tenant/tasks-data-table.tsx`
- **Fix:** Wrap in `<Link href="/tenant/contacts/${contact_id}">`

### Fix 5.9: TasksDataTable — Task title clickable
- **File:** `components/tenant/tasks-data-table.tsx`
- **Fix:** Wrap in `<Link href="/tenant/tasks/${id}">`

### Fix 5.10: Company detail — Deals clickable
- **File:** `app/tenant/companies/[id]/page.tsx`
- **Fix:** Wrap in `<Link href="/tenant/deals/${id}">`

### Fix 5.11: Company detail — Add buttons on empty state
- **File:** `app/tenant/companies/[id]/page.tsx`
- **Fix:** Add "Add Lead" and "Add Contact" links when empty

### Fix 5.12: Lead detail — Company name clickable
- **File:** `components/tenant/lead-detail-client.tsx`
- **Fix:** Wrap in `<Link href="/tenant/companies?search=...">`

### Fix 5.13: Lead detail — Add Activity button works
- **File:** `components/tenant/lead-detail-client.tsx`
- **Fix:** Add onClick handler with form

### Fix 5.14: Lead detail — Add Note button works
- **File:** `components/tenant/lead-detail-client.tsx`
- **Fix:** Add onClick handler with form

---

## PHASE 6: Form Polish (LOW)

### Fix 6.1: Leads form — Use company_id instead of company_name
- **File:** `components/tenant/leads-client-new.tsx`
- **Fix:** Change form field and API to use company_id FK

### Fix 6.2: Company industry dropdown
- **File:** `components/tenant/companies-data-table.tsx`, `components/tenant/companies-client.tsx`
- **Fix:** Change text input to `<select>` with predefined options

### Fix 6.3: Lead capture form — Fix field names
- **File:** `components/shared/lead-capture-form.tsx`
- **Fix:** `company` → `company_name`, `source` → `lead_source`

### Fix 6.4: Lead source dropdown default
- **File:** `components/tenant/leads-client-new.tsx`
- **Fix:** Add `<option value="">Select source...</option>`

### Fix 6.5: Task priority default
- **File:** `components/tenant/tasks-data-table.tsx`
- **Fix:** Add "Select priority" option or default to Medium

### Fix 6.6: Deal value placeholder
- **File:** `components/tenant/deals-data-table.tsx`
- **Fix:** Change placeholder to "0" with currency indicator

### Fix 6.7: Companies API — Add deal stats
- **File:** `app/api/tenant/companies/route.ts`
- **Fix:** Add deal_count and pipeline_value subqueries

---

## TESTING CHECKLIST (After EVERY fix)

```
□ docker compose ps          → All containers healthy/running
□ docker logs nucrm-app      → No SQL errors (column/table missing)
□ curl /api/health           → {"status":"ok"}
□ /tenant/contacts           → Page loads, no "Something went wrong"
□ /tenant/leads              → Page loads, no errors
□ /tenant/companies          → Page loads, company names clickable
□ /tenant/deals              → Page loads
□ /tenant/tasks              → Page loads
```

# NuCRM UX/Workflow Improvements — Master TODO List

> Generated: April 10, 2026
> Status: Unresolved issues that break or degrade user experience

---

## 🔴 CRITICAL — Forms Missing Dropdowns

| # | File | Issue | Fix |
|---|------|-------|-----|
| 1 | `components/tenant/deals-data-table.tsx` | Add Deal form has **NO** Contact, Company, Assigned To dropdowns — props available but unused | Add 3 `<select>` elements using `contacts`, `companies`, `teamMembers` props |
| 2 | `components/tenant/tasks-data-table.tsx` | Add Task form has **NO** Contact, Deal, Assigned To dropdowns — props available but unused | Add 3 `<select>` elements using `contacts`, `deals`, `teamMembers` props |
| 3 | `components/tenant/leads-client-new.tsx` | Lead form uses `company_name` (text value) instead of `company_id` (FK) | Change form field to `company_id`, option values to `c.id` |
| 4 | `components/tenant/companies-data-table.tsx` | Industry is free-text input → inconsistent data ("Tech" vs "Technology") | Change to `<select>` with predefined industry options |
| 5 | `components/tenant/companies-client.tsx` | Industry is free-text input | Same as #4 |
| 6 | `components/shared/lead-capture-form.tsx` | Sends `company` field but API expects `company_name` | Rename field to `company_name` |
| 7 | `components/shared/lead-capture-form.tsx` | Sends `source` but API expects `lead_source` | Rename to `lead_source` |

---

## 🟠 HIGH — Missing Navigation Links

| # | File | Issue | Fix |
|---|------|-------|-----|
| 8 | `components/tenant/deals-data-table.tsx` | Contact name is plain text, not a link | Wrap in `<Link href="/tenant/contacts/${contact_id}">` |
| 9 | `components/tenant/deals-data-table.tsx` | Company name is plain text, not a link | Wrap in `<Link href="/tenant/companies/${company_id}">` |
| 10 | `components/tenant/deals-data-table.tsx` | Deal title is plain text, not a link | Wrap in `<Link>` to deal detail |
| 11 | `components/tenant/contacts-data-table.tsx` | Contact name is not a link to detail | Wrap in `<Link href="/tenant/contacts/${id}">` |
| 12 | `components/tenant/contacts-data-table.tsx` | Company name is plain text | Wrap in `<Link href="/tenant/companies/${company_id}">` |
| 13 | `components/tenant/contacts-data-table.tsx` | Email is plain text, not clickable | Change to `<a href="mailto:">` |
| 14 | `components/tenant/contacts-data-table.tsx` | Phone is plain text, not clickable | Change to `<a href="tel:">` |
| 15 | `components/tenant/tasks-data-table.tsx` | Contact name in "Related To" is plain text | Wrap in `<Link>` to contact |
| 16 | `components/tenant/tasks-data-table.tsx` | Task title is not a link to detail | Wrap in `<Link>` or add click handler |
| 17 | `app/tenant/companies/[id]/page.tsx` | Deals in company detail are not clickable | Wrap in `<Link>` to deal detail |
| 18 | `app/tenant/companies/[id]/page.tsx` | "No leads" / "No contacts" empty states have no action buttons | Add "Add Lead" / "Add Contact" links |
| 19 | `components/tenant/lead-detail-client.tsx` | Company name is plain text, not a link | Wrap in `<Link>` (match by company_name) |
| 20 | `components/tenant/lead-detail-client.tsx` | "Add Activity" button does nothing | Add modal or inline form |
| 21 | `components/tenant/lead-detail-client.tsx` | "Add Note" button does nothing | Add modal or inline form |

---

## 🟡 MEDIUM — Missing Detail Pages

| # | File | Issue | Fix |
|---|------|-------|-----|
| 22 | `app/tenant/deals/[id]/page.tsx` | **Does not exist** — no deal detail page anywhere | Create full deal detail page with activities, tasks, contact info |
| 23 | `app/tenant/tasks/[id]/page.tsx` | **Does not exist** — no task detail page anywhere | Create task detail page |

---

## 🟢 LOW — UX Polish

| # | File | Issue | Fix |
|---|------|-------|-----|
| 24 | `components/tenant/leads-client-new.tsx` | Lead Source dropdown defaults to "Website" with no "Select..." option | Add `<option value="">Select source...</option>` |
| 25 | `components/tenant/tasks-data-table.tsx` | Priority select defaults to "Low" silently | Change default to "Medium" or add "Select priority" option |
| 26 | `components/tenant/deals-data-table.tsx` | Deal value placeholder "50000" is confusing | Change to "0" or "Enter amount" with currency indicator |
| 27 | `app/api/tenant/companies/route.ts` | Companies list API missing `deal_count` and `pipeline_value` | Add subqueries for deal stats |
| 28 | `app/api/tenant/leads/route.ts` | Leads store `company_name` as string, not `company_id` FK | Add `company_id` column + JOIN to companies table |

---

## ✅ ALREADY FIXED

| # | Issue | Status |
|---|-------|--------|
| F1 | Company names not clickable in companies list | ✅ Fixed — added `<Link>` to name |
| F2 | Company detail page missing leads section | ✅ Fixed — shows leads by company_name match |
| F3 | Company stats missing leads count | ✅ Fixed — 4-card stats now |
| F4 | Lead activities query used wrong columns (`user_id` vs `performed_by`) | ✅ Fixed |
| F5 | Contacts page parameter numbering bug (`$2` when only `$1` existed) | ✅ Fixed |
| F6 | `do_not_contact`, `score`, `deleted_by`, `converted_at` columns missing | ✅ Fixed via migrations 038/039/040 |
| F7 | `company` vs `company_name` column name mismatch in 3 files | ✅ Fixed |
| F8 | `activities.type` vs `activities.action` column mismatch | ✅ Fixed — both columns exist with auto-sync trigger |
| F9 | `leads-client-new.tsx` QuickAdd company field changed to dropdown | ✅ Fixed (in this session) |

---

## PRIORITY ORDER FOR FIXING

### Phase 1 — Deal & Task Forms (Issues 1, 2)
These are the most broken — forms are completely missing critical fields.

### Phase 2 — Clickable Names & Links (Issues 8-17)
Basic navigation — every name/email/phone should be clickable.

### Phase 3 — Missing Detail Pages (Issues 22, 23)
Users can't see full deal or task details.

### Phase 4 — Form Field Fixes (Issues 3, 4, 5, 6, 7, 24, 25, 26)
Clean up text inputs, dropdown defaults, field naming.

### Phase 5 — API Improvements (Issues 27, 28)
Better data relationships.

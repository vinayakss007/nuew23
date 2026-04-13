# NuCRM Data Model vs. Top CRMs

## How Our Schema Compares

### Contacts
| Field | Us | HubSpot | Salesforce | Pipedrive |
|-------|----|---------|-----------:|-----------|
| Name, Email, Phone | ✅ | ✅ | ✅ | ✅ |
| Job Title, Department | ✅ (004) | ✅ | ✅ | ✅ |
| Secondary email/phone | ✅ (004) | ✅ | ✅ | ✅ |
| Full address w/ state/zip | ✅ (004) | ✅ | ✅ | ✅ |
| Birthday | ✅ (004) | ✅ | ✅ | ✅ |
| Lifecycle Stage | ✅ (004) | ✅ | ✅ | ❌ |
| Lead Status | ✅ | ✅ | ✅ | ✅ |
| Lead Score | ✅ | ✅ (AI) | ✅ | ❌ |
| Do Not Contact | ✅ (004) | ✅ | ✅ | ❌ |
| Unsubscribed | ✅ (004) | ✅ | ✅ | ❌ |
| Custom Fields | ✅ jsonb | ✅ | ✅ | ✅ |
| Custom Field Defs UI | ✅ (004) | ✅ | ✅ | ✅ |
| Tags | ✅ | ✅ | ❌ | ✅ |
| @mentions in notes | ✅ | ✅ | ✅ | ❌ |
| Last Activity tracking | ✅ (004) | ✅ | ✅ | ✅ |

### Deals / Opportunities
| Field | Us | HubSpot | Salesforce | Pipedrive |
|-------|----|---------|-----------:|-----------|
| Title, Value, Stage | ✅ | ✅ | ✅ | ✅ |
| Probability | ✅ | ✅ | ✅ | ✅ |
| Close Date | ✅ | ✅ | ✅ | ✅ |
| Multiple Pipelines | ✅ (004) | ✅ | ✅ | ✅ |
| Products / Line Items | ✅ (004) | ✅ | ✅ | ✅ |
| Lost Reason | ✅ (004) | ✅ | ✅ | ✅ |
| Currency | ✅ (004) | ✅ | ✅ | ✅ |
| Custom Fields | ✅ jsonb | ✅ | ✅ | ✅ |

### Companies / Accounts
| Field | Us | HubSpot | Salesforce | Pipedrive |
|-------|----|---------|-----------:|-----------|
| Name, Website, Industry | ✅ | ✅ | ✅ | ✅ |
| Company Size | ✅ (004) | ✅ | ✅ | ✅ |
| Annual Revenue | ✅ (004) | ✅ | ✅ | ❌ |
| Founded Year | ✅ (004) | ✅ | ❌ | ❌ |
| Domain | ✅ (004) | ✅ | ✅ | ✅ |
| Social URLs | ✅ (004) | ✅ | ✅ | ✅ |
| Full Address | ✅ (004) | ✅ | ✅ | ✅ |
| Is Customer flag | ✅ (004) | ✅ | ✅ | ❌ |

### Platform
| Feature | Us | HubSpot | Salesforce | Pipedrive |
|---------|----|---------|-----------:|-----------|
| Multi-tenant SaaS | ✅ | ✅ | ✅ | ✅ |
| Role-based permissions | ✅ | ✅ | ✅ | ✅ |
| Custom roles | ✅ | ✅ (paid) | ✅ | ❌ |
| Soft deletes + trash | ✅ | ✅ | ✅ | ❌ |
| Audit logging | ✅ | ✅ (paid) | ✅ | ❌ |
| API Keys | ✅ | ✅ | ✅ | ✅ |
| Webhooks | ✅ | ✅ | ✅ | ✅ |
| CSV Import/Export | ✅ | ✅ | ✅ | ✅ |
| Email sequences | ❌ | ✅ (paid) | ✅ (paid) | ✅ |
| Automations | ❌ | ✅ (paid) | ✅ (paid) | ✅ (paid) |
| Forms / Web capture | ❌ | ✅ | ✅ | ❌ |
| Email tracking (open/click) | ❌ | ✅ (paid) | ✅ (paid) | ❌ |
| Meeting scheduler | ❌ | ✅ | ✅ | ✅ (paid) |
| Two-factor auth | ❌ | ✅ | ✅ | ✅ |
| SSO / SAML | ❌ | ✅ (Enterprise) | ✅ | ✅ (paid) |

## What Migration 004 Adds
- 20 missing contact fields (job_title, department, birthday, lifecycle_stage, do_not_contact, unsubscribed, etc.)
- 10 missing company fields (domain, size, annual_revenue, founded_year, social URLs, full address)
- 5 missing deal fields (lost_reason, multiple pipelines, currency, product line items)
- Products catalog table
- Deal line items (products on deals)
- Named pipelines table
- Custom field definitions (schema for creating custom properties)
- Centralised tags table
- Dedicated Notes table (separate from activities)
- Email log table
- DB triggers to keep contact/deal counters accurate
- updated_at auto-trigger on all main tables

## Next Priorities (not in this release)
1. **Email sequences** — multi-step drip campaigns
2. **Web forms** — lead capture forms with embed code
3. **Meeting scheduler** — Calendly-like booking pages
4. **Email tracking** — open/click tracking via pixel
5. **Two-factor auth** — TOTP via authenticator app
6. **Automation workflows** — if-this-then-that rules

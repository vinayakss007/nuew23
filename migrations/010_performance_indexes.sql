-- 010_performance_indexes.sql
-- Critical performance indexes for production workloads

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Sessions: token lookup
CREATE INDEX IF NOT EXISTS sessions_token_hash_idx ON public.sessions(token_hash);
CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON public.sessions(user_id, created_at DESC);

-- Users: Email lookup for login
CREATE INDEX IF NOT EXISTS users_email_lower_idx ON public.users(lower(email));

-- Tenants: Slug lookup for subdomain routing
CREATE INDEX IF NOT EXISTS tenants_slug_idx ON public.tenants(slug);

-- Tenant members
CREATE INDEX IF NOT EXISTS tenant_members_user_idx ON public.tenant_members(user_id, status);
CREATE INDEX IF NOT EXISTS tenant_members_tenant_idx ON public.tenant_members(tenant_id, status);

-- Contacts: Email & phone lookup
CREATE INDEX IF NOT EXISTS contacts_email_tenant_idx ON public.contacts(email, tenant_id);
CREATE INDEX IF NOT EXISTS contacts_phone_tenant_idx ON public.contacts(phone, tenant_id);

-- Contacts: Name search (trigram)
CREATE INDEX IF NOT EXISTS contacts_name_trgm_idx ON public.contacts USING gin(first_name gin_trgm_ops, last_name gin_trgm_ops);

-- Contacts: Created at for sorting
CREATE INDEX IF NOT EXISTS contacts_tenant_created_idx ON public.contacts(tenant_id, created_at DESC);

-- Companies: Name search
CREATE INDEX IF NOT EXISTS companies_name_trgm_idx ON public.companies USING gin(name gin_trgm_ops);

-- Deals: Stage filtering for kanban board
CREATE INDEX IF NOT EXISTS deals_tenant_stage_idx ON public.deals(tenant_id, stage, created_at DESC);
CREATE INDEX IF NOT EXISTS deals_assigned_idx ON public.deals(tenant_id, assigned_to);

-- Tasks: Assigned & tenant
CREATE INDEX IF NOT EXISTS tasks_assigned_idx ON public.tasks(assigned_to, completed);
CREATE INDEX IF NOT EXISTS tasks_tenant_created_idx ON public.tasks(tenant_id, created_at DESC);

-- Leads: Email & status
CREATE INDEX IF NOT EXISTS leads_email_idx ON public.leads(tenant_id, lower(email));
CREATE INDEX IF NOT EXISTS leads_status_idx ON public.leads(tenant_id, lead_status);

-- Activities: Entity & tenant
CREATE INDEX IF NOT EXISTS activities_entity_idx ON public.activities(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS activities_tenant_created_idx ON public.activities(tenant_id, created_at DESC);

-- Notifications: User & read status
CREATE INDEX IF NOT EXISTS notifications_user_idx ON public.notifications(user_id, is_read);

-- Webhooks: Tenant
CREATE INDEX IF NOT EXISTS webhooks_tenant_idx ON public.webhooks(tenant_id, is_active);

-- API Keys: Hash lookup
CREATE INDEX IF NOT EXISTS api_keys_hash_idx ON public.api_keys(key_hash);
CREATE INDEX IF NOT EXISTS api_keys_tenant_idx ON public.api_keys(tenant_id);

-- Audit logs: Tenant & time
CREATE INDEX IF NOT EXISTS audit_logs_tenant_idx ON public.audit_logs(tenant_id, created_at DESC);

-- Subscriptions: Tenant
CREATE INDEX IF NOT EXISTS subscriptions_tenant_idx ON public.subscriptions(tenant_id);

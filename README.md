# NuCRM SaaS

A production-ready multi-tenant CRM SaaS built with **Next.js 16**, **Node.js 22**, and **PostgreSQL** with JWT auth — no Supabase, no external auth services. Works with any PostgreSQL provider.

## 📚 Documentation

| Document | Description |
|----------|-------------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | System architecture, design principles, deployment topology |
| [API.md](./API.md) | Complete API reference with examples |
| [DEPLOYMENT.md](./DEPLOYMENT.md) | Deployment guides for Railway, Render, Vercel, Docker |
| [DATA_MODEL.md](./DATA_MODEL.md) | Database schema comparison with top CRMs |
| [CHANGELOG.md](./CHANGELOG.md) | Version history and upcoming features |
| [CONTRIBUTING.md](./CONTRIBUTING.md) | Contribution guidelines |
| [UPGRADE-GUIDE.md](./UPGRADE-GUIDE.md) | Next.js 16 upgrade guide |
| [DATABASE-SETUP.md](./DATABASE-SETUP.md) | Database auto-setup documentation |

---

## Features

### CRM Features
- **Contacts** — Full CRUD, tags, lead scoring, status tracking, timeline
- **Companies** — With contact count, deals linked
- **Deals** — Kanban board with drag-and-drop (DnD Kit), pipeline value, probability
- **Tasks** — Priority, due dates, overdue tracking, filter by mine/today/overdue
- **Calendar** — Monthly view with meetings + tasks
- **Activities** — Timeline of calls, emails, notes, meetings
- **Reports** — Contacts/deals/tasks/activities reports with CSV export
- **Analytics** — Charts powered by Recharts
- **Notifications** — In-app, with unread count

### Multi-Tenant SaaS
- **3-level hierarchy**: Super Admin → Tenant Admin → Tenant Users
- **Plan system**: Free / Starter / Pro / Enterprise with enforced limits
- **Roles & Permissions**: 36 granular permissions, fully customizable
- **Team management**: Invite by email, role assignment, member removal
- **Workspace settings**: Branding (color), timezone, currency, integrations
- **Invitations**: Tokenized email invites with 7-day expiry

### Technical
- **Zero Supabase dependency** — Raw PostgreSQL via `pg` driver
- **JWT sessions** — Cookie-based, DB-backed for revocation
- **Permission guards** — Per-route and per-field
- **Tenant isolation** — All queries scoped by `tenant_id`
- **Error handling** — Every API route wrapped with try/catch
- **TypeScript** throughout

## Quick Start

### Option 1: Auto Start (Recommended)
```bash
# Checks database, runs migrations if needed, starts app + worker
npm run start:app
```

### Option 2: First-Time Setup
```bash
# Creates .env.local, installs dependencies, sets up database
npm run setup
```

### Option 3: Manual Setup
```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.local.example .env.local
# Edit .env.local: set DATABASE_URL and JWT_SECRET

# 3. Auto-check and setup database (recommended)
npm run db:auto

# Or check status first, then push if needed
npm run db:check   # Check database status
npm run db:push    # Push schema if needed

# 4. Start development server (app + worker)
npm run dev:all
```

### Database Commands

| Command | Description |
|---------|-------------|
| `npm run db:check` | Check database connection and schema |
| `npm run db:push` | Push complete schema to database |
| `npm run db:auto` | Auto-check and push if needed |
| `npm run setup` | Full first-time setup |
| `npm run start:app` | Auto-check + start app |

### Create First Account

**Method 1: Setup Wizard (Easiest)**
```
1. Open http://localhost:3000/setup
2. Fill in your name, email, password
3. Creates super admin automatically
```

**Method 2: Sign Up + SQL**
```bash
# 1. Sign up at http://localhost:3000/auth/signup
# 2. Grant super admin via SQL:
psql $DATABASE_URL -c "UPDATE public.users SET is_super_admin=true WHERE email='you@email.com';"
```

**Method 3: Direct SQL**
```bash
psql $DATABASE_URL -c \
  "UPDATE public.users SET is_super_admin=true WHERE email='you@email.com';"
```

### Access Super Admin
```
http://localhost:3000/superadmin/dashboard
```

## Tech Stack

| Layer | Tech |
|-------|------|
| Framework | Next.js 14 (App Router) |
| Database | PostgreSQL 14+ (any provider) |
| Auth | JWT + bcrypt (no external service) |
| Styling | Tailwind CSS + CSS Variables |
| Charts | Recharts |
| Drag & Drop | @dnd-kit |
| Email | Resend or SMTP (nodemailer) |
| Icons | Lucide React |
| Toast | react-hot-toast |

## Project Structure

```
nucrm-saas/
├── app/
│   ├── api/                    # All API routes
│   │   ├── auth/               # login, signup, logout, invite
│   │   ├── tenant/             # contacts, deals, companies, tasks...
│   │   └── superadmin/         # tenants, users, plans
│   ├── auth/                   # Login, signup, invite pages
│   ├── tenant/                 # CRM pages (contacts, deals, etc.)
│   └── superadmin/             # Admin console pages
├── components/
│   ├── tenant/                 # CRM UI components
│   └── superadmin/             # Admin UI components
├── lib/
│   ├── auth/                   # JWT session + middleware
│   ├── db/                     # PostgreSQL client
│   ├── email/                  # Resend + SMTP service
│   ├── permissions/            # Permission definitions
│   └── tenant/                 # Server-side tenant context
├── scripts/
│   └── 001_schema.sql          # Complete database schema
├── types/
│   └── index.ts                # TypeScript interfaces
├── Dockerfile
├── docker-compose.yml
└── DEPLOYMENT.md               # Full deployment guide
```

## API Routes

### Auth
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/login` | Login with email + password |
| POST | `/api/auth/signup` | Create account + workspace |
| POST | `/api/auth/logout` | Logout + invalidate session |
| POST | `/api/auth/accept-invite` | Accept team invitation |
| GET | `/api/auth/invite-details?token=` | Get invitation info |

### Tenant CRM
| Method | Path | Description |
|--------|------|-------------|
| GET/POST | `/api/tenant/contacts` | List / create contacts |
| GET/PATCH/DELETE | `/api/tenant/contacts/[id]` | Get / update / delete |
| GET/POST | `/api/tenant/companies` | List / create companies |
| GET/PATCH/DELETE | `/api/tenant/companies/[id]` | Get / update / delete |
| GET/POST | `/api/tenant/deals` | List / create deals |
| GET/PATCH/DELETE | `/api/tenant/deals/[id]` | Get / update / delete |
| GET/POST | `/api/tenant/tasks` | List / create tasks |
| PATCH/DELETE | `/api/tenant/tasks/[id]` | Update / delete |
| GET/POST | `/api/tenant/meetings` | List / create meetings |
| GET/POST | `/api/tenant/activities` | List / create activities |
| GET | `/api/tenant/search?q=` | Global search |
| GET | `/api/tenant/reports?type=&days=` | Generate reports |
| GET/POST/PATCH | `/api/tenant/workspace` | Workspace info / create / update |
| GET/PATCH | `/api/tenant/members` | List members / change role |
| POST | `/api/tenant/invite/send` | Send invitation |
| DELETE | `/api/tenant/invite/[id]` | Revoke invitation |
| GET/POST | `/api/tenant/roles` | List / create roles |
| PATCH/DELETE | `/api/tenant/roles/[id]` | Update / delete role |
| GET/POST | `/api/tenant/integrations` | List / add integrations |
| PATCH/DELETE | `/api/tenant/integrations/[id]` | Toggle / remove |
| GET/PATCH/DELETE | `/api/tenant/notifications` | List / mark read / delete |
| GET | `/api/tenant/notifications/unread` | Unread count |
| POST | `/api/tenant/permissions/check` | Check a permission |
| GET | `/api/tenant/me` | Current user + permissions |
| POST | `/api/tenant/email/test` | Test email config |

### Super Admin
| Method | Path | Description |
|--------|------|-------------|
| GET/POST/PATCH/DELETE | `/api/superadmin/tenants` | Manage all tenants |
| GET/PATCH | `/api/superadmin/users` | Manage all users |
| GET/POST/PATCH | `/api/superadmin/plans` | Manage pricing plans |
| POST | `/api/superadmin/impersonate` | Switch to tenant workspace |

## Deployment

See [DEPLOYMENT.md](./DEPLOYMENT.md) for full guides covering:
- Railway (recommended)
- Render
- Neon + Vercel  
- Docker / docker-compose
- Environment variables reference

## Creating the First Admin Account

### Option 1 — Setup Wizard (Easiest)

On a fresh install with no users, visit:
```
http://localhost:3000/setup
```

Fill in your name, email, password and workspace name. This creates a super admin account and redirects you to the dashboard. The page locks itself after the first account is created.

In production, set `SETUP_KEY` in your environment to protect this endpoint.

### Option 2 — Sign Up Normally Then Grant Super Admin

```bash
# 1. Sign up at /auth/signup
# 2. Grant super admin via SQL:
psql $DATABASE_URL -c "UPDATE public.users SET is_super_admin=true WHERE email='you@email.com';"
```

### Option 3 — Direct SQL

```bash
psql $DATABASE_URL << 'SQL'
INSERT INTO public.users (email, password_hash, full_name, is_super_admin)
VALUES (
  'admin@yourcompany.com',
  -- Generate hash: node -e "const c=require('crypto');const s=c.randomBytes(16).toString('hex');console.log(s+':'+c.createHash('sha256').update(s+'yourpassword').digest('hex'))"
  'REPLACE_WITH_HASH',
  'Admin User',
  true
);
SQL
```
# new-crm-fixed-31st

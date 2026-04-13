# NuCRM SaaS — Deployment Guide

## Architecture

```
Next.js 16 (App Router + Turbopack)
├── Node.js 22+
├── PostgreSQL 14+  (any provider)
├── JWT sessions    (cookie-based, no external auth)
├── Resend / SMTP   (email, optional)
└── Standard Node   (no Redis, no external queues needed)
```

---

## 1. Local Development

### Prerequisites
- **Node.js 22+** (LTS recommended)
- **npm 10+**
- PostgreSQL 14+ running locally, or a cloud DB URL

### Check Node.js Version

```bash
node --version  # Should be v22.0.0 or higher
npm --version   # Should be 10.0.0 or higher
```

### Steps

```bash
# Clone / unzip project
cd nucrm-saas

# Install dependencies
npm install

# Create environment file
cp .env.local.example .env.local
```

Edit `.env.local`:
```env
DATABASE_URL=postgresql://postgres:password@localhost:5432/nucrm
DATABASE_SSL=false
JWT_SECRET=<run: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">
NEXT_PUBLIC_APP_URL=http://localhost:3000
RESEND_API_KEY=re_...   # optional
```

```bash
# Create database
createdb nucrm   # or use your DB tool

# Push schema (creates all tables, triggers, functions)
npm run db:push

# Start dev server
npm run dev
# Open http://localhost:3000
```

```bash
# After creating your first account, make yourself super admin:
psql $DATABASE_URL -c "UPDATE public.users SET is_super_admin=true WHERE email='you@email.com';"
# Then visit: http://localhost:3000/superadmin/dashboard
```

---

## 2. Deploy to Railway

Railway is the easiest deployment — PostgreSQL + Node in one platform.

```bash
npm install -g @railway/cli
railway login
railway init

# Add PostgreSQL plugin in Railway dashboard, then:
railway variables set \
  DATABASE_URL="$(railway variables get DATABASE_URL)" \
  DATABASE_SSL=true \
  JWT_SECRET="$(node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\")" \
  NEXT_PUBLIC_APP_URL="https://your-app.up.railway.app" \
  RESEND_API_KEY="re_..."

railway up
```

Push schema after deploy:
```bash
railway run npm run db:push
```

---

## 3. Deploy to Render

1. Create a **PostgreSQL** instance on Render → copy the Internal Database URL
2. Create a **Web Service** → connect your repo
   - Build: `npm install && npm run build`
   - Start: `npm start`
3. Add environment variables:

| Key | Value |
|-----|-------|
| `DATABASE_URL` | Your Render Postgres URL |
| `DATABASE_SSL` | `true` |
| `JWT_SECRET` | Random 32+ char string |
| `NEXT_PUBLIC_APP_URL` | `https://yourapp.onrender.com` |
| `RESEND_API_KEY` | `re_...` (optional) |

4. After first deploy: `npm run db:push` via Render Shell

---

## 4. Deploy to Neon + Vercel

Neon = serverless PostgreSQL, Vercel = Edge deployment.

```bash
# Install Vercel CLI
npm i -g vercel

# In your Neon dashboard:
# 1. Create project → copy Connection String (with SSL)
# 2. Note: Neon requires SSL, set DATABASE_SSL=true

vercel env add DATABASE_URL
# Paste: postgresql://user:pass@ep-xxx.aws.neon.tech/neondb?sslmode=require

vercel env add DATABASE_SSL   # value: true
vercel env add JWT_SECRET     # value: <random>
vercel env add NEXT_PUBLIC_APP_URL  # value: https://yourapp.vercel.app

vercel deploy --prod
```

Push schema:
```bash
DATABASE_URL="your-neon-url" npm run db:push
```

> **Note for Vercel**: Add `NEXT_PUBLIC_APP_URL` to your Vercel project settings → Environment Variables.

---

## 5. Deploy with Docker

```dockerfile
# Dockerfile included in project root
docker build -t nucrm .
docker run -p 3000:3000 \
  -e DATABASE_URL=postgresql://... \
  -e DATABASE_SSL=true \
  -e JWT_SECRET=... \
  -e NEXT_PUBLIC_APP_URL=http://localhost:3000 \
  nucrm
```

Or with docker-compose (includes Postgres):
```bash
docker-compose up -d
docker-compose exec app npm run db:push
```

---

## 6. Environment Variables Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `DATABASE_SSL` | ✅ | `true` for cloud, `false` for local |
| `JWT_SECRET` | ✅ | Random 32+ chars for signing JWT tokens |
| `NEXT_PUBLIC_APP_URL` | ✅ | Your app's public URL (no trailing slash) |
| `RESEND_API_KEY` | Optional | Email via Resend (resend.com) |
| `SMTP_HOST` | Optional | SMTP server hostname |
| `SMTP_PORT` | Optional | SMTP port (587 or 465) |
| `SMTP_USER` | Optional | SMTP username |
| `SMTP_PASS` | Optional | SMTP password |
| `SMTP_FROM` | Optional | From address e.g. `NuCRM <noreply@yourapp.com>` |
| `ANTHROPIC_API_KEY` | Optional | For AI features |
| `NODE_ENV` | Auto | Set to `production` by deployment platforms |

Generate a secure JWT_SECRET:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## 7. Database Management

```bash
# Push full schema (safe to re-run — uses IF NOT EXISTS + ON CONFLICT)
npm run db:push
# Equivalent to: psql $DATABASE_URL -f scripts/001_schema.sql

# Connect to DB
npm run db:studio
# Equivalent to: psql $DATABASE_URL

# Manual super admin grant
psql $DATABASE_URL -c "UPDATE public.users SET is_super_admin=true WHERE email='admin@yourcompany.com';"

# Backup
pg_dump $DATABASE_URL > backup_$(date +%Y%m%d).sql

# Restore
psql $DATABASE_URL < backup_20240101.sql
```

---

## 8. Production Checklist

- [ ] `JWT_SECRET` is at least 32 random characters
- [ ] `DATABASE_SSL=true` for cloud databases
- [ ] `NEXT_PUBLIC_APP_URL` matches your actual domain
- [ ] Schema pushed: `npm run db:push`
- [ ] Super admin created via SQL
- [ ] Email configured (Resend or SMTP)
- [ ] Test health endpoint: `GET /api/health`
- [ ] Test login/signup flow
- [ ] Enable HTTPS in production (automatic on Vercel/Railway/Render)

---

## 9. Supported PostgreSQL Providers

| Provider | Notes |
|----------|-------|
| **Neon** | Serverless, generous free tier, requires SSL |
| **Railway** | Easiest all-in-one, good free tier |
| **Render** | Reliable, free tier has 90-day expiry |
| **Supabase** | Use postgres connection string only (no Supabase JS SDK) |
| **PlanetScale** | Use with `DATABASE_SSL=true` |
| **Self-hosted** | PostgreSQL 14+, set `DATABASE_SSL=false` for local |
| **AWS RDS** | Standard Postgres, SSL required |
| **Google Cloud SQL** | Standard Postgres, SSL required |

---

## 10. Database Connection Pool Configuration

### Understanding Pool Size

The application uses a PostgreSQL connection pool with a default size of 10 connections per Node.js instance. This is configured via the `DATABASE_POOL_SIZE` environment variable.

```env
DATABASE_POOL_SIZE=10  # Default: 10 connections per instance
```

### Serverless Deployment Considerations

**⚠️ Critical for Serverless Platforms (Vercel, AWS Lambda, Cloudflare Workers)**

In serverless environments, each function invocation can create a new database connection. With multiple concurrent invocations and multiple instances, you can quickly exhaust your database's connection limit.

**Example Calculation:**
- Database max connections: 100
- Pool size per instance: 10
- Maximum concurrent instances: 100 / 10 = **10 instances**

If you expect more than 10 concurrent instances, you have these options:

1. **Reduce Pool Size** (recommended for serverless):
   ```env
   DATABASE_POOL_SIZE=2  # For high-scale serverless deployments
   ```

2. **Use Connection Pooling Service**:
   - **Neon**: Built-in connection pooling (use their connection string)
   - **Supabase**: Use Transaction Pooling mode
   - **PgBouncer**: Deploy as a sidecar or separate service

3. **Increase Database Max Connections**:
   - RDS: Modify DB parameter group
   - Neon: Upgrade plan for more connections
   - Render: Higher-tier plans offer more connections

### Recommended Pool Sizes by Deployment Type

| Deployment Type | Pool Size | Notes |
|----------------|-----------|-------|
| **Local Development** | 5 | Minimal resource usage |
| **Docker (single instance)** | 10-20 | Dedicated database connection |
| **Railway/Render (standard)** | 10 | Balanced performance |
| **Vercel/Serverless** | 2-5 | Prevent connection exhaustion |
| **High-traffic (with PgBouncer)** | 20-50 | Use connection pooling middleware |

### Additional Pool Configuration

For fine-tuning, you can also set:

```env
# Connection timeout (ms) - how long to wait for a connection
DATABASE_CONNECTION_TIMEOUT=5000

# Idle timeout (ms) - close idle connections after this time
DATABASE_IDLE_TIMEOUT=30000

# Statement timeout (ms) - cancel queries that run longer than this
DATABASE_STATEMENT_TIMEOUT=30000  # 30 seconds default
```

### Monitoring Connection Usage

Check current database connections:

```sql
-- Active connections by application
SELECT application_name, count(*) 
FROM pg_stat_activity 
GROUP BY application_name;

-- Total connections vs max
SELECT 
  count(*) as active_connections,
  (SELECT setting::int FROM pg_settings WHERE name='max_connections') as max_connections
FROM pg_stat_activity;
```

### Best Practices

1. **Start Small**: Begin with `DATABASE_POOL_SIZE=5` and monitor
2. **Monitor**: Track connection usage in your database dashboard
3. **Use PgBouncer**: For high-traffic apps, add PgBouncer between app and DB
4. **Serverless Mode**: Consider using serverless database drivers (e.g., Neon HTTP) for true serverless deployments
5. **Graceful Shutdown**: The app properly closes connections on shutdown

### Troubleshooting

**Error: "too many clients already"**
- Reduce `DATABASE_POOL_SIZE`
- Increase database `max_connections`
- Add PgBouncer connection pooling

**Error: "connection pool timeout"**
- Increase `DATABASE_POOL_SIZE`
- Increase `DATABASE_CONNECTION_TIMEOUT`
- Check for connection leaks (long-running queries)

**Error: "connection reset by peer"**
- Reduce `DATABASE_IDLE_TIMEOUT`
- Enable TCP keepalives
- Check firewall/load balancer timeouts

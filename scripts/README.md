# Database Scripts

Automated database management scripts for NuCRM SaaS.

## Quick Start

### Recommended: Auto Setup & Start
```bash
# This checks database, runs migrations if needed, and starts the app
npm run start:app
```

### Manual Commands

```bash
# Check database status (connection, tables, columns)
npm run db:check

# Push full schema to database (safe to re-run)
npm run db:push

# Auto-check and push if needed
npm run db:auto

# First-time setup (creates .env.local, installs deps, pushes schema)
npm run setup
```

## Available Scripts

| Command | Description |
|---------|-------------|
| `npm run db:check` | Check database connection and schema status |
| `npm run db:push` | Push complete schema to database |
| `npm run db:auto` | Auto-check and push if needed |
| `npm run db:seed` | Seed initial data (plans, etc.) |
| `npm run db:migrate` | Alias for db:push |
| `npm run db:studio` | Show database connection string |

## Migration Files

Located in `scripts/` directory:

| File | Purpose |
|------|---------|
| `001_schema.sql` | Core tables (users, sessions, plans, tenants, etc.) |
| `002_saas_ops.sql` | SaaS operations and functions |
| `003_soft_deletes.sql` | Soft delete columns and triggers |
| `004_schema_enhancement.sql` | Enhanced fields and indexes |
| `005_ownership_and_workflow.sql` | Ownership and workflow improvements |
| `006_isolation_fixes.sql` | Tenant isolation fixes |
| `007_missing_tables.sql` | Additional required tables |
| `008_modules_and_features.sql` | Module system and features |
| `009_session_additions.sql` | Session management enhancements |
| `010_performance_indexes.sql` | Performance optimization indexes |
| `011_protect_super_admin.sql` | Super admin account protection |
| `fix-users-deleted-at.sql` | Fix for missing deleted_at in users table |
| `auto-push-db.js` | Auto-check and push script |

## Environment Variables

Required in `.env.local`:

```env
DATABASE_URL=postgresql://user:password@host:5432/dbname
DATABASE_SSL=false  # Set to 'true' for cloud databases
```

## Database Connection

The scripts use the `pg` (node-postgres) driver with the following configuration:

- **Connection pooling**: 10 connections max
- **SSL**: Auto-detected from DATABASE_URL
- **Timeout**: 10 seconds connection timeout
- **Retry**: Automatic retry on transient errors

## Troubleshooting

### Connection Error
```
❌ Database error: connect ECONNREFUSED
```
**Solution:** Check DATABASE_URL in `.env.local` and ensure database is running.

### Schema Not Found
```
❌ Database schema: NOT FOUND
Run: npm run db:push
```
**Solution:** Run `npm run db:push` to create tables.

### Missing Columns
```
⚠️ Missing columns (deleted_at in users table)
Run: npm run db:push
```
**Solution:** Run `npm run db:push` to add missing columns.

### SSL Error
```
Error: self signed certificate
```
**Solution:** Add `?sslmode=require` to DATABASE_URL or set `DATABASE_SSL=true`.

## Manual SQL Execution

You can also run SQL files manually:

```bash
# Using psql
psql $DATABASE_URL -f scripts/001_schema.sql

# Using the fix script
psql $DATABASE_URL -f scripts/fix-users-deleted-at.sql
```

## Database Tools

Recommended tools for database management:

- **DBeaver** - Free, cross-platform GUI
- **pgAdmin** - Official PostgreSQL admin tool
- **TablePlus** - Modern, native GUI
- **DataGrip** - JetBrains database IDE

## Support

For issues:
1. Check `.env.local` configuration
2. Run `npm run db:check` for diagnostics
3. Review error messages
4. Check database server logs

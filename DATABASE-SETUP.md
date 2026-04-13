# Database Auto-Setup Documentation

## ✅ What Was Added

### New Scripts

1. **`scripts/auto-push-db.js`**
   - Automatically checks database status
   - Pushes schema if columns are missing
   - Provides clear feedback and next steps

2. **`scripts/README.md`**
   - Complete database scripts documentation
   - Troubleshooting guide
   - Migration file reference

### Updated Scripts

1. **`check-db.js`**
   - Added emoji output for better UX
   - Checks for `deleted_at` column in users table
   - Shows detailed statistics (tables, users, tenants)
   - Better error messages with solutions

2. **`package.json`**
   - Added `npm run db:auto` - Auto-check and push
   - Updated `npm run setup` - Now runs auto setup
   - Reorganized script order

3. **`README.md`**
   - Added database commands table
   - Simplified quick start options
   - Multiple methods to create first admin

4. **Schema Files**
   - `001_schema.sql` - Added `deleted_at` to users table
   - `003_soft_deletes.sql` - Added `deleted_at` to users
   - `011_protect_super_admin.sql` - Auto-creates missing columns
   - `fix-users-deleted-at.sql` - Standalone fix script

---

## How to Use

### For New Users (First Time)

```bash
# Option 1: Complete setup in one command
npm run setup

# Option 2: Step by step
npm install
npm run db:auto
npm run dev
```

### For Existing Users

```bash
# Check database status
npm run db:check

# If missing columns, auto-fix
npm run db:auto

# Or push full schema
npm run db:push
```

### Start Development

```bash
# Auto-checks database and starts app + worker
npm run start:app

# Or manually
npm run dev:all
```

---

## Commands Reference

| Command | What It Does |
|---------|--------------|
| `npm run db:check` | Checks DB connection, tables, columns |
| `npm run db:push` | Pushes all SQL migrations |
| `npm run db:auto` | Checks and pushes if needed |
| `npm run setup` | Full first-time setup |
| `npm run start:app` | Auto-check + start app+worker |
| `npm run dev:all` | Start dev server + worker |

---

## What Each Script Does

### `check-db.js`
- ✅ Checks database connection
- ✅ Verifies users table exists
- ✅ Checks for `deleted_at` column
- ✅ Counts tables, users, tenants
- ✅ Shows clear status with emojis

### `setup-db.js`
- 📦 Runs all SQL migrations in order
- 📦 Creates all tables, triggers, functions
- 📦 Safe to re-run (uses IF NOT EXISTS)

### `scripts/auto-push-db.js`
- 🔍 Checks if schema exists
- 🔍 Checks for required columns
- 📦 Auto-pushes if needed
- 📊 Shows statistics after setup

### `start.js` (npm run start:app)
- 🔍 Checks database on startup
- 📦 Auto-runs migrations if needed
- 🚀 Starts app + worker concurrently

---

## Migration Order

```
001_schema.sql              → Core tables
002_saas_ops.sql            → SaaS operations
003_soft_deletes.sql        → Soft delete columns
004_schema_enhancement.sql  → Enhanced fields
005_ownership_and_workflow.sql
006_isolation_fixes.sql
007_missing_tables.sql
008_modules_and_features.sql
009_session_additions.sql
010_performance_indexes.sql
011_protect_super_admin.sql
fix-users-deleted-at.sql    → Optional fix
```

---

## Troubleshooting

### Error: DATABASE_URL not found
```
❌ DATABASE_URL not found in .env.local
```
**Fix:**
```bash
cp .env.local.example .env.local
# Edit .env.local and add:
DATABASE_URL=postgresql://...
```

### Error: Connection refused
```
❌ Database error: connect ECONNREFUSED
```
**Fix:**
1. Check DATABASE_URL is correct
2. Ensure database server is running
3. Check firewall/SSL settings

### Error: Missing deleted_at column
```
⚠️ Missing columns (deleted_at in users table)
```
**Fix:**
```bash
npm run db:auto
# or
npm run db:push
```

### Error: Schema not found
```
❌ Database schema: NOT FOUND
```
**Fix:**
```bash
npm run db:push
```

---

## Example Output

### Successful Check
```
🔍 Checking database connection...

✅ Database connection: OK
✅ Database schema: FOUND
✅ Required columns: OK

📊 Statistics:
   • 54 tables
   • 3 users
   • 2 tenants

✅ Database is ready!
```

### Auto-Fix
```
🔍 Checking database status...

⚠️  Database needs setup:

   • Missing columns (deleted_at in users table)

Starting automatic setup...

📦 Pushing database schema...

  ✓ 001_schema.sql
  ✓ 002_saas_ops.sql
  ✓ 003_soft_deletes.sql
  ...

✅ Schema pushed successfully!

🎉 Database is ready to use!
```

---

## Best Practices

1. **Always run `npm run db:check`** before debugging app issues
2. **Use `npm run db:auto`** for hassle-free setup
3. **Keep `.env.local` secure** - never commit to git
4. **Test migrations** on local DB before production
5. **Backup production** before running migrations

---

## Database Tools

### GUI Clients
- **DBeaver** (Free, recommended)
- **pgAdmin** (Official)
- **TablePlus** (Modern, paid)
- **DataGrip** (JetBrains, paid)

### CLI
```bash
# Connect with psql
psql $DATABASE_URL

# Run specific migration
psql $DATABASE_URL -f scripts/001_schema.sql

# Backup
pg_dump $DATABASE_URL > backup.sql

# Restore
psql $DATABASE_URL < backup.sql
```

---

## Next Steps

After database setup:

1. ✅ Run `npm run dev` or `npm run start:app`
2. ✅ Open http://localhost:3000
3. ✅ Create first account at `/setup` or `/auth/signup`
4. ✅ Grant super admin via SQL
5. ✅ Access `/superadmin/dashboard`

---

**Last Updated:** 2024-01-20
**Version:** NuCRM SaaS 1.0.0

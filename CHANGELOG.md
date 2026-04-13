# Changelog

All notable changes to NuCRM SaaS will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- CSV export functionality for contacts, deals, companies, and tasks
- Contact import via CSV with duplicate handling
- Export service utility (`lib/export.ts`)
- Complete API documentation (`API.md`)
- Architecture documentation with table of contents
- Queue support for `contact-import` jobs
- Upgrade guide for Next.js 16

### Fixed
- CSV export worker implementation (Redis and pg-boss)
- Queue type definitions to include all job types
- Middleware syntax cleanup for Next.js 16

### Changed
- **UPGRADED: Next.js 14 → Next.js 16.2.1**
- **UPGRADED: React 18 → React 19.0.0**
- **UPGRADED: Node.js 18 → Node.js 22+**
- **UPGRADED: ESLint 8 → ESLint 9**
- Enhanced ARCHITECTURE.md with comprehensive sections
- Updated worker.ts with full CSV export logic
- Updated tsconfig.json with stricter TypeScript settings
- Updated dev script to use Turbopack (`next dev --turbopack`)

### Updated Dependencies
- `next`: 14.2.30 → 16.2.1
- `react`: 18.3.1 → 19.0.0
- `react-dom`: 18.3.1 → 19.0.0
- `eslint`: 8.57.1 → 9.0.0
- `eslint-config-next`: 14.2.30 → 16.2.1
- `@types/react`: 18.3.23 → 19.0.0
- `@types/react-dom`: 18.3.7 → 19.0.0

---

## [1.0.0] - 2024-01-20

### Added
- Multi-tenant SaaS CRM architecture
- Three-level user hierarchy (Super Admin → Org Admin → Org User)
- JWT-based authentication with httpOnly cookies
- Two-Factor Authentication (2FA) with TOTP
- Role-based permissions (36 permissions across 9 categories)
- 5 system roles (admin, manager, sales_rep, lead_manager, viewer)
- Custom roles with granular permissions
- Contact management with tags, lead scoring, lifecycle stages
- Company management with contact linking
- Deal pipeline with Kanban board and drag-and-drop
- Task management with priorities and due dates
- Meeting scheduling
- Activity timeline
- Automation engine with trigger-action rules
- 9 automation action types
- 15 trigger types
- Module system with 8 built-in modules
- Email integration (Resend + SMTP)
- Webhook integrations (outgoing)
- API keys for external integrations
- CSV import/export
- Bulk operations
- Search functionality
- Reports and analytics
- Notifications (in-app)
- Audit logging
- Rate limiting (per-IP and per-tenant)
- Error logging and tracking
- Health checks
- Cron jobs (7 scheduled tasks)
- Background worker (Redis BullMQ or pg-boss)
- Database connection pooling with retry logic
- Multi-layer caching (in-memory LRU, DB cache, HTTP cache)
- Soft deletes with trash restoration
- Tenant isolation at database level
- Impersonation for super admin
- Setup wizard for first-time installation
- Docker support
- Deployment guides (Railway, Render, Vercel, Neon)

### Technical Stack
- Next.js 14 App Router
- PostgreSQL 14+ (raw pg driver)
- TypeScript (strict mode)
- Tailwind CSS
- Recharts for analytics
- @dnd-kit for drag-and-drop
- Jose for JWT
- BullMQ or pg-boss for queues
- Nodemailer for email
- Anthropic Claude for AI features

### Security
- SHA-256 password hashing with salt
- JWT sessions with server-side revocation
- TOTP 2FA with backup codes
- SQL injection prevention (parameterized queries)
- XSS prevention (React auto-escape)
- CSRF protection (httpOnly cookies)
- Protected columns in updates
- Tenant isolation enforcement
- Audit trail for all admin actions

### Performance
- Connection pooling (configurable size)
- Automatic retry on transient DB errors
- In-memory LRU cache (500 entries)
- Database query caching
- Selective column queries
- Pagination on all list endpoints
- Covering indexes for common queries

### Monitoring
- Health check endpoint
- Error logging to database
- Automation run tracking
- Webhook delivery logging
- Usage snapshots (daily)
- Backup records
- Platform monitoring dashboard (super admin)

---

## Version History

| Version | Date | Description |
|---------|------|-------------|
| 1.0.0 | 2024-01-20 | Initial production release |

---

## Upcoming Features (Roadmap)

### Q2 2024
- [ ] Email sequences (multi-step drip campaigns)
- [ ] Web forms / lead capture forms with embed code
- [ ] Meeting scheduler (Calendly-like booking pages)
- [ ] Email tracking (open/click tracking)
- [ ] WhatsApp automation integration
- [ ] Advanced analytics dashboard
- [ ] Custom reports builder
- [ ] Mobile app (React Native)

### Q3 2024
- [ ] SSO / SAML integration
- [ ] Advanced AI features (predictive scoring, recommendations)
- [ ] Team collaboration (comments, @mentions)
- [ ] File attachments for contacts/deals
- [ ] Product catalog with line items on deals
- [ ] Quote/invoice generation
- [ ] Integration marketplace
- [ ] Public API with developer portal

### Q4 2024
- [ ] Multi-language support (i18n)
- [ ] Custom domain support for workspaces
- [ ] White-labeling options
- [ ] Advanced permissions (field-level)
- [ ] Data import from other CRMs
- [ ] Automated backups to S3/R2
- [ ] Real-time collaboration (WebSockets)
- [ ] Chrome extension

---

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'feat: add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Commit Message Format

We follow [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` A new feature
- `fix:` A bug fix
- `docs:` Documentation changes
- `style:` Code style changes (formatting, etc.)
- `refactor:` Code refactoring
- `test:` Adding tests
- `chore:` Maintenance tasks

Example:
```
feat: add WhatsApp automation support
fix: resolve race condition in webhook retry
docs: update API reference
```

---

## Breaking Changes

### None yet (v1.0.0 is initial release)

---

## Migration Guide

### From v0.x to v1.0.0

1. Run database migrations:
   ```bash
   npm run db:push
   ```

2. Update environment variables:
   - Add `DATABASE_POOL_SIZE=10` (optional)
   - Add `CRON_SECRET=<random-secret>` for cron endpoints

3. Restart the application:
   ```bash
   npm run build
   npm start
   ```

4. Update worker process:
   ```bash
   npm run worker
   ```

---

## Support

- **Documentation**: [ARCHITECTURE.md](./ARCHITECTURE.md), [API.md](./API.md)
- **Issues**: GitHub Issues
- **Discussions**: GitHub Discussions
- **Email**: support@nucrm.com (placeholder)

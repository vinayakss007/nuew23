# Contributing to NuCRM SaaS

Thank you for your interest in contributing to NuCRM SaaS! This document provides guidelines and instructions for contributing.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [How to Contribute](#how-to-contribute)
- [Coding Standards](#coding-standards)
- [Commit Guidelines](#commit-guidelines)
- [Pull Request Process](#pull-request-process)
- [Testing](#testing)

---

## Code of Conduct

### Our Pledge

We are committed to providing a welcoming and inspiring community for all. Please be respectful and constructive in your interactions.

### Our Standards

- Use welcoming and inclusive language
- Be respectful of differing viewpoints
- Gracefully accept constructive criticism
- Focus on what is best for the community
- Show empathy towards other community members

---

## Getting Started

1. **Fork the repository** on GitHub
2. **Clone your fork** locally
3. **Set up the development environment** (see below)
4. **Pick an issue** from the issue tracker or propose a new feature

---

## Development Setup

### Prerequisites

- Node.js 18+
- PostgreSQL 14+
- Git

### Installation

```bash
# Clone your fork
git clone https://github.com/YOUR_USERNAME/nucrm-saas.git
cd nucrm-saas

# Install dependencies
npm install

# Set up environment
cp .env.local.example .env.local
# Edit .env.local with your database credentials

# Set up database
npm run db:push

# Start development
npm run dev:all
```

---

## How to Contribute

### Reporting Bugs

Before creating bug reports, please check existing issues. When creating a bug report, include:

- **Clear title and description**
- **Steps to reproduce** the behavior
- **Expected vs actual behavior**
- **Screenshots** if applicable
- **Environment details** (OS, Node version, browser)

**Example:**
```markdown
**Bug**: Contact export fails for large datasets

**Steps to Reproduce:**
1. Navigate to Contacts
2. Click Export
3. Wait for export with 10,000+ contacts

**Expected:** CSV download starts
**Actual:** Timeout error after 30 seconds

**Environment:**
- OS: macOS 14.0
- Node: 18.17.0
- Browser: Chrome 120
```

### Suggesting Features

Feature suggestions are welcome! Please provide:

- **Use case** - Why is this feature needed?
- **Proposed solution** - How should it work?
- **Alternatives considered** - What other approaches were considered?
- **Additional context** - Screenshots, mockups, etc.

### Your First Code Contribution

1. Look for issues labeled `good first issue` or `help wanted`
2. Comment on the issue to claim it
3. Create a branch and implement the feature
4. Submit a pull request

---

## Coding Standards

### TypeScript

- Use strict mode (enabled in `tsconfig.json`)
- Avoid `any` - use proper types or `unknown`
- Use interfaces for object types
- Export types from `types/index.ts`

```typescript
// ✅ Good
interface Contact {
  id: string;
  first_name: string;
  email: string | null;
}

// ❌ Avoid
type Contact = any;
```

### Naming Conventions

- **Files**: lowercase with hyphens (`user-profile.tsx`)
- **Components**: PascalCase (`UserProfile`)
- **Functions/Variables**: camelCase (`getUserById`)
- **Constants**: UPPER_SNAKE_CASE (`MAX_CONTACTS_PER_PAGE`)
- **Types/Interfaces**: PascalCase (`UserProfile`)

### Code Organization

```typescript
// 1. Imports (grouped)
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { queryMany } from '@/lib/db/client';

// 2. Types
interface ContactResponse {
  data: Contact[];
  total: number;
}

// 3. Constants
const MAX_PAGE_SIZE = 100;

// 4. Main function
export async function GET(request: NextRequest): Promise<NextResponse> {
  // Implementation
}

// 5. Helper functions
function parseQueryParams(params: URLSearchParams) {
  // Implementation
}
```

### Error Handling

Always wrap async operations with try/catch:

```typescript
try {
  const contacts = await queryMany(sql, params);
  return NextResponse.json({ data: contacts });
} catch (err: any) {
  await logError({ error: err, context: 'contacts.list' });
  return NextResponse.json({ error: err.message }, { status: 500 });
}
```

### Database Queries

- Always use parameterized queries (prevent SQL injection)
- Always include `tenant_id` in WHERE clause
- Use transactions for multi-step operations

```typescript
// ✅ Good
const contacts = await queryMany(
  'SELECT * FROM contacts WHERE tenant_id = $1 AND id = $2',
  [tenantId, contactId]
);

// ❌ Never do this
const contacts = await queryMany(
  `SELECT * FROM contacts WHERE tenant_id = '${tenantId}'`  // SQL injection risk!
);
```

---

## Commit Guidelines

We follow [Conventional Commits](https://www.conventionalcommits.org/):

### Types

- `feat:` A new feature
- `fix:` A bug fix
- `docs:` Documentation changes
- `style:` Code style changes (formatting, semicolons, etc.)
- `refactor:` Code refactoring (no functional changes)
- `test:` Adding or updating tests
- `chore:` Maintenance tasks, dependencies

### Scope (optional)

Add scope to specify which part of the codebase:

- `feat(contacts):` Add contact merge functionality
- `fix(auth):` Fix 2FA verification bug
- `docs(api):` Update API documentation

### Examples

```bash
feat: add CSV export for contacts
fix: resolve race condition in webhook retry
docs: update API reference with new endpoints
refactor(auth): simplify JWT verification logic
chore: update dependencies to latest versions
```

### Writing Good Commit Messages

1. **Use imperative mood** ("add" not "added")
2. **Keep first line under 72 characters**
3. **Add body for complex changes**
4. **Reference issues/PRs** when applicable

```bash
# ✅ Good
feat: add contact import via CSV

- Parse CSV files with duplicate detection
- Queue import jobs for background processing
- Send notification when import completes

Closes #123

# ❌ Too vague
fix: stuff

# ❌ Too long
added a new feature that allows users to import contacts from CSV files and it works really well and is fast
```

---

## Pull Request Process

### Before Submitting

1. **Update documentation** if adding/changing features
2. **Add tests** for new functionality
3. **Run linting** (`npm run lint`)
4. **Test locally** with your database
5. **Update CHANGELOG.md** if applicable

### PR Template

```markdown
## Description
Brief description of changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Testing
- [ ] Tested locally
- [ ] Added tests
- [ ] Updated documentation

## Screenshots (if applicable)
Add screenshots of UI changes

## Checklist
- [ ] Code follows project guidelines
- [ ] Self-review completed
- [ ] No console.log statements
- [ ] No breaking changes (or documented)
```

### Review Process

1. **Automated checks** - CI/CD pipeline
2. **Code review** - At least 1 approval required
3. **Testing** - Reviewer may test locally
4. **Merge** - Squash and merge by maintainer

### Review Time

We aim to review PRs within:
- **Bug fixes**: 48 hours
- **Features**: 1 week
- **Large refactors**: 2 weeks

---

## Testing

### Running Tests

```bash
# All tests
npm test

# Unit tests
npm run test:unit

# Integration tests
npm run test:integration

# E2E tests
npm run test:e2e
```

### Writing Tests

```typescript
// Example unit test
import { describe, it, expect } from 'vitest';
import { escapeCSV } from '@/lib/utils';

describe('escapeCSV', () => {
  it('should escape commas', () => {
    expect(escapeCSV('Hello, World')).toBe('"Hello, World"');
  });

  it('should escape quotes', () => {
    expect(escapeCSV('Hello "World"')).toBe('"Hello ""World"""');
  });

  it('should not escape simple strings', () => {
    expect(escapeCSV('Hello World')).toBe('Hello World');
  });
});
```

---

## Architecture Decisions

### Decision Records

We use Architecture Decision Records (ADRs) for significant architectural changes:

1. **Create `docs/adr/NNNN-title.md`**
2. **Follow template**:
   - Status (proposed/accepted/deprecated)
   - Context
   - Decision
   - Consequences

### Example ADR

```markdown
# ADR 001: Use pg-boss as Fallback Queue

## Status
Accepted

## Context
Redis may not be available in all deployment environments.

## Decision
Use pg-boss (PostgreSQL-based queue) as fallback when Redis is unavailable.

## Consequences
- (+) Works with PostgreSQL-only deployments
- (+) Simpler infrastructure
- (-) Slightly lower performance than Redis
```

---

## Release Process

### Versioning

We follow [Semantic Versioning](https://semver.org/):

- **MAJOR** - Breaking changes
- **MINOR** - New features (backward compatible)
- **PATCH** - Bug fixes (backward compatible)

### Release Steps

1. Update `CHANGELOG.md`
2. Update `package.json` version
3. Create git tag
4. Build and publish

---

## Community

- **GitHub Issues**: Bug reports, feature requests
- **GitHub Discussions**: Questions, ideas, show and tell
- **Discord** (coming soon): Real-time chat
- **Twitter** (coming soon): Updates and announcements

---

## Questions?

Feel free to open an issue with the `question` label if you need help or clarification.

---

## Thank You!

Every contribution, no matter how small, helps make NuCRM SaaS better. We appreciate your time and effort!

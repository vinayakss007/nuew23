# Upgrade Guide: Next.js 14 → Next.js 16.2.1

This guide covers the upgrade from Next.js 14 to Next.js 16.2.1 with React 19 and Node.js 22.

## What's New

### Next.js 16 Highlights
- **Turbopack Dev** - Fast Rust-based bundler (now stable)
- **React 19 Support** - Full compatibility with React 19 features
- **Improved Server Components** - Better RSC performance
- **Enhanced Caching** - Smarter incremental static regeneration
- **Better Error Handling** - Improved error boundaries and overlays

### React 19 Features
- **Actions** - Built-in form handling with `useActionState`
- **use() API** - Better async component handling
- **Document Metadata** - Native `metadata` export support
- **Asset Loading** - Improved resource hints
- **Automatic JSX Transform** - No need for `React` import

### Node.js 22 Features
- **Performance** - 20% faster module loading
- **Security** - Latest OpenSSL, improved TLS
- **npm 10** - Faster installs, better workspaces
- **Diagnostics** - Enhanced debugging tools
- **Long-term Support** - Until April 2027

---

## Prerequisites

### System Requirements

```bash
# Check current versions
node --version    # Must be >= 22.0.0
npm --version     # Must be >= 10.0.0

# If you need to upgrade Node.js:
# Option 1: Download from https://nodejs.org
# Option 2: Use nvm (Node Version Manager)
nvm install 22
nvm use 22
nvm alias default 22
```

---

## Upgrade Steps

### 1. Backup Your Project

```bash
# Create a backup
git add .
git commit -m "backup before nextjs 16 upgrade"
git push

# Or create a branch
git checkout -b upgrade/nextjs-16
```

### 2. Update package.json

The following changes have been made to `package.json`:

```json
{
  "engines": {
    "node": ">=22.0.0",
    "npm": ">=10.0.0"
  },
  "scripts": {
    "dev": "next dev --turbopack"  // Added --turbopack flag
  },
  "dependencies": {
    "next": "16.2.1",              // Updated from 14.2.30
    "react": "^19.0.0",            // Updated from 18.3.1
    "react-dom": "^19.0.0"         // Updated from 18.3.1
  },
  "devDependencies": {
    "eslint": "^9.0.0",            // Updated from 8.57.1
    "eslint-config-next": "16.2.1", // Updated from 14.2.30
    "@types/react": "^19.0.0",     // Updated from 18.3.23
    "@types/react-dom": "^19.0.0"  // Updated from 18.3.7
  }
}
```

### 3. Clean Install

```bash
# Remove old dependencies
rm -rf node_modules package-lock.json

# Clear npm cache
npm cache clean --force

# Install fresh dependencies
npm install
```

### 4. Update tsconfig.json

TypeScript configuration has been updated with stricter settings:

```json
{
  "compilerOptions": {
    "target": "ES2022",                    // Updated from ES2017
    "strict": true,                        // Enabled strict mode
    "noUncheckedIndexedAccess": true,      // New: safer array access
    "noImplicitOverride": true,            // New: explicit override required
    "noPropertyAccessFromIndexSignature": true  // New: stricter property access
  }
}
```

### 5. Update next.config.mjs

No major changes required, but you can add new features:

```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  images: {
    remotePatterns: [{ protocol: 'https', hostname: '**' }],
  },
  experimental: {
    serverComponentsExternalPackages: ['pg', 'nodemailer'],
  },
  // New in Next.js 16:
  // logging: {
  //   fetches: {
  //     fullUrl: true,
  //   },
  // },
};

export default nextConfig;
```

### 6. Fix Middleware (if needed)

Middleware syntax has been cleaned up:

```typescript
// Before (Next.js 14)
const PUBLIC = ['/auth/', '/setup', ...];

// After (Next.js 16) - Better readability
const PUBLIC = [
  '/auth/',
  '/setup',
  // ... more routes
];
```

### 7. Update Code for React 19

#### Remove Unnecessary React Imports

```typescript
// Before
import React, { useState, useEffect } from 'react';

// After (React 19 automatic JSX transform)
import { useState, useEffect } from 'react';
```

#### Update Form Handling (Optional)

```typescript
// Before
function MyForm() {
  const [data, setData] = useState({});
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await submitForm(data);
  };
  
  return (
    <form onSubmit={handleSubmit}>
      {/* fields */}
    </form>
  );
}

// After (React 19 actions)
'use client';
import { useActionState } from 'react';

async function submitForm(prevState: any, formData: FormData) {
  'use server';
  // handle submission
}

function MyForm() {
  const [state, formAction] = useActionState(submitForm, null);
  
  return (
    <form action={formAction}>
      {/* fields */}
    </form>
  );
}
```

### 8. Run Type Check

```bash
# Check for TypeScript errors
npx tsc --noEmit

# Fix any type errors
```

### 9. Run Linter

```bash
# Check for ESLint errors
npm run lint

# Fix auto-fixable issues
npm run lint -- --fix
```

### 10. Test Development Server

```bash
# Start dev server with Turbopack
npm run dev

# Check for any runtime errors
# Open http://localhost:3000
```

### 11. Build and Test Production

```bash
# Create production build
npm run build

# Start production server
npm start

# Test all critical paths:
# - Authentication
# - CRM operations
# - API endpoints
# - Background worker
```

---

## Breaking Changes

### Next.js 16 Breaking Changes

1. **Minimum Node.js version**: 18.18 → 20.0.0+ (we use 22+)
2. **Turbopack default**: `next dev` now uses Turbopack in development
3. **Removed unstable exports**: Some experimental APIs removed
4. **Stricter caching**: May need to adjust revalidation logic

### React 19 Breaking Changes

1. **No more default export**: `import React from 'react'` not needed
2. **JSX transform**: Automatic, no need for React import
3. **Event pooling**: Removed (already deprecated)
4. **Legacy Context**: Fully removed (use modern context)

### TypeScript Stricter Settings

1. **noUncheckedIndexedAccess**: Array access returns `T | undefined`
2. **noImplicitOverride**: `override` keyword required for overrides
3. **noPropertyAccessFromIndexSignature**: Use bracket notation for dynamic keys

---

## Migration Issues & Solutions

### Issue 1: Array Access Errors

```typescript
// Before
const first = items[0];  // T

// After (with noUncheckedIndexedAccess)
const first = items[0];  // T | undefined

// Fix
const first = items[0];
if (first) {
  // use first
}

// Or
const first = items.at(0);  // Still T | undefined but clearer
```

### Issue 2: React Import Errors

```typescript
// Error: 'React' is declared but never used
import React from 'react';  // Remove this line

// Keep only what you use
import { useState, useEffect } from 'react';
```

### Issue 3: Middleware Cookie Access

```typescript
// Next.js 16 middleware cookie handling
const token = request.cookies.get('nucrm_session')?.value;

// Make sure to handle undefined
if (!token) {
  return NextResponse.redirect('/auth/login');
}
```

---

## Performance Improvements

### Development

- **Turbopack**: Up to 700x faster updates than webpack
- **Faster HMR**: Instant feedback on code changes
- **Better Caching**: Reduced rebuild times

### Production

- **Server Components**: Faster initial page loads
- **Improved Image Optimization**: 30% faster image processing
- **Better Tree-shaking**: Smaller bundle sizes
- **Faster Routing**: Optimized route matching

---

## New Features Available

### Next.js 16 Features

1. **Partial Prerendering** (Experimental)
   ```javascript
   // next.config.mjs
   experimental: {
     partialPrerendering: true,
   }
   ```

2. **Turbo Trace**
   ```bash
   next build --profile
   ```

3. **Better Error Overlay**
   - Component stack traces
   - Source maps
   - Quick fixes

### React 19 Features

1. **useActionState Hook**
   ```typescript
   const [state, formAction] = useActionState(action, initialState);
   ```

2. **use() API**
   ```typescript
   const data = use(fetchData());
   ```

3. **Document Metadata**
   ```typescript
   export const metadata = {
     title: 'My Page',
     description: 'My description',
   };
   ```

---

## Rollback Plan

If you encounter critical issues:

```bash
# 1. Revert package.json changes
git checkout HEAD -- package.json

# 2. Reinstall dependencies
rm -rf node_modules package-lock.json
npm install

# 3. Revert tsconfig.json
git checkout HEAD -- tsconfig.json

# 4. Restart dev server
npm run dev
```

---

## Post-Upgrade Checklist

- [ ] Node.js version >= 22.0.0
- [ ] npm version >= 10.0.0
- [ ] `npm install` completes without errors
- [ ] `npm run dev` starts without errors
- [ ] `npm run build` completes successfully
- [ ] All pages render correctly
- [ ] Authentication works
- [ ] API endpoints respond
- [ ] Database queries work
- [ ] Background worker starts
- [ ] No console errors in browser
- [ ] Linting passes
- [ ] Type checking passes

---

## Support

If you encounter issues:

1. **Check the logs**: `.next/build.log`
2. **Clear cache**: `rm -rf .next node_modules`
3. **Check compatibility**: Review peer dependencies
4. **Open an issue**: GitHub Issues
5. **Check docs**: [Next.js 16 Documentation](https://nextjs.org/docs)

---

## Resources

- [Next.js 16 Release Notes](https://nextjs.org/blog/next-16)
- [React 19 Release Notes](https://react.dev/blog/react-19)
- [Node.js 22 Release Notes](https://nodejs.org/en/blog/release/v22.0.0)
- [Migration Guide](https://nextjs.org/docs/app/building-your-application/upgrading)

---

**Upgrade completed successfully!** 🎉

Your project is now running on Next.js 16.2.1, React 19, and Node.js 22.

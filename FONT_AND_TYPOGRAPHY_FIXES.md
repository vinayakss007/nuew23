# NuCRM Font & Typography — Full Audit + Implementation Plan

## 📋 Problem: "Fonts Look Faint / Too Light"

### Root Causes

1. **DM Sans font weights too low** — Most text uses `font-medium` (500) or `font-semibold` (600) on light gray backgrounds. DM Sans at 500 weight renders thin/faint, especially on non-Retina displays.

2. **Muted foreground color too light** — `--muted-foreground: 215 12% 50%` = `hsl(215, 12%, 50%)` ≈ `#7d8796`. This is 50% lightness — borderline readable but feels faint.

3. **Body text defaults to 16px browser default** — No explicit `font-size` on `<body>`, no base size set. Pages rely on per-component sizing which is inconsistent.

4. **No font-size scale system** — Sizes scattered: `text-xs` (12px), `text-sm` (14px), `text-base` (16px), `text-lg` (18px) used inconsistently across similar content.

5. **Heading hierarchy inconsistent** — Some pages use `text-lg font-bold` (18px bold), others use `text-2xl font-bold` (24px bold). No standard page title size.

6. **Dark mode fonts worse** — `--muted-foreground: 215 14% 52%` on dark backgrounds with low weight feels washed out.

7. **Login/auth pages use custom inline input styles** — Different from the `Input` component, inconsistent sizing.

---

## ✅ Complete Fix List

### FIX 1 — Font Family: Add Weight Variants + Switch to Inter
**Problem:** DM Sans at 500 weight is too thin for body text.
**Solution:** Switch to **Inter** — the #1 font for modern SaaS (Linear, Vercel, Notion). Inter is designed for screens, heavier at same weights.

**File:** `app/globals.css`

**Current:**
```css
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600;9..40,700&family=DM+Mono:wght@400;500&display=swap');
```

**Change to:**
```css
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500&display=swap');
```

**And in `@layer base`:**
```css
body { font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; }
code, pre, kbd { font-family: 'JetBrains Mono', monospace; }
```

**Why Inter over DM Sans:**
- Inter is designed for UI text — heavier appearance at same weight
- Used by: Linear, Vercel, Figma, Notion, Tailwind, GitHub
- 400 weight in Inter ≈ 500 in DM Sans (more readable)
- Better x-height, better legibility at small sizes

---

### FIX 2 — Base Font Size on Body
**Problem:** No explicit base font size.
**Solution:** Set explicit 15px base (slightly larger than default 16px for readability).

**File:** `app/globals.css` — `@layer base`

**Add:**
```css
html { font-size: 15px; }  /* 15px base — slightly larger for readability */
```

---

### FIX 3 — Brighten Muted Foreground Colors
**Problem:** Muted text feels faint (50% lightness).
**Solution:** Increase lightness for better contrast.

**File:** `app/globals.css`

**Current light mode:**
```css
--muted-foreground: 215 12% 50%;
```
**Change to:**
```css
--muted-foreground: 215 10% 42%;  /* Darker = more readable */
```

**Current dark mode:**
```css
--muted-foreground: 215 14% 52%;
```
**Change to:**
```css
--muted-foreground: 215 12% 62%;  /* Brighter on dark bg = more visible */
```

---

### FIX 4 — Increase Font Weights Across the Board
**Problem:** Too many `font-medium` (500) on small text.
**Solution:** Bump key text elements to heavier weights.

**File:** `app/globals.css` — `@layer base`

**Add:**
```css
/* Base text heavier for readability */
p, span, div, li, td, th { 
  font-weight: 400; 
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

/* Small text (text-xs, text-sm) should be at least 400, preferably 500 */
.text-sm, .text-xs {
  font-weight: 400;
}

/* Muted text on small sizes needs extra weight */
.text-muted-foreground {
  font-weight: 400;
}

/* Headings — bolder, tighter tracking */
h1 { font-size: 1.75rem; font-weight: 700; letter-spacing: -0.03em; line-height: 1.2; }
h2 { font-size: 1.4rem; font-weight: 700; letter-spacing: -0.025em; line-height: 1.25; }
h3 { font-size: 1.15rem; font-weight: 600; letter-spacing: -0.02em; line-height: 1.3; }
h4 { font-size: 1rem; font-weight: 600; letter-spacing: -0.015em; line-height: 1.35; }
```

---

### FIX 5 — Standardize Page Title Sizes
**Problem:** Every page uses different title sizes (`text-lg`, `text-xl`, `text-2xl`).
**Solution:** Standard page title = `text-xl` (20px) `font-bold` for dashboard pages, `text-2xl` (24px) for landing.

**Files to update:**
- `components/tenant/dashboard-client.tsx` — `text-lg font-bold` → `text-xl font-bold`
- All other tenant pages with page headers

---

### FIX 6 — Table Text Readability
**Problem:** Tables use `text-sm` (14px) with `font-medium` headers — feels faint.
**Solution:** Keep `text-sm` but bump to 400 weight for body, 600 for headers.

**File:** `components/ui/table.tsx`

**Current table header:**
```
"border-t bg-muted/50 font-medium [&>tr]:last:border-b-0"
```
**Change to:**
```
"border-t bg-muted/50 font-semibold [&>tr]:last:border-b-0"
```

**Current table cell:**
```
"px-4 py-2 [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]"
```
**Add:** `text-sm font-normal`

---

### FIX 7 — Button Text Weight
**Problem:** Buttons use `font-medium` — feels weak for CTAs.
**Solution:** Bump to `font-semibold`.

**File:** `components/ui/button.tsx`

**Current:**
```
"inline-flex items-center justify-center whitespace-nowrap rounded-lg text-sm font-medium ..."
```
**Change to:**
```
"inline-flex items-center justify-center whitespace-nowrap rounded-lg text-sm font-semibold ..."
```

---

### FIX 8 — Sidebar Navigation Text
**Problem:** Sidebar nav items use `text-sm font-medium` — faint on light backgrounds.
**Solution:** Bump to `font-semibold`, increase size to 14px.

**File:** `app/globals.css`

**Current:**
```css
.tenant-nav-item { @apply flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all; }
```
**Change to:**
```css
.tenant-nav-item {
  @apply flex items-center gap-3 px-3 py-2 rounded-lg text-[13.5px] font-semibold transition-all duration-200 ease-out;
  @apply relative;
}
```

**And admin sidebar:**
```css
.admin-nav-item { @apply flex items-center gap-3 px-3 py-2 rounded-lg text-[13.5px] font-medium transition-all duration-150; }
```

---

### FIX 9 — Input Text Weight
**Problem:** Input text at `text-sm` with default 400 weight feels thin.
**Solution:** Bump to `font-medium`.

**File:** `components/ui/input.tsx`

**Current:**
```
"flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background ..."
```
**Change to:**
```
"flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-medium ring-offset-background ..."
```

---

### FIX 10 — Auth Page Input Consistency
**Problem:** Login page uses custom inline input class, different from `Input` component.
**Solution:** Use the shared `Input` component OR fix inline styles to match.

**File:** `app/auth/login/page.tsx`

**Current:**
```tsx
const inp = "w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500";
```
**Change to:**
```tsx
const inp = "w-full px-3.5 py-2.5 rounded-xl border border-border bg-background text-sm font-medium focus:outline-none focus:ring-2 focus:ring-violet-500 placeholder:text-muted-foreground";
```

Apply same fix to:
- `app/auth/signup/page.tsx`
- `app/auth/forgot-password/page.tsx`
- `app/auth/reset-password/page.tsx`

---

### FIX 11 — Landing Page Typography
**Problem:** Landing hero text weights good but body text at `text-lg text-slate-500` feels faint.
**Solution:** Darken body text, increase weight.

**File:** `app/page.tsx`

**Hero subtitle:**
```tsx
// Current:
<p className="mt-4 sm:mt-6 text-base sm:text-lg lg:text-xl text-slate-500 max-w-2xl mx-auto leading-relaxed px-2">
// Change to:
<p className="mt-4 sm:mt-6 text-base sm:text-lg lg:text-xl text-slate-600 font-normal max-w-2xl mx-auto leading-relaxed px-2">
```

**Feature card descriptions:**
```tsx
// Current:
<p className="text-xs sm:text-sm text-slate-500 leading-relaxed">{f.desc}</p>
// Change to:
<p className="text-xs sm:text-sm text-slate-600 leading-relaxed">{f.desc}</p>
```

---

### FIX 12 — Dashboard Stat Card Values
**Problem:** Stat card values at `text-2xl font-bold` — good but could be tighter.
**Solution:** Add `tracking-tight` for premium feel.

**File:** `components/tenant/dashboard-client.tsx`

**Current:**
```tsx
<p className="text-2xl font-bold">{value}</p>
```
**Change to:**
```tsx
<p className="text-2xl font-bold tracking-tight">{value}</p>
```

---

### FIX 13 — Modal/Dialog Title Size
**Problem:** Dialog title uses `text-lg font-semibold` — small for modal header.
**Solution:** Bump to `text-xl`.

**File:** `components/ui/dialog.tsx`

**Current:**
```
"text-lg font-semibold leading-none tracking-tight"
```
**Change to:**
```
"text-xl font-bold leading-none tracking-tight"
```

---

### FIX 14 — Code Font Change
**Problem:** DM Mono is OK but JetBrains Mono is more readable.
**Solution:** Already covered in FIX 1.

---

## 📊 Before vs After Summary

| Element | Before | After |
|---------|--------|-------|
| Font Family | DM Sans (thin on screens) | Inter (UI-optimized, heavier) |
| Base Size | 16px (browser default) | 15px (explicit, tuned) |
| Body Text Weight | 400 (DM Sans = faint) | 400 (Inter = solid) |
| Small Text | `text-sm font-medium` (DM Sans 500 = faint) | `text-sm font-medium` (Inter 500 = clear) |
| Muted Foreground (light) | `hsl(215, 12%, 50%)` | `hsl(215, 10%, 42%)` |
| Muted Foreground (dark) | `hsl(215, 14%, 52%)` | `hsl(215, 12%, 62%)` |
| Buttons | `font-medium` | `font-semibold` |
| Page Titles | `text-lg font-bold` (inconsistent) | `text-xl font-bold` (standard) |
| Sidebar Nav | `text-sm font-medium` | `text-[13.5px] font-semibold` |
| Inputs | `text-sm` (400 weight) | `text-sm font-medium` (500) |
| Dialog Titles | `text-lg font-semibold` | `text-xl font-bold` |
| Landing Body | `text-slate-500` | `text-slate-600` |
| Table Headers | `font-medium` | `font-semibold` |
| Stat Values | `text-2xl font-bold` | `text-2xl font-bold tracking-tight` |

---

## 🚀 Implementation Order

1. **Font swap + colors** (globals.css) — biggest single change
2. **Base font size** (globals.css)
3. **Heading scale** (globals.css)
4. **Button weight** (button.tsx)
5. **Input weight** (input.tsx)
6. **Table header weight** (table.tsx)
7. **Dialog title size** (dialog.tsx)
8. **Sidebar nav** (globals.css + sidebar.tsx)
9. **Dashboard titles + stat values** (dashboard-client.tsx)
10. **Auth page inputs** (login, signup, forgot, reset)
11. **Landing page body text** (page.tsx)

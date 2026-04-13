# NuCRM Modernization — Visual Reference & Direction

## 📸 Reference Dashboard Screenshot Analysis

**Reference app:** Looks like Plaky / modern Kanban project management tool
**Screenshot date:** 2026-04-09
**Why this reference:** Clean, data-dense, professional SaaS — exactly the look we want

---

## What Makes It Look Clean (Key Takeaways)

### 1. Pure White Background Everywhere
- No gray/off-white backgrounds
- Cards sit on pure white `#ffffff`
- NuCRM current: `hsl(220, 14%, 96%)` ≈ `#f4f5f7` — slightly warm gray, feels "off"
- **Fix:** `--background: 0 0% 100%` (pure white)

### 2. Flat Cards — Zero Shadows
- No `box-shadow` anywhere
- Separation via borders only (`border: 1px solid #e5e7eb`)
- No hover shadow lift, no hover border glow
- NuCRM current: Added `hover:shadow-lg` — this feels dated for data apps
- **Fix:** Remove all shadows from cards, buttons, modals

### 3. Tight Border Radius
- Cards use `rounded-lg` (8px), not `rounded-xl` (12px)
- Buttons use `rounded-md` or `rounded-lg`
- NuCRM current: `rounded-xl` everywhere, `--radius: 0.75rem`
- **Fix:** Reduce to `rounded-lg` for cards, `--radius: 0.5rem`

### 4. Lighter Typography — Not Bolder
- Labels: `text-xs` at `font-normal` (400 weight)
- Values: `text-lg` or `text-xl` at `font-medium` (500 weight)
- Almost no `font-bold` or `font-semibold` anywhere
- NuCRM current: We just changed everything to `font-semibold`/`font-bold` — opposite direction
- **Fix:** Revert to `font-medium` max, `font-normal` for labels

### 5. Colored Bar Segments Instead of Icon Circles
- Top stats show horizontal color bar strips (purple gradient segments)
- No icon-in-circle approach
- NuCRM current: Icon circles in stat cards (`w-9 h-9 rounded-xl bg-gradient...`)
- **Fix:** Replace icon circles with simple color bar segments

### 6. Minimal Kanban Cards
- Just: title, tag(s), due date, avatar stack, comment/attachment counts
- No borders around individual cards
- No hover effects on cards
- Cards separated by whitespace, not borders
- NuCRM current: Cards have borders, hover states, shadows
- **Fix:** Remove card borders, reduce padding, simplify content

### 7. Light Gray Sidebar (Not White)
- Sidebar background: very light gray (`bg-gray-50` or `#f9fafb`)
- Active item: subtle blue tint, no heavy color block
- NuCRM current: White sidebar with bright violet active state
- **Fix:** Sidebar `bg-gray-50`, active = subtle blue background

### 8. Prominent Search Bar — Top Center
- Large search input in top bar, centered
- With dropdown/filter icon on right
- NuCRM current: Small search in left side of header
- **Fix:** Center search, make it larger, add filter dropdown icon

### 9. Zero Gradients Anywhere
- No gradient buttons, no gradient cards, no gradient avatars
- Everything is flat, solid colors
- NuCRM current: Gradient stat icons, gradient buttons, gradient avatars
- **Fix:** Remove all gradients — flat colors only

### 10. Numbers Are the Hero
- "24", "4", "7", "109", "27" — big numbers, minimal labels below
- Icons are small and unobtrusive
- NuCRM current: Icons compete with numbers for attention
- **Fix:** Make numbers bigger, icons smaller and secondary

---

## NuCRM Current vs Reference Comparison

| Aspect | NuCRM Current | Reference Dashboard | Verdict |
|--------|--------------|---------------------|---------|
| Background | Warm gray `#f4f5f7` | Pure white `#ffffff` | ❌ Needs change |
| Card shadows | `hover:shadow-lg` | Zero shadows | ❌ Needs change |
| Border radius | `rounded-xl` (12px) | `rounded-lg` (8px) | ❌ Needs change |
| Font weights | `font-semibold`/`font-bold` | `font-medium` max | ❌ Needs change |
| Stat card icons | Gradient circles | Color bar segments | ❌ Needs change |
| Kanban cards | Bordered, hover effects | Flat, whitespace-separated | ❌ Needs change |
| Sidebar | White with violet active | Light gray, subtle active | ❌ Needs change |
| Search | Small, left-aligned | Large, centered | ❌ Needs change |
| Gradients | Buttons, avatars, stats | None | ❌ Needs change |
| Number display | Icon + label + value | Big number + small label | ❌ Needs change |
| Spacing | `gap-5`, `p-6` | `gap-3`, `p-4` | ❌ Needs change |

---

## Previous Implementation — What Was Wrong

We implemented the **opposite** direction. The previous changes added:
- ❌ Heavier font weights (`font-semibold`, `font-bold`)
- ❌ Card shadows on hover
- ❌ Violet active indicator bars
- ❌ Gradient stat icons
- ❌ Shimmer skeletons (nice, keep this)
- ❌ Inter font swap (keep this — Inter is good)
- ❌ `text-xl` page titles
- ❌ `text-slate-600` landing text (this is fine)

**What to KEEP from previous changes:**
- ✅ Inter font (much better than DM Sans)
- ✅ JetBrains Mono for code
- ✅ Shimmer skeleton loaders
- ✅ Staggered fade-in animation
- ✅ `active:scale-[0.97]` on buttons (tactile feel)
- ✅ Muted foreground color brightening (but not as much)

**What to UNDO/CHANGE:**
- ❌ Font weights — back to `font-medium` max
- ❌ Card shadows — remove
- ❌ Border radius — reduce to `rounded-lg`
- ❌ Gradients — remove from stat icons
- ❌ Active indicator bar — replace with subtle bg tint
- ❌ Page title `text-xl font-bold` — back to `text-lg font-medium`

---

## Proposed Direction: Flat, Clean, Data-First

**Philosophy:** For a data-dense CRM, **less is more**.
- White backgrounds, flat cards, minimal borders
- Light typography (400-500 weight)
- Numbers as the hero, icons as secondary
- Tight spacing for information density
- Zero gradients, zero shadows
- Light gray sidebar with subtle active state

**This is the Linear/Vercel/Notion approach for data apps.**

---

## Implementation Plan (After Review)

Phase 1: Undo wrong changes (fonts, shadows, gradients)
Phase 2: Apply flat/clean direction (white bg, tight spacing, minimal cards)
Phase 3: Sidebar redesign (light gray, subtle active)
Phase 4: Search bar redesign (prominent, centered)
Phase 5: Stat card redesign (numbers as hero, color bars)
Phase 6: Kanban card simplification (flat, no borders)

---

## Build Status Before Changes: ✅ PASSED
```
npm run build — 0 errors
```

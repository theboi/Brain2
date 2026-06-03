# Brain2 Console — Design System

Developer reference for the Brain2 web console design language. Every component
must consume tokens from this system. No raw hex values or hardcoded sizes in
component files.

---

## Design Language

**Aesthetic:** focused, calm, developer/knowledge-work — Linear × Obsidian × Vercel.
**Theme:** dark-first with a clean light mode.

---

## Color Tokens

All tokens are CSS custom properties defined in `src/styles/tokens.css` and
applied to `<html>` via `data-theme` and `data-accent` attributes.

### Surfaces

| Token | Dark | Light | Use |
|---|---|---|---|
| `--bg` | `#0B0D10` | `#FCFCFD` | App background |
| `--surface` | `#11141A` | `#FFFFFF` | Cards, panels, sidebar |
| `--surface-2` | `#161A22` | `#F4F5F7` | Nested panels, hover states |
| `--surface-3` | `#1C212B` | `#ECEEF1` | Toggle track, deep nesting |

### Text

| Token | Dark | Light | Use |
|---|---|---|---|
| `--fg` | `#ECEEF2` | `#0F1115` | Primary text |
| `--fg-muted` | `#8B8F98` | `#5C6470` | Secondary text, icons |
| `--fg-faint` | `#5B606B` | `#9AA1AC` | Placeholder, timestamp |

### Borders

| Token | Dark | Light | Use |
|---|---|---|---|
| `--border` | `rgba(255,255,255,.08)` | `#E4E7EB` | Default hairlines |
| `--border-strong` | `rgba(255,255,255,.14)` | `#D4D8DE` | Active/hover borders |

### Accent (user-selectable)

Three options, persisted in `localStorage` as `b2-accent`:

| Key | Dark | Light |
|---|---|---|
| `indigo` (default) | `#7C8CFF` | `#5466E5` |
| `violet` | `#A78BFA` | `#7C3AED` |
| `emerald` | `#34D399` | `#0E9F6E` |

Always reference as `var(--accent)` and `var(--accent-soft)`.

### Semantic

| Token | Use |
|---|---|
| `--success` | Positive state, streaming, accepted |
| `--warning` | Drift, truncation, needs review |
| `--destructive` | Delete, demote, offline |
| `--success-soft` / `--warning-soft` / `--destructive-soft` | Tinted backgrounds for badges |

### Diff

| Token | Use |
|---|---|
| `--diff-add-bg` | Added lines in diffs |
| `--diff-del-bg` | Removed lines in diffs |

---

## Typography

```
UI / body:      Inter (400/500/600) — var(--ui-font)
Headings:       Inter (600/700)     — var(--display-font)
Monospace:      JetBrains Mono      — var(--mono-font)
Display track:  var(--display-track) = -0.02em
```

### Type Scale

| Size | Use |
|---|---|
| 11px | Captions, badge text |
| 12px | Field labels, timestamps, meta |
| 12.5–13px | Secondary body, row data |
| 13.5–14px | Primary body, menu items |
| 15px | Card headings |
| 18px | Panel subtitles |
| 24px | Settings section heading |
| 28px | Home hero greeting |

Body line-height: 1.55. Tabular figures for all numeric data: `font-variant-numeric: tabular-nums`.

---

## Spacing

Built on a **4pt grid**. Common values:

| Value | Use |
|---|---|
| 4px | Tight internal gap (icon + label) |
| 6–8px | Within-component padding |
| 12–14px | Card interior padding |
| 16–18px | Section padding |
| 22–28px | Page-level padding |

---

## Radii

| Token | px | Use |
|---|---|---|
| `--radius-sm` | 6 | Badges, small chips |
| `--radius-md` | 8 | Inputs, buttons |
| `--radius-lg` | 12 | Cards, panels |
| `--radius-xl` | 16 | Modals |
| `--radius-full` | 9999 | Pills |

---

## Motion

| Token | Duration | Use |
|---|---|---|
| `--duration-fast` | 140ms | Micro-interactions (hover, toggle) |
| `--duration-base` | 200ms | State transitions (expand, slide) |
| `--duration-slow` | 300ms | Modals, page transitions |
| `--ease-out` | `cubic-bezier(0.16,1,0.3,1)` | Enter animations |

All animations respect `prefers-reduced-motion` — the `.b2-pulse` and `.b2-spin`
classes are disabled when reduced motion is on.

---

## Component Inventory

### Base UI (`src/components/ui/`)

| Component | Description |
|---|---|
| `Icon` | Lucide icon wrapper, consistent size + stroke-width |
| `StatusDot` | Agent status indicator — color + glyph, never color-only |
| `Button` | `primary` / `ghost` / `danger` / `icon` variants |
| `Badge` | Status chip — `accent` / `success` / `warning` / `destructive` / `muted` |
| `Toggle` | Boolean switch (ARIA `role="switch"`) |
| `Field` | Labeled text input with visible label |
| `Panel` | Card wrapper with optional header + right-action |
| `MoreLink` | Subtle "view all" link used inside panels |
| `SectionLabel` | Uppercase section heading with optional action |
| `Popover` | Click-to-open overlay, Escape-to-close |
| `ModalOverlay` | Full-screen backdrop + centered content portal |
| `SegmentedControl` | 2–3 option inline selector |

### Layout (`src/components/layout/`)

| Component | Description |
|---|---|
| `TopBar` | Brand + workspace switcher + search bar + inbox bell + profile |
| `LeftRail` | Icon-only sidebar that expands to labels on hover (desktop only) |
| `BottomNav` | Mobile bottom tab bar with "More" overflow dropup |
| `AppShell` | Full-height shell composing TopBar + LeftRail + main + BottomNav |

### Charts (`src/components/charts/`)

| Component | Description |
|---|---|
| `Sparkline` | Tiny inline trend (no axes) |
| `AreaChart` | Single-series area with gradient fill |
| `StackedArea` | Multi-series stacked area |
| `BarsH` | Horizontal bar chart for category comparison |

### Dashboard (`src/components/dashboard/`)

| Component | Description |
|---|---|
| `AgentCard` | Status + sparkline + "Open chat" CTA |
| `AddAgentTile` | Dashed tile for adding a new agent |
| `StatTile` | Big-number metric + area chart |
| `Legend` | Series legend for stacked charts |
| `ActivityPanel` | Live-updating event feed with pulsing dot |
| `WikiHealth` | Provenance score + health metric rows |
| `QuickActions` | Plugin-powered one-tap action tiles + chat tile |

### Settings (`src/components/settings/`)

| Component | Description |
|---|---|
| `SCard` | Settings section card with header/description/action |
| `SRow` | Label + description + right-slot row |
| `RoleBadge` | Member role chip |
| `Integration` | Icon + name/description integration row |
| `SBtn` | Settings context button (alias for Button) |

---

## Accessibility Requirements

- **Contrast:** All text ≥4.5:1 (AA). `--fg` on `--bg`, `--fg` on `--surface`.
- **Color not the only signal:** `StatusDot` always pairs color with a glyph or
  ARIA label. Status badges pair icon + text.
- **Touch targets:** All interactive elements ≥44×44px (or extend hit area via padding).
- **Focus:** All interactive elements have visible focus rings. Never remove
  `outline` without replacing it.
- **Keyboard:** Full keyboard navigation throughout. `Escape` closes all overlays.
- **Motion:** `.b2-pulse` / `.b2-spin` animations respect `prefers-reduced-motion`.

---

## Adding New Pages

1. Create `src/pages/<PageName>/index.tsx`.
2. Use `AppShell` via the router — don't re-implement the shell.
3. Access theme/accent via `useTheme()`.
4. Use only token variables — never `#rrggbb` directly.
5. Import icons from `@/components/ui/Icon`.
6. Add your route to `src/App.tsx`.

---

## Theming

Theme and accent are stored in `localStorage` as `b2-theme` and `b2-accent`
and applied to `<html data-theme="dark" data-accent="indigo">` on load via
`applyTheme()` in `src/main.tsx`. This prevents FOUC.

The `useTheme()` hook in `src/hooks/useTheme.ts` provides reactive access to
`theme` and `accent` plus setters that update both state and the DOM attribute.

The Settings → Appearance section is the only place where these are user-editable.

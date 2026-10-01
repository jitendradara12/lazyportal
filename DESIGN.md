# Design System

## Theme & Aesthetic

Material 3 Expressive Light – Mono Theme.
A restrained, clean, high-density utility interface designed for fast mobile lookups. Built around soft tinted neutrals with selective status accents (success green, warning amber, error red) that highlight attendance thresholds and exam urgency.

## Color Palette

### Roles & Tokens

| Token | Value | Role |
|---|---|---|
| `--primary` | `#4A4459` | Slate purple; primary interactive elements, active chips |
| `--onPrimary` | `#FFFFFF` | Text on primary elements |
| `--primaryContainer` | `#E6E0F0` | Icon backgrounds, subtle highlights |
| `--onPrimaryContainer` | `#1A1626` | Icon fills and container text |
| `--secondary` | `#5F5D65` | Muted secondary controls |
| `--secondaryContainer` | `#E6E1E6` | Secondary buttons |
| `--tertiaryContainer` | `#E9E0EA` | Highlight action pills (e.g. Reconnect button) |
| `--surface` | `#FCF8FD` | Page background |
| `--surfaceContainerLow` | `#F5F1F6` | Card backgrounds |
| `--surfaceContainer` | `#EFEBF0` | Table headers, chip backgrounds |
| `--surfaceContainerHigh` | `#E9E5EA` | Borders, divider lines, active states |
| `--onSurface` | `#1C1B1F` | High-contrast body text, headings |
| `--onSurfaceVariant` | `#48454E` | Muted labels, secondary descriptions |
| `--outlineVariant` | `#CAC4D0` | Subtle container borders |

### Semantic & Status Accents

- **Safe / Attended:** `--success: #137333` | Container: `#E1F3E6`
- **Short / Absent / Error:** `--error: #B3261E` | Container: `#F9DEDC`
- **Session Expiry Notice:** `#F9A825` border over `#FFF8E1` background

### Attendance Threshold Tiers

Attendance percentages are rendered directly as colored figures (no background pills):
- `< 70%`: `#B3261E` (Critical shortage)
- `70% – 79.9%`: `#B06000` (Warning zone / near 75% cutoff)
- `80% – 89.9%`: `var(--onSurface)` (Normal safe zone)
- `≥ 90%`: `#137333` (High safety margin)

## Typography

- **Font Family:** `system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`
- **Tabular Figures:** `font-variant-numeric: tabular-nums` applied across all numbers, dates, marks, and percentages for vertical alignment.
- **Scale:**
  - Header Greeting: `22px` (mobile) / `30px` (desktop), `font-weight: 700`, `letter-spacing: -0.015em`
  - Section Headlines: `17px`–`18px`, `font-weight: 500`–`700`
  - Body Text: `15px`–`16px`, `line-height: 1.5`
  - Supporting / Captions: `13px`–`14px`, `font-weight: 400`–`500`
  - Badges / Microcopy: `11px`–`12px`, `font-weight: 600`

## Shape, Space & Radii

- **Grid Container:** Max width `720px` centered, mobile padding `20px` with safe-area insets.
- **Corner Radii:**
  - `--r-xl: 28px`: Outer card container ends, dialogs, login sheet
  - `--r-lg: 20px`: Standalone containers, detail boxes
  - `--r-md: 14px`: Stacked card inner corners, text inputs
  - `--r-sm: 10px`: Select pickers
  - Pills: `9999px` (Action buttons, status badges, chips)
- **Minimum Touch Target:** `--tap: 48px` (inputs, buttons, list headers).

## Material 3 Component Patterns

### 1. Expressive Stacked Card Group
Collapsible cards are stacked in a unified vertical list (`gap: 8px`):
- First card: top corners rounded at `28px`, bottom corners at `14px`.
- Middle cards: all corners rounded at `14px`.
- Last card: bottom corners rounded at `28px`, top corners at `14px`.
- Single card: all corners rounded at `28px`.

### 2. Collapsible Header Row
- `48px` circular icon container (`--primaryContainer`).
- Title + supporting status text (e.g., `"Attendance" · "2 short"` or `"Exams" · "3 scheduled"`).
- Rotating trailing chevron indicating expansion state (`transform: rotate(90deg)`).

### 3. Subject Row & Drill-down
- Clickable table rows expand in-place to reveal class-by-class attendance logs.
- Includes bunk margin indicator: `"Can bunk 3"` (`#137333`) or `"Need 2 classes"` (`#B3261E`).
- Filter chips (`All`, `Absent`, `Present`) to quickly audit missed classes.

### 4. Dialogs & Bottom Sheets
- Mobile ($\le 640\text{px}$): Slides up as an M3 bottom sheet pinned to the viewport bottom (`border-radius: 28px 28px 0 0`).
- Desktop ($> 640\text{px}$): Centered modal card (`max-width: 440px`, `border-radius: 28px`).

## Motion

- **Spring Curve:** `--motion-spring: cubic-bezier(0.34, 1.56, 0.64, 1)` for chevron rotation, button presses, and micro-interactions.
- **Standard Curve:** `--motion-standard: cubic-bezier(0.2, 0, 0, 1)` for surface color transitions.
- **Feedback:** Tactile scale depression on tap (`transform: scale(0.96)` to `scale(0.985)`).
- **Reduced Motion:** All transitions and animations reset to `0.01ms` when `@media (prefers-reduced-motion: reduce)` is active.

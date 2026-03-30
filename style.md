# 3D CT Viewer UI/UX Style

Use this file as context when redesigning or remaking cards in the dataset statistics UI and adjacent desktop/Electron screens.

## Product Frame

- App type: desktop/Electron CT + segmentation viewer for scientists and clinicians.
- Primary user mindset: technical, time-limited, accuracy-first.
- Design goal: make complex cohort and per-case information feel calm, trustworthy, and fast to scan.
- Success metric: one clear outcome per card, with exact technical values still available.

## Core Style

- Tone: calm, warm neutrals with restrained contrast.
- Accent: terracotta is reserved for primary action or app identity, not decoration.
- Data color: use semantic colors only when they mean something.
- Visual rhythm: soft borders, compact spacing, clear typography hierarchy, almost no visual noise.
- Default mood: "scientific instrument panel", not "marketing dashboard".

## Non-Negotiables

- Never hard-code new colors. Use the existing Tailwind tokens mapped from `frontend/app/globals.css`.
- No decorative gradients.
- No heavy shadows.
- No rainbow color coding for unrelated categories.
- No long explanatory paragraphs inside cards.
- No opaque IDs in place of meaningful labels like `512x512x611` or `0.920 x 0.920 x 0.500`.
- If a label must be shortened, preserve the full value in a tooltip, title, or secondary line.

## Tokens

Use these semantic roles, not raw values:

- Surface: `background`, `card`, `popover`, `muted`
- Text: `foreground`, `muted-foreground`
- Structure: `border`, `input`, `ring`
- Brand/action: `primary`, `primary-foreground`
- Data meaning only: `positive`, `warning`, `negative`, `info`
- Plot series only: `chart-1` to `chart-5`

Palette intent from `frontend/app/globals.css`:

- `background` / `card`: warm off-white surfaces
- `foreground`: soft dark brown-gray
- `muted`: quiet neutral fill for inset wells
- `border`: low-contrast structure, never harsh outlines
- `primary`: terracotta, used sparingly

## Card Anatomy

Default composition should follow the existing shadcn primitives under `frontend/components/ui/`:

1. `Card`
2. `CardHeader`
3. `CardTitle`
4. `CardDescription`
5. `CardContent`
6. `CardFooter` only when needed

Card guidance:

- One card = one primary story.
- Header should answer "what is this?" in one line.
- Description should be one short support sentence, not a mini manual.
- Content should be grouped into 1 to 3 clear blocks.
- Use `rounded-lg` / `rounded-xl` surfaces with soft borders.
- It is fine to add a subtle `ring-1 ring-border/...` when a card needs stronger presence, but keep it quiet.

## Subcomponents To Reuse

### Status badge

- Use `Badge`.
- `outline` for neutral or semantic status.
- `secondary` for small factual chips.
- Keep badges short: `Aligned`, `Needs review`, `8 loaded`, `3 spacing triplets`.
- Semantic color only when the badge communicates actual state.

### Summary callout

- A short highlighted block at the top of a card is good when the card has a single conclusion.
- Use a soft tinted border/background with `positive` or `warning`.
- Structure:
  - first line: direct outcome
  - second line: one sentence of technical context
  - optional chip row: concise facts

### Metric tiles

- Good for 3 to 6 compact cohort checks like spacing, origin, orientation, mismatch count.
- Use small uppercase labels, one strong value line, and one quieter detail line.
- Include tooltip help for jargon such as `LPS`, `affine`, or orientation matrix.
- Do not make the whole tile look like a CTA unless it is actually clickable.

### Stat rows

- Best for dense factual metadata.
- Layout: label on the left, value on the right.
- Labels use `text-muted-foreground`.
- Values use `font-mono` or `tabular-nums` when numeric/technical.
- Truncate only secondary file/path content, not the primary scientific value.

### Tables

- Use for per-case or per-label listings.
- Keep headers small and muted.
- Use sticky headers only when the table scrolls.
- Use borders to separate rows, not zebra striping.
- Technical columns should use monospace or tabular numbers.

### Tooltip

- Use `Tooltip` for jargon, definitions, or full-value recovery.
- Tooltip text should be short, specific, and written in user-facing language.
- Tooltips explain; they should not carry critical primary information that is unavailable elsewhere.

### Buttons and controls

- Follow existing `Button` variants: `default`, `outline`, `secondary`, `ghost`, `link`.
- `default` is the strongest action.
- `outline` is preferred for utility actions inside dense panels.
- Avoid oversized buttons in information cards.

### Separator

- Use `Separator` to divide conceptual groups inside a card.
- A separator should usually introduce a new content block, not decorate spacing.

## Plot Style

Charts in this app should feel analytical and readable, not flashy.

### General rules

- Use `ChartContainer` from `frontend/components/ui/chart.tsx`.
- Use `chart-*` tokens for series color.
- Axes, grid, and labels should stay low-contrast and secondary to the data.
- Avoid animation unless it helps orientation.
- Preserve exact labels for scientific values whenever possible.

### Bar charts

- Prefer bars for cohort distributions and count comparisons.
- Horizontal bars are preferred when category labels are long.
- Rounded corners are acceptable, but keep them subtle.
- Ensure right-side `LabelList` values and axis labels never clip at common window widths.

### Axis labels and ticks

- Technical category labels may use monospace.
- Long geometry labels should remain readable before they are shortened.
- If width is tight, prefer:
  1. horizontal bar layout
  2. more left margin / computed axis width
  3. later stacking breakpoint
  4. tooltip fallback
- Do not aggressively abbreviate geometry triplets.

### Chart containers

- A chart can sit inside a quiet inner panel: `rounded-xl border border-border/60 bg-muted/15 p-4`.
- This inner panel is useful when the parent card already contains multiple sections.
- Keep chart titles and subtitles compact and above the plot area.

### Tooltip content for charts

- First line: count or main numeric takeaway.
- Second line: the full label/value.
- Use `tabular-nums` or `font-mono` for technical values.
- Keep the tooltip compact and readable.

### Empty states

- Empty chart state should say exactly what is missing.
- Example: `No spacing data.`
- No generic `No data available` unless nothing more specific is possible.

## Typography

- `CardTitle`: compact, high-confidence, usually `text-base` to `text-lg`.
- `CardDescription`: short and muted.
- Section labels inside cards: small, muted, sometimes uppercase if they are structural rather than narrative.
- Numeric values: `tabular-nums`.
- Technical identifiers and geometry strings: monospace when it helps parsing.

## Spacing

- Prefer `gap-*` and `flex flex-col`, not `space-y-*`, for new layout work.
- Use consistent vertical rhythm inside cards:
  - header
  - summary
  - metrics
  - separator
  - charts or tables
- Dense cards should feel packed but not cramped.

## Accessibility

- Focus states must use the existing ring token.
- Semantic color cannot be the only signal; pair it with text such as `Aligned` or `Needs review`.
- Tooltip triggers must be keyboard reachable.
- Chart labels and summary text must remain legible in both light and dark themes.

## Content Rules

- Write in user-facing language first, technical language second.
- Prefer `Orientation` over `3x3 direction cosine matrix` in visible UI; move the latter into tooltip/help text.
- Use exact units in visible labels where needed: `(mm)`, `(mm3)`, `HU`.
- Keep scientific honesty: simplify presentation, not the data.

## Reuse Recipe For New Stats Cards

When remaking another card, aim for this structure:

1. Clear title + one-line description
2. One focal summary block with the main outcome
3. 3 to 6 compact supporting metrics
4. One secondary section for distribution, breakdown, or table detail
5. Tooltip help for jargon and full technical values

## Anti-Patterns

- Decorative accent colors on every sub-block
- Multiple competing "important" elements in one card
- Large prose blocks explaining obvious metrics
- Tiny charts with clipped labels
- Truncating the only meaningful scientific identifier
- Replacing exact values with generic bucket IDs
- Overusing warning color so everything feels broken

## Source Patterns In This Repo

- Tokens: `frontend/app/globals.css`
- Card primitives: `frontend/components/ui/card.tsx`
- Badge primitives: `frontend/components/ui/badge.tsx`
- Tooltip primitives: `frontend/components/ui/tooltip.tsx`
- Chart wrapper: `frontend/components/ui/chart.tsx`
- Reference stats card: `frontend/components/dataset-lesion-size-chart.tsx`
- Reference dense metadata card: `frontend/components/volume-info-card.tsx`


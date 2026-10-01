# Ascent Protein theme — build conventions

Applies to every task on this theme (AP-*), whether built by hand, by Vision Code or by a
Theme Factory run.

## Build with blocks (customiser first)

- Every new section exposes its content as **theme blocks** (`blocks/*.liquid`), rendered
  with `{% content_for 'blocks' %}`, so merchants can add, remove and reorder content in the
  theme editor. The section schema accepts `@theme` and `@app` blocks.
- Section settings are only for things that belong to the whole section (media, height,
  colours, scrim, spacing). Headings, text, buttons, badges, cards, etc. are blocks.
- Reuse existing blocks before writing new ones: `button` (AP-51 styles/sizes/icon),
  `text` / `_heading` (AP-49 type presets), `group`, `image`, and the AP blocks
  (`ap-headline`, `ap-button-group`, `ap-review-badge`).
- New blocks are generic and reusable in any section (no section-specific names); prefix
  them `ap-`. Repeating items (slides, cards, logos) are nested blocks, not numbered
  settings.
- Ship a section `presets` entry with the Figma content as default blocks, and put the real
  homepage content in `templates/*.json`.

## Design system

- Colours: `--ap-*` tokens in `snippets/ap-color-tokens.liquid` (AP-50).
- Type: `--font-<preset>--*` tokens in `snippets/ap-typography-tokens.liquid` and the
  `ap-*` preset classes in `assets/ap-typography.css` (AP-49).
- Buttons: `assets/ap-buttons.css`, `snippets/ap-button.liquid`, `blocks/button.liquid` (AP-51).
- Desktop breakpoint is `min-width: 750px` (Horizon).

## Workflow

- One branch per task: `task/ap-<n>-<slug>`; commit messages start with the task key.
- `shopify theme check` must report 0 errors before pushing.
- Preview on an unpublished theme on `anatta-ai.myshopify.com`; never push to the live theme.

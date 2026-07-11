# Dynamic Island TOC

## What was built

An Angular port of a React `DynamicIslandTOC` component. It renders as a floating pill at the bottom center of the stock detail page showing the currently visible section and a circular scroll-progress arc. Clicking the pill expands it into a full table of contents with a backdrop blur overlay.

## Key decisions

- **No new npm packages.** The React version used `motion/react` and `lucide-react`. For Angular, `@angular/animations` (already a peer dep) handles all transitions, and the X icon is an inline SVG path. The circle progress is pure SVG math in the template.
- **Replaced the sidebar.** The old `<aside class="qp-sidebar">` static TOC was removed. The island floats over the content instead, making the article full-width and less cluttered.
- **Section IDs are unchanged.** The component reads `section-{key}` IDs already set by `*ngFor` in the stock detail template. The `sectionPrefix` input defaults to `section-` so the binding is zero-config.

## How it works

1. `ngOnInit` attaches a passive `scroll` listener.
2. On each scroll event, the component iterates `sections` and checks `getBoundingClientRect().top <= 120` to find the active section; computes `progress` (0–100) from `scrollY / (scrollHeight - innerHeight)`.
3. The pill displays the active section label and an SVG arc whose `stroke-dashoffset` is derived from `progress`.
4. Clicking the pill sets `isExpanded = true`, triggering the `@island` Angular animation (width 280→340, height 52→400, border-radius 26→24, duration 500ms custom cubic-bezier).
5. `@pillContent` and `@menuContent` crossfade (opacity + scale/blur) so the pill content fades out as the menu fades in.
6. `@backdrop` fades a `position: fixed` full-screen div in/out on `*ngIf`.
7. Clicking a TOC item calls `scrollTo(key)` which offsets by −80px for fixed headers, then closes the island.

## Files changed

| File | Change |
|------|--------|
| `src/app/components/dynamic-island-toc/dynamic-island-toc.component.ts` | New — component with animations and scroll spy |
| `src/app/components/dynamic-island-toc/dynamic-island-toc.component.html` | New — template |
| `src/app/components/dynamic-island-toc/dynamic-island-toc.component.css` | New — styles |
| `src/app/app.module.ts` | Added `BrowserAnimationsModule` + declared the new component |
| `src/app/pages/stock-detail/stock-detail.component.html` | Removed sidebar, added `<app-dynamic-island-toc>` |
| `src/styles.css` | Changed `.qp-body` from 2-column grid to `display: block` |

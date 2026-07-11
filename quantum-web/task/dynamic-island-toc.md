# Task: Dynamic Island TOC Integration

Port the React `DynamicIslandTOC` component to Angular and integrate it into the stock detail page, replacing the static sidebar TOC.

## Checklist

- [x] Create component directory `src/app/components/dynamic-island-toc/`
- [x] Write `dynamic-island-toc.component.ts` with Angular animations (island expand/collapse, pill/menu crossfade, backdrop fade)
- [x] Write `dynamic-island-toc.component.html` with backdrop, collapsed pill, and expanded menu
- [x] Write `dynamic-island-toc.component.css` with fixed positioning and custom styles
- [x] Add `BrowserAnimationsModule` to `app.module.ts`
- [x] Declare `DynamicIslandTocComponent` in `app.module.ts`
- [x] Remove sidebar `<aside>` from `stock-detail.component.html`
- [x] Add `<app-dynamic-island-toc [sections]="sections">` to `stock-detail.component.html`
- [x] Update `.qp-body` in `styles.css` from 2-column grid to single block
- [x] Verify dev server compiles and returns HTTP 200

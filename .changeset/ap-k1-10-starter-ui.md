---
'create-tassyir-app': patch
---

The starter's page is drawn with `@tassyir/ui` (a new dev dependency of generated projects, `^0.1.0`), so it reads as part of the dashboard: the pending orders in a `<tsy-table>` with a `<tsy-status-pill>` for the high-value ones, the setting in a `<tsy-card>` with a `<tsy-text-field>` (its error shown on the field), a skeleton while it loads and an empty state. `followDashboardContext` replaces the page's own context code, and the template's `app.css` is gone (the few layout rules are a constructable stylesheet, so the page keeps `style-src 'self'`). Amounts read as the dashboard writes them (`DZD 7,500`, `7.500 دج`) through a new `formatAmount` in `src/shared/money.ts`. `AGENTS.md`, the README and the `tassyir-app` skill say how to build on it.

# @tassyir/ui

## 0.1.0

### Minor Changes

- c723ae5: First release: web components that make an app's page look like the Tassyir dashboard. The dashboard's design tokens (light and dark, as CSS custom properties, `@tassyir/ui/tokens` and `@tassyir/ui/tokens.css`) and fifteen elements built from them: `<tsy-button>`, `<tsy-link>`, `<tsy-text-field>`, `<tsy-select>`, `<tsy-checkbox>`, `<tsy-radio-group>` / `<tsy-radio>`, `<tsy-card>`, `<tsy-page-header>`, `<tsy-table>`, `<tsy-status-pill>`, `<tsy-banner>`, `<tsy-empty-state>`, `<tsy-skeleton>` and `<tsy-spinner>`. They work right to left and left to right, light and dark; `followDashboardContext(bridge)` follows App Bridge's language, direction and theme. Form controls are form-associated (native `<form>`, validation, reset). No runtime dependency, no analytics, no storage, no network; safe under a strict Content-Security-Policy and Trusted Types. Browser only, ESM only.

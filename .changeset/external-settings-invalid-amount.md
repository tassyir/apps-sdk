---
'create-tassyir-app': patch
---

The `external` template's `PUT /api/settings` answers 400 `SETTINGS_INVALID` for a `highlightFrom` string that is not an amount (`"5000.001"`, `"abc"`), as the `hosted` template does. It used to read such a string as `null` and clear the saved setting.

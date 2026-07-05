# ADR-0002: Shared localization catalog

Status: accepted

The launcher supports Japanese, English, Simplified Chinese, Traditional
Chinese, Korean, and Spanish. A `system` preference resolves from
Electron/navigator locale; users may override it in the sidebar. Unsupported
system locales fall back to English.

One typed catalog in `src/shared/i18n.ts` is bundled into both renderer and main
processes. This prevents tray/dialog text from drifting away from the visible
window. Static HTML uses `data-i18n` attributes; dynamic status text calls the
same typed translator.

Missing keys are compile-time errors because every translated catalog must
satisfy the Japanese key set. Interpolation is named and deliberately simple.

Low-level logs may remain English for diagnostic searchability. All actionable
window, tray, picker, dialog, and notification text belongs in the catalog.

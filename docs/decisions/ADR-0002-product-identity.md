# ADR-0002: MOS 4.0 product identity

Date: 2026-11-17 · Status: accepted

## Context

The installed application must be unmistakably MOS 4.0, not a ZCode installation
with a plugin bolted on. Upstream keeps all packaging identity in one module, so a
narrow, merge-friendly change is possible.

## Decision

Central identity (`packages/desktop/scripts/desktop-product-identity.mjs`):

| Field | Production | Preview |
|---|---|---|
| productName | `MOS 4.0` | `MOS 4.0 Preview` |
| appId | `org.payswapdotorg.mos4` | `org.payswapdotorg.mos4.preview` |
| linux executable/package | `mos` | `mos-preview` |
| dev AUMID | `org.payswapdotorg.mos4.dev` | — |

Version 4.0.0 everywhere (ADR-0001). Product mark: geometric white "M" on an
indigo→cyan rounded tile, generated deterministically by
`scripts/mos/generate-product-icons.py` (SVG twin in
`packages/ui/src/assets/mos-app-logo.svg`); the script regenerates every icon size,
the `.ico`, and the web favicon.

User-facing strings switched to MOS 4.0: window title (`packages/web/index.html`),
About dialog (`about.ts`), welcome aria-label, web-auth brand, remote-control and
share page brands, Endpoint dialog title, Finder workflow name/labels, dev bundle
identity (`MOS 4.0 Dev`, `org.payswapdotorg.mos4.development`).

## Modified upstream files (complete list for this decision)

`packages/desktop/scripts/desktop-product-identity.mjs`,
`packages/desktop/scripts/devElectronAppBundle.mjs` (+ its test),
`packages/desktop/src/main/{about,desktopCommandHandlers,desktopFinderOpenFolderWorkflow,desktopHostProcess}.ts`,
`packages/desktop/package.json`, `packages/web/index.html`,
`packages/web/src/auth/webAuthLocale.ts`,
`packages/web/src/web-remote-control/ui/webRemoteControlConnectionSheet.tsx`,
`packages/ui/src/{WelcomeScreen.tsx,components/ui/ZCodeAboutLogo.tsx,components/mobile-ui/ZCodeAppLogo.tsx,root/PostUpdateReleaseNotesDialog.tsx}`,
`packages/web/src/share-manage/ConversationShareManagePage.tsx`,
`packages/web/src/share/ConversationShareLandingPage.tsx`,
icon assets under `public/logo/icons/` and `packages/desktop/build/`,
tests `desktopProductIdentity.test.ts`, `container-boot.test.ts`,
`help-menu-about.test.ts`, root `package.json` + `package-lock.json`.

## Deliberately unchanged

The `zcode://` deep-link scheme and `ZCODE_*` environment/config names (runtime
infrastructure, not branding); deeper marketing copy (Stage 4 UI pass); the
`data-app-logo="zcode"` test hook value (E2E selector stability).

## Consequences

- Installer/exe names, shortcuts, and Windows AUMID are MOS-owned from the first
  build; `MOS 4.0` installs beside any ZCode copy without collisions.
- Auto-update still points at ZCode infrastructure (see KNOWN-ISSUES); MOS
  releases ship through this repository's GitHub Releases until that is repointed.

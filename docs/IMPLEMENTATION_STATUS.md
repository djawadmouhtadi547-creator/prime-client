# PRIME CLIENT — implementation and validation status

This document separates functionality present in source from functionality verified in a real packaged app. The starting workspace contained no Minecraft mod source project, and the current environment could not install npm dependencies, so no application installer or mod JAR is being claimed as a tested output.

## Implemented in source

- Electron main process, React/Vite renderer, TypeScript interfaces, and a restricted `contextBridge` API.
- Electron security defaults: `contextIsolation`, renderer `nodeIntegration: false`, sandboxing, restrictive navigation handling, and an explicit renderer Content Security Policy.
- Local application settings and multiple profiles; create, select, duplicate, rename/configure, and delete profile metadata while preserving game folders.
- Java discovery and version-string parsing; manual Java executable selection.
- Official Mojang version-manifest fetch/cache; Vanilla installer code for version metadata, client JAR, applicable libraries/native archives, asset index/objects, optional logging config, and available SHA-1/size verification.
- A completion marker so a partial failed install is not presented as a complete PRIME CLIENT-managed version.
- Official Microsoft/Xbox/Minecraft sign-in flow using a public-client OAuth authorization-code + PKCE flow, Minecraft entitlement/profile checks, OS-backed credential encryption, and refresh-token handling.
- Vanilla launch argument construction, process/log tracking, and explicit Java/account checks.
- Local `.jar` mod import and enable/disable by filename, ZIP-based resource/shader-pack import, and profile folder shortcuts.
- Source inspection for either a single file or a project folder; Gradle wrapper build with a confirmation prompt and time limit; output JARs are accepted only after a successful build and ZIP central-directory validation.
- Bilingual English/Arabic UI with a dark game-client presentation; light theme is marked experimental.
- Windows NSIS/portable, Linux AppImage/deb, and macOS dmg/zip packaging configuration.
- GitHub Actions source checks, test/build commands, platform artifact uploads, tag-driven releases, and an optional separate mod-source build job.
- README, installation/build/source-build guides, security notes, example configuration, changelog, and MIT license.

## Not implemented or not yet connected

- Fabric, Forge, and NeoForge installation/launch integration. Non-Vanilla profiles are stored for future use, but the current installer and launch service deliberately reject them.
- A local/offline identity mode that launches without a Microsoft/Minecraft session. Existing unexpired encrypted official sessions may work offline, but this is not a bypass for authentication or multiplayer entitlement checks.
- Automatic Java runtime downloads, an online mod catalog, integrated shader-loader installation, news feed, cancellable/retryable per-file download queue, FPS/GPU telemetry, automatic updates/signing, and actual DLSS integration.
- A supplied developer mod source project. No mod JAR has been generated in this workspace.

## Validation performed in this workspace

- TypeScript/TSX syntax parsing: 12/12 source files passed with the globally available TypeScript compiler API.
- Temporary-stub static checks: Electron/shared and renderer source passed no-unused and additional static checks against temporary ambient stubs (implicit-any checking was relaxed because several upstream package types were stubbed). These stubs are not shipped and do not replace checking against the installed upstream package types.
- Java version parser: 4/4 direct cases passed (Java 21, Java 17, legacy Java 8 notation, and unrelated output).
- `package.json` and `config.example.json` parse as valid JSON.
- Placeholder PNG/ICO/ICNS files were identified by the system file inspector as valid image/icon formats.
- Workflow YAML parsed with a YAML parser. GitHub Actions has not run in this environment.

## Not verified

- `npm run typecheck`, `npm test`, Vite bundling, Electron compilation with the real installed package type definitions, Electron startup, packaged Windows/Linux/macOS installers, Microsoft authentication, downloads from Mojang, or an actual Minecraft play session.
- A real mod build, because no source project was present.

The workspace had no usable local npm dependency cache, and package-lock generation in offline mode failed because required packages were not cached. For that reason there is no fabricated `package-lock.json`; top-level dependencies in `package.json` are exact-version pinned, and the GitHub workflow uses `npm install`. For strongest reproducibility, generate and commit a real lockfile with `npm install` when npm registry access is available, then change CI to `npm ci`.

## Optional mod-source GitHub build

Set repository Actions variables `MOD_SOURCE_DIR` (a repository-relative folder containing the source project and wrapper) and `MOD_JAVA_VERSION` (the Java major version required by that project). The workflow refuses to guess the Java version and uploads only real JARs produced by a successful Gradle build.

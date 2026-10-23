# PRIME CLIENT

**A Minecraft Java launcher and profile manager — by djawad1**

PRIME CLIENT is a desktop application scaffold with a real Electron/React architecture, safe IPC boundaries, profile storage, Mojang version-manifest caching, vanilla version installation with an explicit completion marker, Microsoft/Xbox/Minecraft account authentication hooks, mod/resource import, Java detection, and a Gradle source-project inspection/build workflow.

> **Honest status:** this repository is a first implementation, not a claim that every item in the large master specification is complete. Fabric/Forge/NeoForge installation, an in-app news service, automatic Java runtime downloads, and full device testing remain unfinished. Microsoft sign-in requires an application Client ID registered for a public desktop app. A Minecraft account with Java Edition entitlement is required for official account launch. There is no bundled game content.

## Requirements

- Node.js 20 or newer and npm
- Java appropriate to the selected Minecraft version (for example, modern versions may require Java 21 or Java 17)
- Windows 10/11 for the primary packaged target; Linux/macOS build workflows are also included but need native runners to package and test
- A Microsoft application Client ID to enable account sign-in

## Run in development

```bash
npm install
npm run dev
```

The `npm run dev` command starts Vite, compiles Electron in watch mode, and opens the app. To launch the compiled app instead:


```bash
npm run build
npm start
```

## Build installers locally

```bash
npm install
npm run dist:win
```

Outputs are written to `release/`. Linux and macOS commands are documented in `docs/BUILDING.md`. macOS artifacts should be built on a macOS runner; signing/notarization requires the developer's own credentials.

## Microsoft sign-in setup

1. Create/register a public desktop application in Microsoft Entra.
2. Configure supported personal Microsoft accounts and the appropriate public-client/loopback redirect behavior.
3. Copy the application's **Client ID** into Settings → Accounts in PRIME CLIENT. Client ID is not a client secret.
4. Use the official sign-in window. PRIME CLIENT never asks for a Microsoft password inside its own form.
5. The account must have Minecraft: Java Edition entitlement and a Minecraft profile. Tokens are stored through Electron `safeStorage` when OS encryption is available; if encryption is unavailable, credential persistence is refused.

The exact app-registration requirements can change, so consult Microsoft's and Minecraft's official documentation while configuring your own application. This source does not include a developer's app ID, secret, or credentials.

## Minecraft installation and profiles

The Versions page reads the official Mojang version manifest and caches it for offline browsing. Installing a version downloads the official version metadata, client JAR, applicable listed libraries, asset index, and asset objects, verifying SHA-1 hashes where supplied. Downloads need an internet connection. A complete game launch requires a successful official Microsoft/Xbox/Minecraft sign-in and a compatible local Java runtime.

Profiles have independent game directories. Removing a profile removes its profile metadata only; it deliberately does not delete game data. Vanilla is the supported install/launch target in this baseline. Other loader values are stored for planning/UI purposes only and cannot yet be installed by this version.

## Mod and source workflows

- Import local mod `.jar` files into the selected profile's `mods` folder. Imported JARs execute as code inside Minecraft; only use files from sources you trust.
- Resource packs and shader packs can be imported as local ZIP files.
- Source inspection accepts a single source/metadata file or a project folder and reports source files, common metadata, loader hints, and Gradle wrapper availability.
- Building a source project executes its Gradle wrapper. Only build projects you trust. A JAR is reported only when an actual `.jar` is found in a `build/libs` directory after Gradle exits successfully.
- No mod source was bundled because none was present in the starting workspace.

See `docs/INSTALLATION.md`, `docs/BUILDING.md`, `docs/MOD_BUILD.md`, and `SECURITY.md`.

## CI

`.github/workflows/build.yml` runs type checks and unit tests, builds the app, uploads a platform artifact, and creates a GitHub Release only when a version tag (`v*`) is pushed. A mod JAR is not fabricated: the optional mod build job uses the repository variables `MOD_SOURCE_DIR` and `MOD_JAVA_VERSION` and uploads a JAR only after a successful real Gradle build.

## License

MIT; see `LICENSE`. Minecraft is a third-party product. PRIME CLIENT is not affiliated with or endorsed by Mojang or Microsoft.

### Optional GitHub Actions mod build

To build a mod source project stored in this repository, configure the repository Actions variables `MOD_SOURCE_DIR` (repository-relative directory) and `MOD_JAVA_VERSION` (the Java major version supported by that mod). The workflow intentionally does not guess a Java version or create an artifact when no source project is configured.

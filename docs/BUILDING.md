# Building PRIME CLIENT

## Local developer build

```bash
npm install
npm run typecheck
npm test
npm run build
npm start
```

## Windows

```bash
npm install
npm run dist:win
```

`release/` contains the NSIS installer and portable executable if electron-builder completes successfully.

## Linux

On a suitable Linux machine:

```bash
npm install
npm run dist:linux
```

The output targets are AppImage and deb. Native system dependencies may be required by the host distribution.

## macOS

Run `npm install && npm run dist:mac` on macOS. Building macOS installers on Windows/Linux is not claimed as supported. Signing and notarization are not configured because developer identities/secrets were not supplied.

## GitHub Actions

Push to `main` or open a pull request to run checks. Push a `v*` tag to run the release matrix and attach successful build artifacts to a GitHub Release. The workflow uses platform-native runners. Signing is intentionally absent.

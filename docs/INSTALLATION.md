# Installation and first run

1. Download the Windows installer or portable build from a published PRIME CLIENT GitHub Release. Releases are published only by the tag-driven CI workflow after the relevant build succeeds.
2. Install/launch PRIME CLIENT and open Settings.
3. Choose a game storage location if the default user-data directory is not suitable.
4. Open Accounts and enter your registered Microsoft desktop-app Client ID, then select **Sign in with Microsoft**. The sign-in occurs in the system browser.
5. Open Versions, refresh the version catalog, choose an official Minecraft Java version, and install it.
6. Open Home or Library, choose the profile, and press Play. A compatible Java runtime is required.

No Minecraft assets or account credentials are bundled. First-time installation needs network access. Microsoft authentication, ownership entitlement, Java compatibility, disk space, and the official metadata endpoints may affect launch success.

## Local development

Use Node.js 20+ and `npm install`. Run `npm run build`, then `npm start`. See `BUILDING.md` for OS-specific package commands.

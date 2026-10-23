# Security Policy

Please do not publish access tokens, refresh tokens, passwords, signing certificates, or other secrets in issue reports. Report suspected vulnerabilities privately to the project maintainer before making them public.

PRIME CLIENT treats imported mods and Gradle projects as executable code. Review untrusted projects before building them. Use the official Microsoft sign-in window; never provide account passwords to third-party forms. Authentication tokens should only be persisted when Electron OS-backed encryption (`safeStorage`) is available.

The project is an early baseline and has not had an independent security audit. Do not treat the absence of a known issue as a security guarantee.

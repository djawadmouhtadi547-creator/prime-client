# Importing and building a Minecraft mod source project

PRIME CLIENT does not assume a source file is a compiled mod. In Source Build, choose the directory containing the source project. Inspection reports Java/Kotlin files, common Fabric/Forge/NeoForge metadata, Gradle files, and whether a Gradle wrapper exists.

A build is attempted only after the user confirms, and only when a wrapper (`gradlew` or `gradlew.bat`) is available. Gradle build scripts are executable code: build only projects you trust. The actual JARs are found under `build/libs` only after the wrapper exits with status zero. This application cannot reliably infer a mod's target Minecraft version from arbitrary source; metadata and Gradle configuration are treated as hints, not proof.

When CI builds a mod source, configure `MOD_SOURCE_DIR` to a repository-relative project directory that includes the wrapper. The workflow fails clearly or skips the optional step when source is unavailable; it never creates an empty placeholder JAR.

## Optional GitHub Actions job

Set repository Actions variables `MOD_SOURCE_DIR` (a safe relative path inside this repository) and `MOD_JAVA_VERSION` (the source project's required Java major version). The job refuses to guess the Java version and uploads a JAR only if the Gradle build succeeds and a JAR is found under a `build/libs` directory.

# Expo Wi-Fi Direct — Android module

This folder is an **Android library** included by the main app via Expo autolinking.

## Fix: "Can't use Java 24 and Gradle 8.9" / "Unsupported class file major version 68"

**Option A — Build from the app root (recommended)**  
- Open the repo root: `D:\Workspace\wifi-direct-poc` (or `wifi-direct-poc\android`).  
- **Stop old Gradle daemons** (important after changing Java path): run `npm run android:gradle-stop` from the repo root, or `cd android` then `.\gradlew.bat --stop`.  
- Then run: `cd android` then `.\gradlew.bat assembleDebug`, or `npx expo run:android`.  
- The root project uses **Gradle 8.14.3**, which supports Java 24.

**Option B — Use JDK 17 for Gradle**  
- Install [JDK 17](https://adoptium.net/) if needed.  
- This folder has **`gradle.properties`** with `org.gradle.java.home` set to Android Studio’s JBR. If you don’t use Android Studio or it’s elsewhere, edit **`gradle.properties`** here and set `org.gradle.java.home` to your JDK 17 path (e.g. `C:/Program Files/Java/jdk-17`). Use forward slashes.  
- Or in **`.vscode/settings.json`** set `java.import.gradle.java.home` to your JDK 17 path. Or set **JAVA_HOME** to your JDK 17 folder and restart the IDE.

Do not use this folder as the Gradle project root. **Build from repo root only.**

**To build:** Use **Terminal → Run Task → "Run Android Build"** (stops Gradle daemons then runs `npx expo run:android`), or from terminal: `npm run android:gradle-stop` then `npx expo run:android`.

**If the "Java 24 and Gradle 8.9" error still appears:** See **`docs/FIX-JAVA-GRADLE.md`** in the repo for the definitive fix (set JAVA_HOME to JDK 17 on Windows, then restart IDE and terminals). Or disable the **Gradle for Java** extension for this workspace and build via the task above.

---

## Wi‑Fi Direct: "P2P enabled: No" / "discoverPeers failed: 2"

- **P2P enabled: No** — The app shows this when the system reports Wi‑Fi P2P as disabled. On init the module requests the current P2P state (Android 10+), so the UI should reflect the real state.
- **What to do:** On both devices turn **Wi‑Fi** and **Location** ON. Some devices have a separate "Wi‑Fi Direct" or "Wi‑Fi preferences" option; enable it if present. Not all devices support Wi‑Fi Direct.
- **Error code 2 (BUSY)** — The system is not ready for discovery (often because P2P is off or not yet ready). The app now shows: *"P2P busy or disabled (ensure Wi‑Fi & Location are ON, then retry)"*. Wait a few seconds and retry, or fix the above and try again.

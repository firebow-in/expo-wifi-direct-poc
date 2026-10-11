# Fix: "Can't use Java 24 and Gradle 8.9" / "Unsupported class file major version 68"

This error appears when Gradle 8.9 runs on Java 24. The following fix works regardless of IDE or how the project is opened.

---

## Definitive fix (Windows)

### 1. Install or locate JDK 17

- **Option A:** Install [Eclipse Temurin JDK 17](https://adoptium.net/temurin/releases/?version=17) (e.g. `jdk-17.0.13`).
- **Option B:** Use Android Studio’s bundled JDK:  
  `C:\Program Files\Android\Android Studio\jbr`  
  (no extra install).

### 2. Set JAVA_HOME

1. Press **Win + R**, type **`sysdm.cpl`**, press Enter.
2. **Advanced** tab → **Environment Variables**.
3. Under **User variables** (or **System variables**), click **New**:
   - **Variable name:** `JAVA_HOME`
   - **Variable value:** path to JDK 17, e.g.  
     - `C:\Program Files\Eclipse Adoptium\jdk-17.0.13`  
     - or `C:\Program Files\Android\Android Studio\jbr`
4. Click **OK** on all dialogs.

### 3. Restart everything

- Close **all** terminals (VS Code/Cursor terminals too).
- **Reload the window** (Command Palette → **Developer: Reload Window**) or restart the IDE.
- This ensures every process (IDE, Gradle, Java extension) uses the new `JAVA_HOME`.

### 4. Stop old Gradle daemons and build

From the **project root** in a **new** terminal:

```bash
npm run android:gradle-stop
npx expo run:android
```

Or use **Terminal → Run Task → "Run Android Build"**.

---

## Why this works

- Gradle 8.9 does not support Java 24 (class file version 68).
- Something (IDE or a previous run) was starting Gradle 8.9 with Java 24.
- Setting **JAVA_HOME** to JDK 17 makes **all** Gradle and Java tools use JDK 17, so the error goes away.

---

## If you cannot set JAVA_HOME

- Build **only** from the project root: **Terminal → Run Task → "Run Android Build"** or `npx expo run:android`.
- Disable the **Gradle for Java** (or **Project Manager for Java**) extension for this workspace so the IDE stops running Gradle on other folders (Problems tab may still show the error until you set JAVA_HOME).

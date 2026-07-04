# command-native — phone-command pipe native source (staging)

`mobile/android/` and `mobile/ios/` are **gitignored** (Expo prebuild output). The
native Kotlin for the phone-command pipe is applied directly to
`android/app/src/main/java/dev/simplist/agentclient/mockup/command/` and builds
into the APK, but that location is NOT version-controlled and would be wiped by
`expo prebuild --clean`.

This directory keeps the **source of truth** in git until the code is converted
into a durable **local Expo module** (the idiomatic prebuild-safe home for custom
native code). Conversion is deferred until the wake mechanism is proven
end-to-end (de-risk-first).

## What's applied outside version control (re-apply if android/ is regenerated)

1. **Kotlin** — copy `kotlin/*.kt` to
   `android/app/src/main/java/dev/simplist/agentclient/mockup/command/`.
2. **MainApplication.kt** — `import dev.simplist.agentclient.mockup.command.CommandPackage`
   and `add(CommandPackage())` in the package list.
3. **AndroidManifest.xml** — inside `<application>`:
   ```xml
   <service android:name="dev.simplist.agentclient.mockup.command.CommandMessagingService" android:exported="false">
     <intent-filter android:priority="1">
       <action android:name="com.google.firebase.MESSAGING_EVENT"/>
     </intent-filter>
   </service>
   ```
   plus `<uses-permission android:name="android.permission.ACCESS_BACKGROUND_LOCATION"/>`.
4. **app/build.gradle** dependencies:
   ```
   implementation("androidx.security:security-crypto:1.1.0-alpha06")
   implementation("com.google.firebase:firebase-messaging:25.0.1")
   ```

The JS glue (`src/infrastructure/notifications/commandBridge.ts`, register wiring
in `src/application/stores/notifications.ts`, `relayClient.register` fcmToken) IS
tracked normally.

# Inline Autocorrect keyboard (Android / GrapheneOS)

A keyboard (input method) that corrects what you type in any app: typos, confusables, merged words resolved from
context, Danish ↔ English translation, with colour-coded chips above the keys and tap-to-revert. Decisions come from
the web app's API; nothing is stored on the phone except your settings.

Build: GitHub Actions (`.github/workflows/android.yml`) produces a signed `inline-autocorrect.apk` on every push to
`android/`, published as a GitHub release. Locally: `./gradlew assembleRelease` with `KEYSTORE_B64`,
`KEYSTORE_PASSWORD` and `KEY_ALIAS` set (unsigned debug build: `./gradlew assembleDebug`).

Install on GrapheneOS: open the APK, allow installs from your browser/files app, then Settings → System → Keyboard →
On-screen keyboard → enable "Inline Autocorrect keyboard", and pick it from the keyboard switcher. Keep the app's
Network permission on.

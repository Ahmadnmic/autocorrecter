# Inline Autocorrect keyboard (Android / GrapheneOS)

A keyboard (input method) that corrects what you type in any app: typos, confusables, merged words resolved from
context, Danish ↔ English translation, with colour-coded chips above the keys and tap-to-revert. Decisions come from
the web app's API; nothing is stored on the phone except your settings.

Build: GitHub Actions (`.github/workflows/android.yml`) produces a signed `inline-autocorrect.apk` on every push to
`android/`, published as a GitHub release. Locally: `./gradlew assembleRelease` with `KEYSTORE_B64`,
`KEYSTORE_PASSWORD` and `KEY_ALIAS` set (unsigned debug build: `./gradlew assembleDebug`).

Install on GrapheneOS: open the APK and allow the install. Then either
- **Spell checker (recommended, works with any keyboard):** Settings → System → Languages → Spell checker → Inline Autocorrect.
  Typos are underlined red, wrong words in context blue; tap to accept.
- **Keyboard (auto-corrects while typing):** Settings → System → Keyboard → On-screen keyboard → enable it, then pick it.

Keep the app's Network permission on.

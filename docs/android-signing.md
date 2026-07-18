# Android Signing

A stable signing key lets a new APK update the installed app without deleting its data.

Generate a dedicated key on a trusted machine:

~~~sh
keytool -genkeypair -v \
  -keystore couchcode-release.jks \
  -alias couchcode \
  -keyalg RSA -keysize 4096 -validity 10000
~~~

Back up the keystore offline. Losing it means future APKs cannot update the installed app.

Base64-encode the keystore without line wrapping:

~~~sh
base64 -w 0 couchcode-release.jks
~~~

Create these GitHub Actions secrets:

- `ANDROID_KEYSTORE_BASE64` — encoded keystore
- `ANDROID_KEY_ALIAS` — `couchcode` (or the alias selected above)
- `ANDROID_STORE_PASSWORD` — keystore password
- `ANDROID_KEY_PASSWORD` — key password

Also configure `GOOGLE_SERVICES_JSON_B64`. Then run **Build CouchCode APK** with `build_type=release`. The workflow decodes the key only on the temporary runner, and Gradle signs the release APK through environment variables.

Never commit the keystore or passwords. Do not print secret values in Actions logs.

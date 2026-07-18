# GitHub Actions Configuration

The APK build workflow stays in the source repository. Copy `templates/control-repo/.github/workflows/wake-device.yml` into a separate private control repository. Commands and results must never use the public source issue tracker.

## Secrets

- `GOOGLE_SERVICES_JSON_B64`
- `FIREBASE_SERVICE_ACCOUNT`
- `COUCHCODE_FCM_TOKEN`
- `ANDROID_KEYSTORE_BASE64`
- `ANDROID_KEY_ALIAS`
- `ANDROID_STORE_PASSWORD`
- `ANDROID_KEY_PASSWORD`

The four Android signing secrets are required only for release builds.

## Variables

- `COUCHCODE_DEVICE_ID`
- `COUCHCODE_CONTROL_ISSUE`

## Safety behavior

The wake workflow runs manually or from an issue comment only when:

- the comment author is the repository owner;
- the issue matches `COUCHCODE_CONTROL_ISSUE`; and
- the comment starts with `couchcode:`.

The workflow sends only a wake signal. The Termux agent independently validates command author, device ID, project registration, action allowlists, approval fields, and expiration.

For a multi-user hosted service, replace this single-owner model with per-user authentication, signed commands, replay protection, token rotation, and an audit log.

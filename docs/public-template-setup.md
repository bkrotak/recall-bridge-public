# Public Template Setup

CouchCode can run without a hosted relay. Each installation uses the user's own Firebase project, private GitHub control issue, Android app, and Termux configuration. The public source repository must never double as the command channel.

## 1. Fork or copy the template

Keep the source template separate from commands. Create a second private control repository, copy templates/control-repo/.github/workflows/wake-device.yml into it, create the command issue there, and note its number.

Never commit:

- android/app/google-services.json
- Firebase Admin SDK JSON
- FCM device tokens
- Android signing keystores/passwords
- GitHub tokens
- device configuration or backups

## 2. Install official Termux

Install **Termux — Terminal emulator with packages** from [F-Droid](https://f-droid.org/packages/com.termux/). The Android health screen must report that the Termux command API is available.

~~~sh
termux-setup-storage
pkg update -y && pkg upgrade -y
pkg install -y gh git
gh auth login
gh auth setup-git
~~~

## 3. Create Firebase configuration

1. Create a Firebase project.
2. Add Android package `com.couchcode.mobile`.
3. Download google-services.json.
4. Base64-encode the complete file and save it as the GitHub Actions secret GOOGLE_SERVICES_JSON_B64.
5. Create a Firebase Admin SDK key and save its raw JSON as FIREBASE_SERVICE_ACCOUNT.
6. Enable the Google Cloud **IAM Service Account Credentials API**.

Do not commit either Firebase file.

## 4. Build and configure Android

Run **Build CouchCode APK** from GitHub Actions with build_type=debug for initial testing. Install the artifact.

In the app:

1. Tap **Allow Termux command control** and approve Android.
2. Save the generated device ID.
3. Copy the Firebase wake token.
4. Save that token as the Actions secret COUCHCODE_FCM_TOKEN.
5. Save the device ID as the Actions variable COUCHCODE_DEVICE_ID.
6. Use **Test Termux connection** and refresh until the receipt reports exit 0.

Create the Actions variable COUCHCODE_CONTROL_ISSUE containing the numeric private control-issue number.

## 5. Install the Termux agent

The examples assume the public source repository is named `couchcode`.

~~~sh
export COUCHCODE_SOURCE_REPO=YOUR_GITHUB_USERNAME/couchcode
export COUCHCODE_CONTROL_REPO=YOUR_GITHUB_USERNAME/your-private-control-repo
export COUCHCODE_CONTROL_ISSUE=1
export COUCHCODE_DEVICE_ID=android-your-device
gh api repos/$COUCHCODE_SOURCE_REPO/contents/install-termux.sh --jq .content | tr -d '\n' | base64 -d | sh
~~~

Register a local Git repository under $HOME/projects:

~~~sh
node "$HOME/projects/couchcode/agent/register-project.mjs" my-app "$HOME/projects/my-app"
~~~

Registration enables only `read_file`, `search`, and `git_diff`. Review `~/.couchcode/config.json` and explicitly configure any additional `allowedActions`, command allowlists, job definitions, and `commitPaths`.

Example project configuration:

~~~json
{
  "allowedActions": ["read_file", "search", "git_diff", "run_check"],
  "allowRemoteCapture": false,
  "commitPaths": ["src", "package.json"],
  "commands": {
    "checks": {
      "test": { "program": "npm", "args": ["test"] }
    }
  },
  "jobs": {}
}
~~~

Global sensitive actions such as remote project registration, repository creation, and self-update remain disabled unless their exact names are added to `security.allowedSensitiveActions` in the local configuration. The command's `approved: true` flag is also required, but is not a substitute for phone-side confirmation.

## 6. Test the remote wake path

Stop the current agent and close Termux normally:

~~~sh
tmux kill-session -t couchcode
~~~

Post a valid, short-lived `couchcode:` status command to the configured private control issue. Generate fresh timestamps and a unique ID for every command:

~~~sh
node -e "const {randomUUID}=require('node:crypto');const now=Date.now();console.log('couchcode:'+JSON.stringify({version:1,id:randomUUID(),deviceId:'android-your-device',project:'my-app',action:'status',args:{},createdAt:new Date(now).toISOString(),expiresAt:new Date(now+300000).toISOString()}))"
~~~

The owner-restricted workflow should send FCM, CouchCode should wake Termux, and the agent should post a completed result. Reusing the same command ID before its expiration must not execute it again.

## 7. Configure durable signing

Debug APKs normally cannot update one another across clean CI runners. Follow [Android signing](android-signing.md), add the four signing secrets, and build build_type=release. Keep an offline backup of the keystore.

## Public release gate

Before changing repository visibility:

- Remove personal files and inspect Git history.
- Use durable signing.
- Confirm issue-comment wake is restricted to the repository owner.
- Test token rotation and app reinstall recovery.
- Add signed/replay-resistant commands before operating a shared multi-user relay.
- Add user approval UI before enabling sensitive actions for untrusted users.

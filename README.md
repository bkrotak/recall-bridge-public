# CouchCode

**CouchCode — Self-owned, no-subscription AI development from your phone** connects authorized AI workflows to tightly scoped development actions on Android.

> **Alpha:** CouchCode is free, open-source, and designed to run on infrastructure you control. It is an early template for experienced developers—not a hosted service or a general-purpose remote shell.

It connects an authorized AI or chat workflow to a local phone agent without opening your phone as a general remote shell. CouchCode is model-agnostic: hosted models, local models, scripts, and other tools can use it if they can create an approved command in your private control repository.

It does not grant an AI blanket phone access. The same GitHub, device, project, and command allowlists apply to every caller.

~~~text
Authorized command → private control issue → GitHub Actions → Firebase → CouchCode app → Termux agent
~~~

The practical idea is simple: if the work is already in your Git repositories, you should be able to check status, run approved tests, start a build, review a result, or create a safe follow-up workflow from your phone—without moving your development environment into a paid cloud workspace.

## Why CouchCode

Cloud workspaces are convenient, CI services are excellent at repeatable automation, and SSH is effective for direct administration. CouchCode serves a different need: it keeps execution on your own Android/Termux environment and exposes named, allowlisted development actions to an AI workflow.

There is no CouchCode subscription or mandatory CouchCode-hosted backend. You supply the phone, GitHub account, and optional Firebase or relay infrastructure. Normal provider quotas, bandwidth, and device costs still apply.

## What CouchCode does

- Checks whether the phone has compatible Termux, permissions, a saved device ID, and a usable Firebase token.
- Wakes Termux only when an authorized command arrives.
- Restricts the local agent to registered project folders and allowlisted actions.
- Keeps sensitive actions disabled until they are explicitly enabled in the phone's local configuration.
- Lets a user register projects deliberately, then control checks, jobs, and commit paths.
- Uses a separate private control repository for commands and results.
- Requires no CouchCode account or subscription; the default path uses your own GitHub Actions and Firebase configuration, with a hosted relay optional.
- Supports durable Android signing so future APK updates can preserve app setup.

## What it is not

CouchCode is not a cloud IDE, a general remote shell, a hidden phone controller, or a shared public command endpoint. It should not receive credentials in issues, source files, screenshots, or chat messages.

This repository is a **free, public, bring-your-own-infrastructure template**. It contains no Firebase project, device ID, FCM token, GitHub credential, service-account key, signing key, or personal project configuration.

## Start here

1. Read the [public template setup](docs/public-template-setup.md).
2. Configure [GitHub Actions secrets and variables](docs/github-actions.md).
3. Add [durable Android signing](docs/android-signing.md) before relying on updates.
4. Review the [threat model](docs/threat-model.md).

## Security boundary

CouchCode requires a registered device, registered project aliases, local action and job allowlists, controlled commit paths, short-lived commands, and replay protection. The installer requires a separate private control repository restricted to its owner.

The `approved` field records caller intent; it is not phone-side human approval. Local configuration remains the security boundary, and sensitive actions are disabled by default. Do not enable them for untrusted callers.

A shared multi-user service needs additional safeguards: signed commands, replay protection, per-user authentication, token rotation, audit logging, and phone-side approval for sensitive operations.

## Development

~~~bash
npm test
npm run check
~~~

Android builds are intentionally manual until each user supplies their own Firebase configuration and signing secrets.

## Alpha status

- Scoped Termux agent: implemented
- Official Termux compatibility diagnostics: implemented
- Android first-run setup wizard: implemented
- Firebase background wake: implemented
- Private control-repository workflow template: implemented
- Generic project registration: implemented
- Strict command validation and replay protection: implemented
- Symlink-aware file containment: implemented
- Local per-project action allowlists: implemented
- Remote web capture opt-in per project: implemented
- Durable CI signing support: implemented
- Optional Cloudflare relay foundation: included
- Phone-side approval UI: planned before multi-user use

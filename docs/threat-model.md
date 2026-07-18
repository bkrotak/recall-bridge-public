# Threat model

## Protected assets

- GitHub, Expo, Firebase, and cloud deployment credentials in Termux
- Source code and Git history in registered repositories
- Device identifiers and FCM registration tokens
- Build artifacts and command output

## Primary threats

- Forged or replayed commands
- Path traversal outside a registered repository
- Malicious patches or dependency scripts
- Accidental pushes/deployments
- Leaked relay administration tokens
- Android intent abuse by another installed application
- Sensitive command output copied into GitHub comments

## MVP mitigations

- Private control repository and allowed-author checks
- Device and project targeting
- Canonical path containment
- Allowlisted checks/jobs
- Restricted branch naming and commit paths
- Explicit approval field for pushes
- Local per-project action allowlists and commit-path allowlists
- Remote web capture disabled unless enabled in local project configuration
- Sensitive global actions disabled by default in local configuration
- Strict short-lived command validation and command-ID replay protection
- UUID-only job lookups with project ownership checks
- Symlink-aware file containment
- Protected Termux RUN_COMMAND permission
- Relay bearer authentication

## Required before broader use

- Per-device asymmetric signing keys
- Signed commands for multi-user relay deployments
- Encrypted Android preferences
- Redaction of common credential formats in output
- Phone confirmation for high-impact actions
- Audit log retention and token rotation

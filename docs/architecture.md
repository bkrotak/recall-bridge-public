# Architecture

## Command lifecycle

1. An authorized client writes a device-scoped command to a private GitHub control issue or submits it through the optional relay.
2. GitHub Actions or the relay sends a data-only Firebase Cloud Messaging wake signal.
3. The CouchCode Android app validates the device ID and calls Termux `RUN_COMMAND`.
4. The Termux agent polls both configured transports and validates the author, device, project, action, approval, expiration, and path.
5. Short tasks return immediately. Long tasks receive a job ID and run detached.
6. The result returns through the same transport that delivered the command.

The private GitHub issue is the default no-server transport. The optional relay can run alongside it; configuring the relay does not disable GitHub polling. Git repositories remain the source of truth for project code.

## Trust boundaries

- The relay never receives GitHub, Expo, or Firebase CLI credentials from Termux.
- Android stores the FCM registration token and device pairing data.
- Termux stores development credentials and project files.
- MCP clients receive only command results permitted by the daemon.
- Registered projects are explicit; arbitrary filesystem roots are rejected.

## Next engineering milestones

1. Add per-device command signatures and durable replay protection.
2. Encrypt sensitive Android preferences.
3. Add foreground job notifications and per-command phone approval.
4. Add integration tests against a local D1 database and mocked FCM endpoint.
5. Add a guided setup flow for creating the private control repository.

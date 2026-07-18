# Private Control Repository

Create a separate private repository for commands and results. Copy `wake-device.yml` into its `.github/workflows` directory.

## Secrets

- `FIREBASE_SERVICE_ACCOUNT`
- `COUCHCODE_FCM_TOKEN`

## Variables

- `COUCHCODE_DEVICE_ID`
- `COUCHCODE_CONTROL_ISSUE`

Create the control issue, set `COUCHCODE_CONTROL_ISSUE` to its number, and configure the Termux agent's `controlRepo` and `issue` values to match this private repository.

Never make the control issue public. It contains command envelopes and execution results.

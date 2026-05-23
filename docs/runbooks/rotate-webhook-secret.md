# Rotate the Stellar Webhook Secret

BrandBlitz deposit webhooks use the shared `WEBHOOK_SECRET` for both the legacy
`X-Webhook-Secret` header and the HMAC signature in `X-Webhook-Signature`.

## Headers

Each webhook request must include:

| Header                | Value                                                  |
| --------------------- | ------------------------------------------------------ |
| `X-Webhook-Secret`    | Current `WEBHOOK_SECRET`                               |
| `X-Webhook-Id`        | Unique event id, stored for 10 minutes to block replay |
| `X-Webhook-Timestamp` | Unix timestamp in seconds or milliseconds              |
| `X-Webhook-Signature` | `sha256=<hex>` HMAC over `<timestamp>.<raw JSON body>` |

Requests older than 5 minutes are rejected. Reused webhook ids return a 200
no-op response so retries remain safe after the first accepted delivery.

## Rotation

1. Generate a new high-entropy `WEBHOOK_SECRET`.
2. Update the deposit monitor secret first, but keep the API on the old secret.
3. Pause webhook delivery briefly or let the queue drain.
4. Update the API `WEBHOOK_SECRET` and restart the API workers.
5. Resume the monitor and confirm a signed test webhook is accepted.
6. Remove the old secret from secret stores and deployment history.

If a zero-downtime rotation is required, run a temporary API deployment that
accepts both the old and new secret, then remove the old secret after every
monitor instance has rolled forward.

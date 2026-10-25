# Security

## Reporting a vulnerability

Report it privately through GitHub: **Security > Report a vulnerability** on this repository. Do not open a public issue.

Include what an attacker can do, the steps to reproduce it, and the app and Twenty versions. You will get an answer within 5 working days.

## Scope

In scope: this app's code, including the webhook resolver, signature verification, the stored registration, and the Power Dialer route.

Out of scope: Twenty itself (report to [twentyhq/twenty](https://github.com/twentyhq/twenty/security)) and Allo (report to Allo).

## Security model

- Allo deliveries are authenticated by their HMAC-SHA256 signature only, with a 5-minute replay window. The resolver rejects anything unsigned before a job is queued.
- Each workspace registers its own webhook, with its own `registrationId` in the URL and its own signing secret. A delivery is only dispatched to the workspace that owns its registration.
- The signing secret is stored in the app's server-scoped key-value store, readable by this app's functions only. The Allo API key stays in its secret application variable; the app stores only a truncated SHA-256 of it.
- Webhook writes run under the app's role: read and update, no delete.
- Send to Power Dialer runs with the caller's own permissions and only fills the caller's own Allo queue.

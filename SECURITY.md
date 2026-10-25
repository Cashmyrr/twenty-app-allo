# Security

## Reporting a vulnerability

Report it privately through GitHub: **Security > Report a vulnerability** on this repository. Do not open a public issue.

Include what an attacker can do, the steps to reproduce it, and the app and Twenty versions. You will get an answer within 5 working days.

## Scope

In scope: this app's code, including the webhook receiver, signature verification, the stored registration, and the Power Dialer route.

Out of scope: Twenty itself (report to [twentyhq/twenty](https://github.com/twentyhq/twenty/security)) and Allo (report to Allo).

## Security model

- Allo deliveries are authenticated by their HMAC-SHA256 signature, with a 5-minute replay window. The public receiver checks it synchronously, inside the workspace that registered the webhook, and answers `401` before anything is queued.
- Twenty picks the workspace from the request host, and each workspace's webhook URL is on its own host. The URL also carries a random `registrationId`; a request for an id the workspace does not hold is answered `404`.
- The function that writes calls has no trigger: only a job queued by the receiver, after the check, or by itself to retry, reaches it.
- The signing secret is stored in the workspace's app key-value store. Twenty's API serves that store to this app's own token only, in that workspace, but keeps the value unencrypted in its database, unlike secret application variables. Someone with access to the Twenty database or its backups can read it, and with it forge Allo events into that workspace. The Allo API key stays in its encrypted secret variable; the app stores only a truncated SHA-256 of it.
- Connect probes the webhook URL with a one-time nonce before creating anything in Allo.
- Webhook writes run under the app's role: read and update, no delete.
- Send to Power Dialer runs with the caller's own permissions and only fills the caller's own Allo queue.

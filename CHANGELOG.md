# Changelog

All notable changes to this app are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the app uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.2.0]

First public release.

### Breaking

- **The webhook is now registered by the app.** Paste an API key with the `WEBHOOKS_READ_WRITE` scope in the new Settings tab and click Connect. The `ALLO_WEBHOOK_SECRET` and `ALLO_PUBLIC_BASE_URL` variables are gone.
- **The webhook URL changed.** Deliveries go to `/webhooks/server/<resolver>?registrationId=...`, routed to the workspace that registered them. The URL from 0.1.0 no longer works.

### Upgrading from 0.1.0

1. Add the `WEBHOOKS_READ_WRITE` scope to the Allo API key, or create a key with it.
2. Install 0.2.0, open the app's Settings tab and click Connect.
3. Delete the webhook you created by hand in Allo > Settings > Webhooks, otherwise Allo keeps sending to the old URL and eventually disables it.

Data is kept: the object, fields and their identifiers are unchanged.

### Added

- Works on multi-workspace Twenty servers: each workspace gets its own webhook and signing secret.
- Settings tab: API key, connection status, Connect (which also repairs the webhook) and Disconnect.
- Health check banner on the app settings page when Allo is not connected.
- Uninstalling the app deletes its webhook in Allo.
- A delivery that cannot be written (Twenty unavailable) is retried for up to about 9 hours.
- Send to Power Dialer supports Select all, and reports people the caller cannot access.

### Fixed

- Send to Power Dialer queued at most 100 people, whatever the selection size.
- A tag that arrived before its call was recorded was dropped. It is now retried for up to about 9 hours.
- Email matching treated `_` and `%` as wildcards, so `j_doe@acme.com` could link to `jxdoe@acme.com`.

### Security

- Send to Power Dialer reads people with the caller's permissions instead of the app's role, and finds the caller's queue server-side instead of trusting a user id sent by the browser.

## [0.1.0]

- Initial version: Allo Call object, call and tag sync, member, person and company links, `person.lastAlloCallAt`, Send to Power Dialer, history backfill scripts.

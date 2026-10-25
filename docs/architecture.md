# Architecture

How the app is put together, and why. Read this before changing the webhook flow, the data model or the identifiers.

## Layout

```
src/
├── application-config.ts                 defineApplication + ALLO_API_KEY
├── constants/
│   ├── allo-api.ts                       Allo base URL, subscribed topics, retry delays, route paths
│   ├── allo-call-values.ts               SELECT values shared by the object and the mapper
│   ├── allo-registration.ts              key-value store keys
│   └── universal-identifiers.ts          every entity UUID, append-only
├── objects/allo-call.object.ts
├── fields/                               relations to member, person, company + person.lastAlloCallAt
├── indexes/                              lookups on alloCallId and correlationKey
├── views/, navigation-menu-items/        the "Allo Calls" list in the sidebar
├── command-menu-items/, front-components/  Send to Power Dialer, Settings tab
├── settings-menu-items/                  the app's Settings tab
├── roles/default-role.ts                 read + update, never delete
├── types/                                Allo payloads, registration records
└── logic-functions/
    ├── allo-webhook-resolver.ts          public server route: verify, then dispatch
    ├── allo-webhook.ts                   writes one delivery in the target workspace
    ├── allo-connect.ts                   POST /s/allo/connect: register or repair the webhook
    ├── allo-disconnect.ts                POST /s/allo/disconnect
    ├── allo-connection-status.ts         GET /s/allo/connection-status, for the settings tab
    ├── health-check.ts                   setup banner on the app settings page
    ├── uninstall.ts                      deletes the Allo webhook
    ├── push-to-dialer.ts                 POST /s/dialer
    ├── sync-last-allo-call-on-*.ts       keep person.lastAlloCallAt current
    └── utils/                            pure-ish helpers, each with its unit tests
scripts/                                  optional history backfill, not part of the bundle
```

## Webhook flow

```
Allo ──POST /webhooks/server/<resolver uuid>?registrationId=R──▶ allo-webhook-resolver   (owner workspace)
                                                                       │ claim R → { workspaceId, signingSecret }   (server-scoped kv)
                                                                       │ verify signature, parse, filter topics
                                                                       ▼
                                                              allo-webhook                (target workspace, queued)
                                                                       │ registration still R?                    (workspace-scoped kv)
                                                                       ▼
                                                              map → resolve links → upsert Allo Call
```

**Why a server route.** A Twenty app installed on a multi-workspace server shares one URL across every workspace. An `/s/` HTTP route resolves the workspace from the request host, which a third-party webhook cannot set. A server route runs a resolver that picks the workspace from the request.

**Why the resolver verifies the signature.** The resolver can read server-scoped storage, so it holds each registration's secret and answers `401` synchronously. Unsigned traffic never reaches the job queue.

**What Allo sees.** `400` for a missing registration id, body or invalid JSON, `401` for a bad signature, `404` for an unknown registration, `200 {"ignored": true}` for topics the app does not handle, and `200 {"queued": true}` once dispatched.

**Retries are the app's job.** Once a delivery is dispatched, Allo has its 200 and never sends it again. Twenty's queue retries a run that throws `RetryableLogicFunctionError` at most 3 times, about 1, 2 and 4 seconds apart. That is too short for a Twenty outage, or for a `tag.added` that beats the `call.completed` Allo sends about 30 seconds after hangup. So when a write fails, or a tag's call is not recorded yet, `allo-webhook` re-queues the same delivery with `enqueueJobs` after 1 min, 5 min, 30 min, 2 h and 6 h (`ALLO_DELIVERY_RETRY_DELAYS_MS`), then gives up. Allo's own retries would have lasted about 27 hours.

**Why the target checks the registration again.** A delivery dispatched just before a disconnect must not write into a workspace that has since disconnected.

**URL form.** The URL uses the resolver's `universalIdentifier`. Twenty also accepts the resolver's metadata id, but that id only exists in the app's owner workspace, so an installed copy cannot know it. Every official Twenty app builds its URL the same way. Two limits come with it:

- Twenty marks this form as deprecated (it answers with a `Deprecation` header). Follow the official apps when they move.
- Twenty refuses the form when more than one application registration on the server claims the same resolver, for example the same app deployed separately from two workspaces of one self-hosted server. Then every webhook on that server fails. Install from a single registration (the marketplace or one deploy).

## Registration

The app's **Settings** tab (`front-components/allo-settings.tsx`) owns the connection:

- **Connect** saves the API key, if a new one was typed, through Twenty's metadata API (the same call as the built-in variables tab), then calls `allo-connect`.
- `allo-connect` is idempotent. When the current registration is healthy (same key fingerprint, webhook exists and is enabled in Allo, pointing at this server, claim present) it only reads it. Otherwise it deletes the old webhook if it can, creates one with a fresh `registrationId`, and stores the claim (server scope) and the registration (workspace scope). If storing fails, the new webhook is deleted. So Connect is also the repair.
- **Disconnect** deletes the webhook in Allo and forgets the registration. Uninstall does the same.
- Opening the tab calls `allo-connection-status`, which asks Allo once whether the webhook still exists. Nothing polls in the background.
- The health check reads local state only and never calls Allo. Its actions carry no `location`, so Twenty opens the app's configuration tab, which is the Settings tab.

Why a tab and not the built-in variables tab: Twenty fires no event when a variable changes, so nothing could register the webhook when the key is saved. Declaring a settings tab hides the built-in variables tab, which is why the tab also takes the key.

Connect, disconnect and saving the key all require the `APPLICATIONS` permission. Front components act as the viewer narrowed to the app's role, so the role carries that flag too.

## One record per call

Only `call.completed` carries Allo's call id (`cll_...`). Earlier events are matched on a **correlation key**, `fromNumber|toNumber|startedAt`, which Allo keeps identical across the events of one call. Once the id arrives it becomes the lookup key.

- `upsertAlloCall` drops null fields, so a later event never blanks what an earlier one wrote.
- Status has a rank (`RINGING` < `IN_PROGRESS` < `COMPLETED`) and never goes back.
- The correlation key index is deliberately not unique: a duplicate row is a cosmetic problem, while a unique violation would fail the delivery and retry it forever.

The backfill script maps Allo's REST items (`scripts/lib/map-api-call.mts`) onto the same fields. Both paths share Allo's call id, so they converge on the same record.

## person.lastAlloCallAt

Twenty has no rollup field and cannot filter on a one-to-many relation. The app writes the newest call date onto the person from two database triggers:

- `alloCall.created`: the normal case.
- `alloCall.updated` on `personId`: a call whose person was linked by a later event.

The write keeps the newer of the two dates, so it is idempotent and safe to replay.

## Send to Power Dialer

`push-to-dialer` is an authenticated route. It uses `new CoreApiClient()` without `runAs`, so it reads people with the caller's own permissions. The caller's queue is found from `context.workspaceMemberId`, never from an id sent by the browser. People are read in pages of 100, the Twenty page cap. Under Select all, the front component sends the view's filter instead of ids.

## Identifiers

Twenty matches local definitions to installed metadata by `universalIdentifier`. Changing one deletes the entity and recreates it empty, data included. Treat `src/constants/universal-identifiers.ts` as append-only, and generate new ones with `crypto.randomUUID()`.

## Testing

| Layer | Where | Needs a server |
| --- | --- | --- |
| Definitions validate, identifiers are unique UUID v4, relations point at each other | `src/__tests__/definitions.test.ts` | no |
| Signature, mapping, upsert, links, registration, resolver, target, connect/disconnect/status, health check, dialer, settings tab texts | `src/**/__tests__/*.test.ts` | no |
| Metadata syncs, GraphQL names and filter shapes are valid, ilike escaping works on a real server | `src/__tests__/*.integration-test.ts` | yes |

The unit tests replace `CoreApiClient`, `kv` and `fetch` with fakes (`src/__tests__/utils/`). Nothing in the test suite calls Allo.

What no automated test covers yet: a real Allo delivery through the server route and the queue. Check it by hand after a change to the webhook flow (see CONTRIBUTING.md).

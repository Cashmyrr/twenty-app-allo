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
    ├── allo-webhook-receiver.ts          public route on the workspace's domain: verify, then queue
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
Allo ──POST https://<workspace>.<public function domain>/allo/webhook?registrationId=R──▶ allo-webhook-receiver   (this workspace)
                                                                       │ registration is R?                           (workspace-scoped kv)
                                                                       │ verify signature with its secret, else 401
                                                                       │ parse, filter topics
                                                                       ▼ enqueueJobs
                                                              allo-webhook                (this workspace, queued)
                                                                       │ registration still R?
                                                                       ▼
                                                              map → resolve links → upsert Allo Call
```

**Why an HTTP route on the workspace's domain.** Twenty resolves the workspace of an HTTP route from the request host (`resolveWorkspaceAndPublicDomain` in Twenty's route trigger), and the host is part of the URL the app gives Allo. So the receiver runs inside the workspace that registered the webhook, reads its signing secret from the workspace key-value store, and refuses a bad signature with `401` before anything is queued. The secret never leaves the workspace.

`pickWebhookBaseUrl` (`utils/resolve-webhook-base-url.ts`) builds the host from the public `/client-config` and `currentWorkspace`:

| Server | Webhook URL |
| --- | --- |
| Twenty Cloud, or any server with a public function domain | `https://<subdomain>.<publicFunctionDomain>/allo/webhook` |
| Single workspace | `<serverUrl>/s/allo/webhook`: every host resolves to the one workspace |
| Multi-workspace, no public function domain | `<workspace subdomain URL>/s/allo/webhook` |

Twenty is phasing out the `/s/` form for new functions on servers with a public function domain, which is why that domain comes first.

Before handing a URL to Allo, `allo-connect` posts a one-time nonce to it (`?probe=`, stored for the duration of the call) and expects the receiver to echo it. A URL that does not reach this app in this workspace fails Connect and leaves Allo untouched, instead of becoming a webhook that fails every delivery.

**Why 0.2.0 pre-releases used a server route.** They sent every delivery to one server route (`/webhooks/server/<resolver uuid>`), which ran in the app's owner workspace and dispatched to the right one. That route could not check signatures: Twenty's server-scoped key-value store is a claim registry that stores only which workspace set a key, so no secret can reach it. The resolver is gone, its identifier is retired, and Connect moves such a webhook to the receiver.

**What Allo sees.** `400` for a missing registration id, body or invalid JSON; `401` for a missing or wrong signature, or a timestamp outside the 5-minute window; `404` for a registration this workspace does not hold; `500` while the registration has no signing secret or when the job cannot be queued, so Allo keeps the delivery and retries; `200 {"ignored": true}` for topics the app does not handle; `200 {"queued": true}` once queued.

`allo-webhook` has no trigger, so only a job this app queued reaches it, and it only ever receives verified, parsed events (`kind: 'verified-delivery'`).

**Retries are the app's job.** Once a delivery is dispatched, Allo has its 200 and never sends it again. Twenty's queue retries a run that throws `RetryableLogicFunctionError` at most 3 times, about 1, 2 and 4 seconds apart. That is too short for a Twenty outage, or for a `tag.added` that beats the `call.completed` Allo sends about 30 seconds after hangup. So when a write fails, or a tag's call is not recorded yet, `allo-webhook` re-queues the same delivery with `enqueueJobs` after 1 min, 5 min, 30 min, 2 h and 6 h (`ALLO_DELIVERY_RETRY_DELAYS_MS`), then gives up. Allo's own retries would have lasted about 27 hours.

**Why the target checks the registration again.** A delivery dispatched just before a disconnect must not write into a workspace that has since disconnected.

## Registration

The app's **Settings** tab (`front-components/allo-settings.tsx`) owns the connection:

- **Connect** saves the API key, if a new one was typed, through Twenty's metadata API (the same call as the built-in variables tab), then calls `allo-connect`.
- `allo-connect` is idempotent. When the current registration is healthy (same key fingerprint, webhook exists and is enabled in Allo, pointing at this workspace's current URL, signing secret stored) it only reads it. Otherwise it probes the new URL, deletes the old webhook if it can, creates one with a fresh `registrationId`, and stores the registration with its signing secret in the workspace scope. If storing fails, the new webhook is deleted. So Connect is also the repair.
- **Disconnect** deletes the webhook in Allo and forgets the registration. Uninstall does the same.
- Opening the tab calls `allo-connection-status`, which asks Allo once whether the webhook still exists. Nothing polls in the background.
- The health check reads local state only and never calls Allo. Its actions carry no `location`, so Twenty opens the app's configuration tab, which is the Settings tab.

Why a tab and not the built-in variables tab: Twenty fires no event when a variable changes, so nothing could register the webhook when the key is saved. Declaring a settings tab hides the built-in variables tab, which is why the tab also takes the key.

Connect, disconnect and saving the key all require the `APPLICATIONS` permission. Front components act as the viewer narrowed to the app's role, so the role carries that flag too.

## One record per call

Only `call.completed` carries Allo's call id (`cll_...`). The ring events (`call.received`, `call.triggered`, `call.answered`) are matched on a **correlation key**, `fromNumber|toNumber|startedAt`, which Allo keeps identical across them. Once the id arrives it becomes the lookup key.

`call.completed` does not share that key: on an answered call its `start_date` is the answer time, truncated to the second, while the ring events carry the ring start with milliseconds. When neither the id nor the key finds a record, the event looks for one with the same contact and Allo numbers nearby (`NearbyCallMatch` in `map-allo-call.ts`):

- `call.completed` takes the closest ring record that started up to 10 minutes before it (5 seconds after, for the truncation), has no Allo id yet and is not completed.
- A ring event that arrives after `call.completed`, for example on a retry, takes the closest completed record that started from 5 seconds before it to 10 minutes after, and gives it the correlation key so the call's other ring events match exactly.
- On a record the ring events created, `call.completed` keeps their `startedAt` (the ring start) and `name` (which carries the contact's name; `call.completed` often has an empty `to_name`).

Requiring "no Allo id yet" on one side and "has one" on the other keeps a redial a minute later on its own record.

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
| Signature, mapping, upsert, links, registration, webhook URL, receiver, target, connect/disconnect/status, health check, dialer, settings tab texts | `src/**/__tests__/*.test.ts` | no |
| Metadata syncs, GraphQL names and filter shapes are valid, ilike escaping works on a real server | `src/__tests__/*.integration-test.ts` | yes |

The unit tests replace `CoreApiClient`, `kv` and `fetch` with fakes (`src/__tests__/utils/`). Nothing in the test suite calls Allo.

What no automated test covers yet: a real Allo delivery through the receiver route and the queue. Check it by hand after a change to the webhook flow (see CONTRIBUTING.md).

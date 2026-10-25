# Allo for Twenty

Brings [Allo](https://www.withallo.com) calls into [Twenty](https://twenty.com).

![Allo for Twenty: call sync, call details, never-called filter, Send to Power Dialer and one-click setup](docs/demo.gif)

- Every Allo call becomes one **Allo Call** record. It fills in as the call progresses: ringing, answered, then completed with duration, recording, transcript, AI summary and tags.
- Each call is linked to the Twenty member who handled it, the person on the other end, and that person's company.
- `person.lastAlloCallAt` holds the date of the last call with each person, so you can filter on "never called" or "not called in 30 days".
- **Send to Power Dialer** pushes any selection of people into your own Allo Power Dialer queue, and reports anyone it had to skip.

## Requirements

- Twenty 2.42 or later, reachable over public HTTPS (Allo only delivers webhooks to HTTPS URLs).
- An Allo API key with these scopes:

| Scope | Needed for |
| --- | --- |
| `WEBHOOKS_READ_WRITE` | Call sync. The app registers its own webhook. |
| `DIALING_QUEUE_READ_WRITE` | Send to Power Dialer |
| `CONVERSATIONS_READ` | The optional history backfill script only |

## Setup

1. Install the app from **Settings > Applications**.
2. Open the app's **Settings** tab, paste your Allo API key and click **Connect**.

The app registers a webhook in Allo (it shows as "Twenty CRM (your-workspace.twenty.com)" in Allo > Settings > Webhooks, so an Allo account that feeds several workspaces can tell them apart) and calls start syncing. Nothing has to be copied between Allo and Twenty: the app creates the webhook and keeps its signing secret.

The Settings tab shows where things stand, including a webhook that was deleted or disabled in Allo. **Connect** also repairs the webhook, and **Disconnect** removes it. To change the key, paste the new one and connect again. Uninstalling the app deletes the webhook. Connecting and disconnecting require the permission to manage applications.

The app does nothing in the background: it only acts when Allo sends an event, when a call record changes, or when someone uses it.

## How a call is recorded

Allo sends several events per call. The app updates one record across all of them:

| Allo event | Effect | Status after |
| --- | --- | --- |
| `call.received` | Creates the record (inbound) | Ringing |
| `call.triggered` | Creates the record (outbound) | Ringing |
| `call.answered` | Adds the pickup time | In progress |
| `call.completed` | Adds duration, recording, transcript, summary, tags, result, transfer and IVR details, and an **Open in Allo** link to the call in Allo's web app | Completed |
| `tag.added`, `tag.removed` | Adds or removes the tag on the call | unchanged |

- The status only moves forward. A late or retried event still adds its own fields but never moves a completed call back.
- `call.completed` creates the record if the earlier events never arrived, so a missed event never loses a call.
- Allo gives `call.completed` a different start time than the ringing events (the answer time), so it is matched to the ringing record by the two numbers and a 10-minute window. The record keeps the ring start as its start time.
- Reps usually tag a call after hanging up, so tags arrive on their own events. A tag that arrives before its call is recorded is retried later.
- A delivery that cannot be written, for example while Twenty is unavailable, is retried for up to about 9 hours.
- Tags are stored as Allo tag keys, the same values `call.completed` uses.

## Links

Links are best-effort. A call with no match still lands with its raw numbers, Allo user email and Allo contact id, so it can be reconciled later.

- **Member:** Allo's user email matched against the Twenty member's login email.
- **Person:** the Allo contact's email first, then the contact phone number. Twenty stores the national number separately from the calling code, so the number is parsed before matching. A suffix match is the last resort, and it is dropped when it matches more than one person.
- **Company:** the matched person's company. The app does not match on Allo's company name, because name matching links the wrong account too often.

## Filtering on "never called"

Twenty cannot filter on the "many" side of a relation, so `person.alloCalls` can be shown as a column but not used as a filter. The app writes the date of the latest call onto the person instead:

- `Last Allo call` is empty: never called.
- `Last Allo call` is before a date: not called since.

The date is kept on the newest call, so replays and deleted calls never move it backwards. It is updated when a call is created, and when a call is linked to a person after creation.

## Send to Power Dialer

The Allo browser extension reads every phone number rendered on the page, not the view's filter or your selection. This command sends exactly what you selected.

1. Select people in any view, or use Select all.
2. Open the command menu and run **Send to Power Dialer**.
3. The result reports how many were queued, how many had no phone number, how many Allo skipped and why (an invalid number, for example), and how many you could not access.

- The people go into your own queue, found from your Twenty login email. **Your Twenty email must also be your Allo email.**
- The command runs with your permissions, so it only sends people you can see.
- One send is capped at 500 people. A larger selection is refused rather than cut short.

## Importing past calls (optional)

Two scripts import history. They run from a checkout of this repository, not from Twenty. Both are safe to re-run.

```bash
yarn backfill            # Count the CRM numbers and estimate Allo requests. Sends nothing to Allo.
yarn backfill --fetch    # Query Allo, report what would be written and every tag seen. Writes nothing.
yarn backfill --apply    # Same, then write the calls.

yarn backfill:last-call          # Dry run: fill person.lastAlloCallAt from the calls already in Twenty
yarn backfill:last-call --apply
```

`backfill` only queries Allo for phone numbers that already exist on a person in Twenty. It reads `ALLO_API_KEY` from `.env`, and the Twenty credentials from `TWENTY_API_URL` and `TWENTY_API_KEY` or the default remote of the Twenty CLI.

## Security

- Every delivery is checked against Allo's signature before anything is queued: HMAC-SHA256 under the Standard Webhooks scheme, compared in constant time, within a 5-minute replay window. Several `v1,` signatures are accepted during a secret rotation. Unsigned or wrongly signed requests are answered `401`.
- Each workspace has its own webhook URL, on its own domain, and its own signing secret. The webhook runs inside that workspace, so one workspace's secret cannot write into another.
- The webhook URL carries a random registration id. A request for an id the workspace does not hold is answered `404`.
- The signing secret is kept in the workspace's app key-value store, which only this app's functions can read. Twenty stores those values unencrypted, unlike secret variables.
- Webhook writes run under the app's role, which can read and update records but never delete them.
- The API key is never stored outside its secret variable. The app keeps only a hash of it to detect a key change.

See [SECURITY.md](SECURITY.md) to report a vulnerability.

## Self-hosted Twenty

Allo reaches each workspace on its own host: the public function domain when the server has one, otherwise `<server>/s/allo/webhook` on a single-workspace server, or the workspace's subdomain on a multi-workspace one. That host must be reachable from the internet over HTTPS. Connect checks it before creating anything in Allo.

Logic functions are disabled by default when `NODE_ENV=production`. Set `LOGIC_FUNCTION_TYPE` (`LAMBDA` or `LOCAL`) on both the server and the worker, or the webhook answers `403 LOGIC_FUNCTION_DISABLED`. With `LOCAL`, function code runs in a child process on the Twenty host that inherits the server's environment, so prefer `LAMBDA` on a shared instance.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for local setup and conventions, and [docs/architecture.md](docs/architecture.md) for how the app is built.

## License

[MIT](LICENSE)

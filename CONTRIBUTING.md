# Contributing

Issues and pull requests are welcome. For anything larger than a fix, open an issue first so the approach can be agreed before you write it.

## Local setup

Requirements: Node.js from `.nvmrc`, Yarn 4 (`corepack enable`), Docker for the local Twenty server.

```bash
yarn install
yarn twenty docker:start   # local Twenty on http://localhost:2020
yarn twenty dev            # build, sync and watch
```

Log in with `tim@apple.dev` / `tim@apple.dev`.

Allo cannot reach `localhost`, and the app refuses to register a webhook on a non-HTTPS server: on a local server, Connect answers with that error, without calling Allo. To receive real deliveries locally, expose the server through an HTTPS tunnel and start Twenty with `SERVER_URL` set to the tunnel URL.

## Checks

```bash
yarn lint
yarn typecheck
yarn test:unit           # no server needed
yarn twenty dev:build    # bundles the app, catches what typecheck does not
TWENTY_TEST_DISPOSABLE=true yarn test:integration   # installs the app on a running Twenty server
```

The integration tests uninstall the app before and after they run, which deletes its data. Point `TWENTY_API_URL` at a disposable server only (by default `http://localhost:2020`). They refuse to start without `TWENTY_TEST_DISPOSABLE=true`. `yarn test` runs the unit tests.

CI runs all of them on every pull request, against a pinned Twenty version.

`CoreApiClient.query` is typed `any` until `yarn twenty dev:build` generates the client against a server, so a green typecheck does not prove a GraphQL selection is right. The integration tests are what prove it.

## Conventions

- Read [docs/architecture.md](docs/architecture.md) before changing the webhook flow, the data model or the identifiers.
- **Never change an existing `universalIdentifier`.** Twenty would delete the entity and recreate it empty. Add new ones to `src/constants/universal-identifiers.ts`, generated with `crypto.randomUUID()`.
- Follow the rules the Twenty build enforces, listed in [AGENTS.md](AGENTS.md).
- Logic functions import runtime helpers from `twenty-sdk/logic-function`, never from `twenty-shared`.
- Keep handlers thin: put logic in `src/logic-functions/utils/` and export the handler so it can be unit tested.
- Every behavior change comes with a unit test. Tests must not call Allo: use the fakes in `src/__tests__/utils/`.
- Comment why, not what. Keep comments for constraints that the code cannot show, such as an Allo or Twenty behavior.
- Write user-facing text in plain English.

## Testing a webhook change by hand

Unit tests cover the receiver and the target separately. After a change to the webhook flow, also check a real delivery:

1. Install the app on an HTTPS Twenty server.
2. In the app's Settings tab, paste a test Allo API key and click Connect.
3. Check the webhook in Allo > Settings > Webhooks, then place a test call.
4. Follow `yarn twenty dev:function:logs` and check the record under **Allo Calls**.

## Pull requests

- One topic per pull request, with a description of the behavior change and how you tested it.
- Add an entry under `Unreleased` in [CHANGELOG.md](CHANGELOG.md) for anything a user would notice.
- CI must be green.

## Releasing

Maintainers only.

1. Move the `Unreleased` entries in `CHANGELOG.md` under the new version.
2. Bump `version` in `package.json`. Twenty refuses a version that is not strictly higher than the installed one.
3. Merge, then tag: `git tag vX.Y.Z && git push --tags`. The `Publish` workflow publishes to npm with provenance.

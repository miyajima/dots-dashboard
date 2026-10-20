# Development dashboard

Source for an authenticated development dashboard with project sessions, tasks,
notification receipts, offline classification tools and cloud agent-team tracking.
The bundled project catalog and test data are synthetic. Historical conversations,
operational notes, owner identities, live connection settings and original Git
history are excluded. This repository starts with an independent code-only history.

Use Node.js 22.13 or newer (with `node:sqlite`), Python 3 and npm:

```sh
npm ci
npm run build
npm test
```

Tests use offline fixtures and in-memory databases. `dist/` is generated and ignored.
Schema migrations are under `drizzle/`; the Worker expects a D1-compatible `DB`
binding and an R2-compatible `UPLOADS` binding. The generic hosting manifest has no
Site identity. An optional `SITES_PROJECT_ID` build variable adds that identity only
to the ignored generated manifest. No deployment command or CI workflow is included.

The Worker must run behind a trusted authenticated gateway that strips caller-set
`oai-authenticated-*` headers and injects the verified user identity. Direct public
access to the Worker would not provide that trust boundary. Keep application access
owner-private. Existing owner, session, source, task and `plan_only` checks remain
mandatory. `.env.example` documents placeholders; scripts do not load it automatically.
Never commit runtime databases, credentials, real task exports or callback secrets.

Cloud configuration verification defaults to closed. Supply the server-only
`CLOUD_EXECUTION_CONFIGS_JSON` variable as a JSON array of fully scoped objects:

```json
[{"environmentConfigId":"workspace_fixture~asenvcfg_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","executorType":"codex_cloud","ownerId":"subject_owner_fixture","projectId":"example_project","taskId":"task_parent_fixture","sourceMessageId":"source_parent_fixture"}]
```

Replace placeholders only in the server environment after official readback verifies
the configuration and authenticated task/source ownership. Invalid, incomplete,
unknown-key or desktop configurations are rejected. Request bodies cannot set policy.
Configuration verification does not authorize execution or grant repository access.

The dashboard records externally observed, authorized cloud runs. Its current
runtime does not expose autonomous Codex dispatch; queued records do not mean a
cloud task has launched. Actual task IDs, configuration/instance bindings and
independent review of the exact commit/tree must be observed before completion.
An unknown launch result requires reconciliation, never an automatic retry.
Approval waits remain separate from the 10/20-minute no-result checks. Permission
denial stops execution. Notification acceptance receipts never imply task completion.

Webhook delivery retains the official `https://connectors.api.openai.com` origin
allowlist. Subscriptions, callback addresses and signing secrets belong in private
runtime storage and server configuration; no live subscription is bundled. Imported
classification evidence does not authorize task launches. No real import, launch,
publication, deployment, call or payment is performed by the build or tests.

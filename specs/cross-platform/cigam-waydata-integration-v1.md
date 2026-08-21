# CIGAM × WayData Integration v1

## Problem

PANEBRAS needs an auditable, near-real-time integration between CIGAM and WayData. Customer, route, shipment, order, cancellation, delivery status, and signed proof-of-delivery flows must run without an operator keeping the monitor open.

## Scope

- Poll integration-ready records from the official CIGAM API on a configurable interval.
- Validate, create, or update WayData customers before route submission.
- Create or update complete WayData routings and persist their external codes in CIGAM.
- Propagate route and order cancellations.
- Poll delivery results and attach each signed proof of delivery to the matching CIGAM invoice tracking record exactly once.
- Persist immutable, sanitized JSONL audit events and durable file-backed reprocessing requests.
- Provide an independent operational monitor with filters, health, export, and manual reprocessing.
- Send deduplicated email alerts when SMTP is configured.

## Out of scope

- Changes to native CIGAM routing, ordering, billing, or reporting.
- A dedicated integration database.
- BI/SLA analytics and billing blocks.
- Production activation before official CIGAM write contracts, controlled homologation data, and functional approval exist.

## Architecture

- CIGAM remains the transactional source of truth.
- WayData remains the logistics execution source of truth.
- The worker owns orchestration, retries, idempotency, logging, and alerts.
- The monitor reads audit files and appends reprocessing requests; it never runs the scheduler.
- API paths are configurable because the received production collection currently confirms only `Empresas` and `Cargas_Buscar`.

## Acceptance criteria

1. A cycle cannot overlap another cycle in the same process.
2. Transient HTTP failures retry with bounded exponential backoff and jitter; validation and authentication failures do not retry indefinitely.
3. Secrets, authorization headers, cookies, binary files, and base64 proof payloads never appear in logs or API errors.
4. Each client is queried before create/update, and a route is not sent until all referenced clients are valid.
5. Route creation uses external code zero; updates send the complete payload and saved external code.
6. Repeated route, cancellation, tracking, and receipt work is idempotent.
7. Receipt bytes are size-limited, type-checked, and attached to the matching invoice once.
8. Reprocessing requests survive restart, transition through pending/processing/done/error, and produce linked audit events.
9. The monitor validates dates and request bodies, uses same-origin protection for write actions, sanitizes output, and supports server-side export.
10. Health reports the last completed cycle, current state, and whether synchronization is enabled without exposing configuration secrets.
11. Automated tests cover sanitization, retries, JSONL recovery, client/route flow, cancellation, receipt idempotency, and reprocessing.
12. Typecheck, tests, production build, and a local smoke run pass.

## Security

- Credentials are accepted only through environment variables or the deployment secret store.
- User-controlled and external text is rendered as React text, never injected as HTML.
- Monitor write endpoints reject cross-origin requests and invalid payloads.
- Date/file inputs are schema validated; resolved file access remains under the configured data directory.
- API response and error bodies are bounded and sanitized before persistence or display.
- Receipt downloads accept only configured document/image types and enforce a maximum byte size.
- Exported logs are sanitized and served as an attachment.

## Test plan

- Unit: schemas, secret redaction, retry classification, correlation/idempotency keys.
- Integration: mock CIGAM and WayData servers for create/update/cancel/status/receipt and reprocessing.
- Storage: malformed/truncated JSONL lines, queue state transitions, health atomic write.
- API: invalid dates, invalid JSON, cross-origin write, sanitized export.
- Visual: empty, populated, error, narrow viewport, long text, light and dark themes.

## Delivery phases

1. Foundation and API validation.
2. Customers and routes.
3. Returns and signed receipts.
4. Monitor and alerts.
5. End-to-end homologation, training, go-live, and post-go-live support.

## Open external dependencies

- Official CIGAM write contracts for integration state, invoice tracking, and attachments.
- Controlled homologation records and authorization for WayData `PUT`, `PATCH`, and `DELETE` operations.
- Production SMTP, retention, receipt storage, and deployment policies.

# End-to-End Test Report — 2026-08-08

## Scope

Client-like validation of the CIGAM × WayData worker, local monitor, APIs, security controls, responsive layout, and the complete automated test suite.

## Automated result

- TypeScript typecheck: passed for all 8 packages/apps.
- Vitest: 6 test files, 12 tests passed, 0 failed.
- Production build: passed for worker and monitor.
- Secret scan: no JWT or Bearer credential found in source or Markdown.

## Simulated homologation

The test used local CIGAM and WayData HTTP servers with the production clients and worker implementation. It exercised:

1. CIGAM pending-route discovery.
2. WayData customer lookup returning not found.
3. Customer creation before routing.
4. Complete routing creation and external-code persistence in CIGAM.
5. Delivery result retrieval.
6. Authenticated signed-receipt download.
7. Invoice tracking update.
8. Receipt attachment to the correct invoice.
9. Second-cycle idempotency: the receipt was not attached twice.
10. Route and order cancellation propagation.
11. Sanitized audit logs without either test credential.

Result: passed.

## Monitor journey

- Health endpoint and connected-worker state: passed.
- Log loading and period validation: passed.
- Status filter: passed; error view showed only the expected error.
- Text search and empty state: passed.
- Event details drawer: passed.
- Manual reprocessing request: passed.
- Server-side JSONL export initiated from the UI: passed.
- Invalid JSON rejected with `400`: passed.
- Inverted date interval rejected with `400`: passed.
- Cross-origin write rejected with `403`: passed.
- Narrow viewport at 700 px: passed without horizontal overflow.
- Dark theme: passed after correcting the Update button contrast found during this run.

## External homologation boundary

Real destructive WayData operations were not executed. Production-like activation still requires controlled homologation records and explicit functional authorization for `PUT`, `PATCH`, and `DELETE`. Real CIGAM return, tracking, and attachment operations also require the official write contracts. Until then, `SYNC_ENABLED=false` remains the accepted safe state.

## Real CIGAM read-only activation

- PANEBRAS `Cargas_Buscar`: HTTP `200`.
- Real records returned in one cycle: 100.
- Monitor events after demo cleanup: 100 discoveries plus one cycle summary.
- Duplicate discoveries across later cycles: prevented by correlation ID.
- Monitor state: explicitly identified as read-only.
- Reprocessing while read-only: disabled in both worker and UI.
- Pagination: 25 events per page, 5 pages for the current result set.
- Horizontal overflow at the validated desktop viewport: none.

## Final assessment

The implementation is technically ready for controlled external homologation. No automated, local API, or UI acceptance check remains failing.

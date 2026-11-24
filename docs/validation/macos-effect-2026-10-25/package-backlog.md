# Effect package follow-up — 25 October 2026

This supersedes the requests derived from hosted core 0.0.1 on 11 October; it does not rewrite that historical evidence.

## Resolved in the hosted release

The consumer now resolves hosted `effect_core 0.0.3`, SHA-256 `318da1cd970debe4b7b50148f82135c99bbeb860bbd2ec99984a3d60b39ec5c8`.

- Timeout preserves cleanup failures in Sequential causes. Consumer regressions cover expected cleanup failures and defects, retained stack traces, exactly one release, and no retry of a composite failure.
- `retry(..., whileError: ...)` replaces the application's successful-Exit workaround.
- Schedule supports maxDelay, elapsedBudget, error-dependent retryAfter, and independent unseeded jitter. The application uses an outer timeout for an actual whole-operation budget; admission budgets are not deadlines.
- Runtime lifecycle hooks and bounded metrics are available and exposed as optional ApiClient constructor arguments. Observer failures cannot alter outcomes. Runtime-local fiber IDs are not globally unique request IDs.
- CircuitBreaker and rate-limiting helpers exist. They are available policies, not automatically enabled on all app calls: a new breaker was not justified by a reproduced app outage.
- Hosted `effect_http 0.0.2` provides bounded response/SSE handling and admission. It is intentionally not an unused app dependency.

## Remaining adapter requests

These are newly identified consumer-fit gaps in the released adapter, not missing core primitives:

1. **POST/body support for SSE.** The public `sse` method always sends GET. Chat sends authenticated JSON POST and must never reconnect or replay automatically. Accept method/body (or a fresh request factory), with the same abort and size/admission guarantees.
2. **Bounded error-response diagnostics.** `request` discards a non-2xx response body. The app relies on the server's structured error code and safe message, including permanent domain failures returned with a transient status. Offer bounded error bytes or a caller-supplied status decoder without losing the original status/Retry-After or weakening cleanup.
3. **Application request correlation.** Lifecycle events provide per-runtime fiber IDs; this app creates request runtimes. A caller-supplied correlation context would simplify joining retries and stream stages without exporting headers/payloads. Existing callbacks can implement this today; it is an ergonomics request.

No package source checkout was changed, no upstream issue was posted, and no release was published. The application retains its transport adapter for the first two gaps and now bounds its response bodies and SSE frames itself.

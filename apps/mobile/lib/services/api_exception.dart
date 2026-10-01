/// Error taxonomy for the API client.
///
/// The server has one error shape (`ApiError` in api-types.ts) and five codes.
/// Transport-level problems (socket refused, DNS, timeout) never reach the
/// server, so they get their own type. Both surface to the UI through a single
/// sealed hierarchy, which lets widgets switch over the failure and pick a
/// recovery affordance without string matching.
library;

sealed class ApiException implements Exception {
  const ApiException(this.message);

  /// A message safe to show a player verbatim.
  final String message;

  /// Whether retrying the identical request could plausibly succeed.
  bool get isRetryable;

  @override
  String toString() => '$runtimeType: $message';
}

/// The API answered with a non-2xx status and a parseable `ApiError` body.
final class ApiServerException extends ApiException {
  const ApiServerException({required this.statusCode, required this.code, required String message})
    : super(message);

  final int statusCode;

  /// `BAD_REQUEST` | `UNKNOWN_PROBLEM` | `UNKNOWN_GAME` | `GENERATION_FAILED` |
  /// `UNAUTHORIZED` | `EMAIL_TAKEN` | `INVALID_CREDENTIALS` | `RATE_LIMITED` |
  /// `INTERNAL`.
  final String code;

  bool get isUnknownGame => code == 'UNKNOWN_GAME';
  bool get isUnknownProblem => code == 'UNKNOWN_PROBLEM';
  bool get isGenerationFailure => code == 'GENERATION_FAILED';

  /// A signed-out caller hit an account-scoped route: the fix is sign-in, not
  /// retry. `EMAIL_TAKEN` / `INVALID_CREDENTIALS` are credential problems, so
  /// they are not retryable either.
  bool get isUnauthorized => code == 'UNAUTHORIZED';

  @override
  bool get isRetryable => statusCode >= 500 || code == 'GENERATION_FAILED';
}

/// The request never produced an HTTP response: refused connection, DNS
/// failure, TLS error, timeout. On mobile this is almost always "the laptop
/// server is not running" or "you used the wrong host for this device".
final class ApiUnreachableException extends ApiException {
  const ApiUnreachableException(super.message, {this.baseUrl});

  final String? baseUrl;

  @override
  bool get isRetryable => true;
}

/// A 2xx response whose body did not match the contract.
final class MalformedResponse extends ApiException {
  const MalformedResponse(super.message);

  @override
  bool get isRetryable => true;
}

/// The request took longer than the client is willing to wait. Generation on
/// tier 1 is slow, so the action/generate timeouts are generous.
final class ApiTimeoutException extends ApiException {
  const ApiTimeoutException(super.message, {this.timeout});

  final Duration? timeout;

  @override
  bool get isRetryable => true;
}

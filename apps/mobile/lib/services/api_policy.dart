/// Compile-time defaults with optional per-client overrides.
class ApiPolicy {
  const ApiPolicy({
    this.readBudgetMs = defaultReadBudgetMs,
    this.maxStreamFrameCharacters = 1048576,
    this.maxResponseBytes = 8388608,
    this.readRetries = defaultReadRetries,
    this.retryDelayMs = defaultRetryDelayMs,
    this.streamConnectTimeoutMs = defaultStreamConnectTimeoutMs,
    this.streamIdleTimeoutMs = defaultStreamIdleTimeoutMs,
  }) : assert(readRetries >= 0 && readRetries <= 5),
       assert(retryDelayMs >= 0 && retryDelayMs <= 10000),
       assert(streamConnectTimeoutMs > 0 && streamConnectTimeoutMs <= 300000),
       assert(streamIdleTimeoutMs > 0 && streamIdleTimeoutMs <= 600000);

  static const _retries = int.fromEnvironment(
    'API_READ_RETRIES',
    defaultValue: 2,
  );
  static const _delay = int.fromEnvironment(
    'API_RETRY_DELAY_MS',
    defaultValue: 250,
  );
  static const _connect = int.fromEnvironment(
    'API_STREAM_CONNECT_TIMEOUT_MS',
    defaultValue: 30000,
  );
  static const _idle = int.fromEnvironment(
    'API_STREAM_IDLE_TIMEOUT_MS',
    defaultValue: 190000,
  );
  static const _request = int.fromEnvironment(
    'API_TIMEOUT_MS',
    defaultValue: 10000,
  );
  static const _generate = int.fromEnvironment(
    'API_GENERATE_TIMEOUT_MS',
    defaultValue: 240000,
  );
  static const _action = int.fromEnvironment(
    'API_ACTION_TIMEOUT_MS',
    defaultValue: 20000,
  );
  static const defaultReadRetries = _retries >= 0 && _retries <= 5
      ? _retries
      : 2;
  static const defaultRetryDelayMs = _delay >= 0 && _delay <= 10000
      ? _delay
      : 250;
  static const defaultStreamConnectTimeoutMs =
      _connect > 0 && _connect <= 300000 ? _connect : 30000;
  static const defaultStreamIdleTimeoutMs = _idle > 0 && _idle <= 600000
      ? _idle
      : 190000;
  static const defaultRequestTimeoutMs = _request > 0 && _request <= 300000
      ? _request
      : 10000;
  static const defaultGenerateTimeoutMs = _generate > 0 && _generate <= 600000
      ? _generate
      : 240000;
  static const defaultActionTimeoutMs = _action > 0 && _action <= 300000
      ? _action
      : 20000;

  static const _budget = int.fromEnvironment(
    'API_READ_BUDGET_MS',
    defaultValue: 15000,
  );
  static const defaultReadBudgetMs = _budget > 0 && _budget <= 300000
      ? _budget
      : 15000;
  final int readBudgetMs;
  final int maxStreamFrameCharacters;
  final int maxResponseBytes;
  final int readRetries;
  final int retryDelayMs;
  final int streamConnectTimeoutMs;
  final int streamIdleTimeoutMs;

  /// Validate overrides even in release builds where assertions are disabled.
  void validate() {
    if (maxResponseBytes <= 0 ||
        maxResponseBytes > 33554432 ||
        readBudgetMs <= 0 ||
        readBudgetMs > 300000 ||
        maxStreamFrameCharacters <= 0 ||
        maxStreamFrameCharacters > 8388608 ||
        readRetries < 0 ||
        readRetries > 5 ||
        retryDelayMs < 0 ||
        retryDelayMs > 10000 ||
        streamConnectTimeoutMs <= 0 ||
        streamConnectTimeoutMs > 300000 ||
        streamIdleTimeoutMs <= 0 ||
        streamIdleTimeoutMs > 600000) {
      throw ArgumentError('Invalid API retry/stream policy');
    }
  }
}

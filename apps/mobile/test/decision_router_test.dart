import 'package:dsa_game_mobile/models/api.dart';
import 'package:dsa_game_mobile/models/provider.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('semantic metadata does not disappear into heuristic parsing', () {
    final result = DecideResponse.from({
      'kind': 'route-problem',
      'choice': 'two-sum',
      'confidence': 0.72,
      'source': 'semantic',
      'model': 'minilm',
      'scoreKind': 'cosine-similarity',
      'score': 0.72,
      'margin': 0.12,
    });
    expect(result.source, CoachSource.semantic);
    expect(result.model, 'minilm');
    expect(result.scoreKind, 'cosine-similarity');
    expect(result.margin, 0.12);
    expect(CoachSource.parse('zero-shot'), CoachSource.zeroShot);
  });
  test('neutral decision health and legacy laya coexist', () {
    final health = HealthResponse.from({
      'ok': true,
      'version': 'test',
      'tiers': [],
      'laya': {'enabled': false, 'available': false},
      'uptimeSec': 1,
      'decision': {'backend': 'semantic', 'available': true, 'model': 'minilm'},
    });
    expect(health.decision?.backend, 'semantic');
    expect(health.decision?.available, true);
    expect(health.laya.available, false);
  });
}

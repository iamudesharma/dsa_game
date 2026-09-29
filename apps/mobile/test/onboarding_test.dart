/// Onboarding tips: three stable tips, dismissal persisted through the
/// adventure store's own key-value surface, graceful degradation.
///
/// Mirrors the web client's `onboarding.test.ts` contract. The store here is
/// the real [MemoryBackend] (not a fake shaped for the test), so the
/// persistence path is the production one.
library;

import 'package:dsa_game_mobile/adventure/progress_store.dart';
import 'package:dsa_game_mobile/learn/onboarding.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('ships three short tips with stable ids', () {
    expect(onboardingTips, hasLength(3));
    expect(onboardingTips.map((t) => t.id).toSet(), hasLength(3));
    for (final tip in onboardingTips) {
      expect(tip.title.trim(), isNotEmpty);
      expect(tip.body.trim(), isNotEmpty);
    }
  });

  test('shows until dismissed, hides after, and comes back on reset', () async {
    final store = MemoryBackend();
    expect(await shouldShowOnboarding(store), isTrue);
    await dismissOnboarding(store);
    expect(await shouldShowOnboarding(store), isFalse);
    await resetOnboarding(store);
    expect(await shouldShowOnboarding(store), isTrue);
  });

  test('degrades to visible when storage is missing or throws', () async {
    expect(await shouldShowOnboarding(null), isTrue);
    await dismissOnboarding(null);
    await resetOnboarding(null);

    final blocked = MemoryBackend()..failReads = true;
    expect(await shouldShowOnboarding(blocked), isTrue);
  });
}

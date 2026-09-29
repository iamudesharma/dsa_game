/// First-visit onboarding tips, mirroring `apps/web/src/lib/onboarding.ts`.
///
/// Three sentences of permission — wrong moves are free, one sentence always
/// says what to do, stamps are the whole progression — then out of the way
/// forever. Dismissal persists through the adventure store's own
/// [KeyValueStore] under a separate key, so saving tips can never mint or
/// erase a stamp (the same separation the notebook drafts use). A missing or
/// throwing store degrades to "show the tips again", never to an error.
library;

import '../adventure/progress_store.dart';

class OnboardingTip {
  const OnboardingTip({required this.id, required this.title, required this.body});

  final String id;
  final String title;
  final String body;
}

const List<OnboardingTip> onboardingTips = [
  OnboardingTip(
    id: 'follow-the-sentence',
    title: 'Follow the one sentence',
    body: 'Every board tells you what to do next at the top, in one sentence. The highlighted tiles are the algorithm\u2019s next step \u2014 try that operation.',
  ),
  OnboardingTip(
    id: 'wrong-moves-are-free',
    title: 'Wrong moves are free',
    body: 'Every move is checked by the algorithm\u2019s own rules. A miss explains what the algorithm wanted instead \u2014 explore freely, your stamp only needs a win.',
  ),
  OnboardingTip(
    id: 'stamps-are-progress',
    title: 'Stamps are the whole progression',
    body: 'Winning a mission earns a stamp in your collection. Finish a whole world for its badge and map frame. Nothing is ever locked.',
  ),
];

const String onboardingStorageKey = 'play-the-algorithms:onboarding:v1';

/// True when the tips should be shown (never dismissed, or storage unusable).
Future<bool> shouldShowOnboarding(KeyValueStore? store) async {
  if (store == null) return true;
  try {
    return await store.readKey(onboardingStorageKey) != 'seen';
  } catch (_) {
    return true;
  }
}

/// Remember the dismissal. A failure keeps the tips visible — never an error.
Future<void> dismissOnboarding(KeyValueStore? store) async {
  if (store == null) return;
  try {
    await store.writeKey(onboardingStorageKey, 'seen');
  } catch (_) {}
}

/// Bring the tips back; used by the re-show affordance under the card.
Future<void> resetOnboarding(KeyValueStore? store) async {
  if (store == null) return;
  try {
    await store.writeKey(onboardingStorageKey, '');
  } catch (_) {}
}

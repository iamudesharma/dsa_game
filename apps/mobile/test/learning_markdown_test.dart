import 'package:dsa_game_mobile/widgets/learning_markdown.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets(
    'each code block has its own copy action and scrolls on narrow screens',
    (tester) async {
      tester.view.physicalSize = const Size(300, 600);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      final copied = <String>[];
      tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
        SystemChannels.platform,
        (call) async {
          if (call.method == 'Clipboard.setData') {
            copied.add((call.arguments as Map)['text'] as String);
          }
          return null;
        },
      );
      addTearDown(
        () => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
          SystemChannels.platform,
          null,
        ),
      );
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: SingleChildScrollView(
              child: LearningMarkdown(
                text: 'First example\n```python\nprint("a very long example that must scroll horizontally without hiding the copy control")\n```\nSecond example\n```dart\nreturn 2;\n```',
              ),
            ),
          ),
        ),
      );
      expect(find.text('python'), findsOneWidget);
      expect(find.text('dart'), findsOneWidget);
      expect(find.text('Copy code'), findsNWidgets(2));
      await tester.tap(find.text('Copy code').last);
      await tester.pump();
      expect(copied.single, 'return 2;\n');
      expect(tester.takeException(), isNull);
    },
  );
}

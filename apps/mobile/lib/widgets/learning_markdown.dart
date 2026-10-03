import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_markdown_plus/flutter_markdown_plus.dart';

/// Selectable Markdown with a copy control next to each fenced code block.
class LearningMarkdown extends StatelessWidget {
  const LearningMarkdown({required this.text, super.key});
  final String text;

  @override
  Widget build(BuildContext context) {
    final children = <Widget>[];
    var cursor = 0;
    for (final match in RegExp(
      r'```([^\n]*)\n([\s\S]*?)```',
    ).allMatches(text)) {
      if (match.start > cursor) {
        children.add(
          MarkdownBody(
            data: text.substring(cursor, match.start),
            selectable: true,
            softLineBreak: true,
          ),
        );
      }
      final language = match.group(1)!.trim();
      final code = match.group(2)!;
      children.add(
        Container(
          margin: const EdgeInsets.symmetric(vertical: 8),
          decoration: BoxDecoration(
            color: Theme.of(context).colorScheme.surfaceContainerHighest,
            borderRadius: BorderRadius.circular(12),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 12),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        language.isEmpty ? 'Code' : language,
                        style: Theme.of(context).textTheme.labelMedium,
                      ),
                    ),
                    TextButton.icon(
                      onPressed: () async {
                        await Clipboard.setData(ClipboardData(text: code));
                        if (context.mounted) {
                          ScaffoldMessenger.maybeOf(context)?.showSnackBar(
                            const SnackBar(content: Text('Code copied')),
                          );
                        }
                      },
                      icon: const Icon(Icons.copy, size: 16),
                      label: const Text('Copy code'),
                    ),
                  ],
                ),
              ),
              SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
                child: SelectableText(
                  code.trimRight(),
                  style: const TextStyle(
                    fontFamily: 'monospace',
                    fontSize: 13,
                    height: 1.5,
                  ),
                ),
              ),
            ],
          ),
        ),
      );
      cursor = match.end;
    }
    if (cursor < text.length) {
      children.add(
        MarkdownBody(
          data: text.substring(cursor),
          selectable: true,
          softLineBreak: true,
        ),
      );
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: children,
    );
  }
}

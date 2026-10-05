import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../state/auth_controller.dart';
import '../state/game_controller.dart';
import 'topic_screen.dart';
import 'learning_hub_screen.dart';
import 'dashboard_screen.dart';
import 'chat_screen.dart';
import 'account_screen.dart';
import 'auth_screen.dart';

class AppShell extends StatefulWidget {
  const AppShell({super.key});
  @override
  State<AppShell> createState() => _AppShellState();
}

class _AppShellState extends State<AppShell> {
  int _index = 0;
  String? _account;
  final Set<int> _visited = {0};
  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthController>();
    if (_account != auth.user?.id) {
      _account = auth.user?.id;
      _visited.clear();
      _visited.add(_index);
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) context.read<GameController>().clearRun();
      });
    }
    final screens = [
      const TopicScreen(),
      const LearningHubScreen(),
      const DashboardScreen(),
      const ChatScreen(),
      auth.signedIn
          ? const AccountScreen()
          : Scaffold(
              appBar: AppBar(title: const Text('Profile')),
              body: Center(
                child: FilledButton(
                  onPressed: () => Navigator.push(
                    context,
                    MaterialPageRoute<bool>(builder: (_) => const AuthScreen()),
                  ),
                  child: const Text('Sign in'),
                ),
              ),
            ),
    ];
    final desktop = MediaQuery.sizeOf(context).width >= 720;
    void select(int i) => setState(() {
      _index = i;
      _visited.add(i);
    });
    final content = Column(
      children: [
        if (auth.sessionRecoveryAvailable)
          Material(
            color: Theme.of(context).colorScheme.surfaceContainerHighest,
            child: Padding(
              padding: const EdgeInsets.all(8),
              child: Wrap(
                spacing: 8,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  const Text(
                    'Could not verify your saved session. Check the connection and retry.',
                  ),
                  TextButton(
                    onPressed: auth.busy ? null : auth.boot,
                    child: const Text('Retry session'),
                  ),
                ],
              ),
            ),
          ),
        if (auth.guestImportAvailable)
          Material(
            color: Theme.of(context).colorScheme.surfaceContainerHighest,
            child: Padding(
              padding: const EdgeInsets.all(8),
              child: Wrap(
                spacing: 8,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  const Text(
                    'Guest completion stamps are available on this device.',
                  ),
                  TextButton(
                    onPressed: () async {
                      try {
                        await auth.importGuest();
                      } catch (e) {
                        if (context.mounted) {
                          ScaffoldMessenger.of(context)
                              .showSnackBar(SnackBar(content: Text('$e')));
                        }
                      }
                    },
                    child: const Text('Import stamps'),
                  ),
                ],
              ),
            ),
          ),
        Expanded(
          child: KeyedSubtree(
            key: ValueKey(auth.user?.id ?? 'guest'),
            child: IndexedStack(
              index: _index,
              children: [
                for (var i = 0; i < screens.length; i++)
                  _visited.contains(i) ? screens[i] : const SizedBox.shrink(),
              ],
            ),
          ),
        ),
      ],
    );
    return Scaffold(
      // Each tab owns a Scaffold that already accommodates the keyboard.
      resizeToAvoidBottomInset: false,
      body: desktop
          ? Row(
              children: [
                NavigationRail(
                  selectedIndex: _index,
                  onDestinationSelected: select,
                  labelType: NavigationRailLabelType.all,
                  destinations: const [
                    NavigationRailDestination(
                      icon: Icon(Icons.explore_outlined),
                      label: Text('Explore'),
                    ),
                    NavigationRailDestination(
                      icon: Icon(Icons.menu_book_outlined),
                      label: Text('Learn'),
                    ),
                    NavigationRailDestination(
                      icon: Icon(Icons.insights),
                      label: Text('Progress'),
                    ),
                    NavigationRailDestination(
                      icon: Icon(Icons.chat_bubble_outline),
                      label: Text('Chat'),
                    ),
                    NavigationRailDestination(
                      icon: Icon(Icons.person_outline),
                      label: Text('Profile'),
                    ),
                  ],
                ),
                const VerticalDivider(width: 1),
                Expanded(
                  child: Align(
                    alignment: Alignment.topCenter,
                    child: ConstrainedBox(
                      constraints: const BoxConstraints(maxWidth: 1080),
                      child: content,
                    ),
                  ),
                ),
              ],
            )
          : content,
      bottomNavigationBar: desktop
          ? null
          : NavigationBar(
              selectedIndex: _index,
              onDestinationSelected: select,
              destinations: const [
                NavigationDestination(
                  icon: Icon(Icons.explore_outlined),
                  label: 'Explore',
                ),
                NavigationDestination(
                  icon: Icon(Icons.menu_book_outlined),
                  label: 'Learn',
                ),
                NavigationDestination(
                  icon: Icon(Icons.insights),
                  label: 'Progress',
                ),
                NavigationDestination(
                  icon: Icon(Icons.chat_bubble_outline),
                  label: 'Chat',
                ),
                NavigationDestination(
                  icon: Icon(Icons.person_outline),
                  label: 'Profile',
                ),
              ],
            ),
    );
  }
}

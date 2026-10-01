/// Sign in / create account.
///
/// Play stays anonymous — this only gates resume/interview. On success the
/// screen pops with `true` so the caller can push the account screen; the
/// adventure progress merge happens in [AuthController], not here.
library;

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../state/auth_controller.dart';
import '../theme/palette.dart';

class AuthScreen extends StatefulWidget {
  const AuthScreen({this.startOnSignup = false, super.key});

  final bool startOnSignup;

  @override
  State<AuthScreen> createState() => _AuthScreenState();
}

class _AuthScreenState extends State<AuthScreen> {
  late bool _signup = widget.startOnSignup;
  final _email = TextEditingController();
  final _password = TextEditingController();
  final _form = GlobalKey<FormState>();

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.gameColors;
    final auth = context.watch<AuthController>();
    return Scaffold(
      appBar: AppBar(title: Text(_signup ? 'Create account' : 'Sign in')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(18, 12, 18, 28),
          children: [
            Text(
              _signup ? 'One account holds your resume, target company, interview kits, and progress across devices.' : 'Your games stay playable without an account. Signing in unlocks your resume and interview prep.',
              style: TextStyle(fontSize: 12.5, height: 1.4, color: colors.muted),
            ),
            const SizedBox(height: 14),
            Form(
              key: _form,
              child: Column(
                children: [
                  TextFormField(
                    controller: _email,
                    keyboardType: TextInputType.emailAddress,
                    autocorrect: false,
                    enableSuggestions: false,
                    decoration: const InputDecoration(labelText: 'Email', border: OutlineInputBorder()),
                    validator: (v) => (v == null || !v.contains('@')) ? 'Enter a valid email address.' : null,
                  ),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: _password,
                    obscureText: true,
                    enableSuggestions: false,
                    autocorrect: false,
                    decoration: const InputDecoration(labelText: 'Password (8+ characters)', border: OutlineInputBorder()),
                    validator: (v) => (v == null || v.length < 8) ? 'Passwords are at least 8 characters.' : null,
                  ),
                ],
              ),
            ),
            if (auth.error != null) ...[
              const SizedBox(height: 10),
              Text(auth.error!.message, style: TextStyle(fontSize: 12.5, color: colors.danger)),
            ],
            const SizedBox(height: 14),
            FilledButton.icon(
              onPressed: auth.busy
                  ? null
                  : () async {
                      if (!(_form.currentState?.validate() ?? false)) return;
                      final ok = _signup
                          ? await auth.signup(email: _email.text, password: _password.text)
                          : await auth.login(email: _email.text, password: _password.text);
                      if (ok && context.mounted) Navigator.of(context).pop(true);
                    },
              icon: auth.busy
                  ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                  : const Icon(Icons.login_rounded, size: 18),
              label: Text(auth.busy ? 'Working…' : (_signup ? 'Create account' : 'Sign in')),
            ),
            const SizedBox(height: 6),
            TextButton(
              onPressed: auth.busy
                  ? null
                  : () => setState(() {
                      _signup = !_signup;
                      auth.clearError();
                    }),
              child: Text(_signup ? 'Already have one? Sign in' : 'No account yet? Create one'),
            ),
          ],
        ),
      ),
    );
  }
}

import 'package:flutter/material.dart';

import '../settings/app_settings.dart';

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({
    required this.settings,
    required this.onSave,
    super.key,
  });

  final AppSettings settings;
  final Future<void> Function(AppSettings settings) onSave;

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _apiUrlController;
  late final TextEditingController _apiKeyController;
  late AppThemeMode _themeMode;
  bool _isSaving = false;

  @override
  void initState() {
    super.initState();
    _apiUrlController = TextEditingController(text: widget.settings.apiUrl);
    _apiKeyController = TextEditingController(text: widget.settings.apiKey);
    _themeMode = widget.settings.themeMode;
  }

  @override
  void dispose() {
    _apiUrlController.dispose();
    _apiKeyController.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (!(_formKey.currentState?.validate() ?? false)) {
      return;
    }

    setState(() {
      _isSaving = true;
    });

    await widget.onSave(
      widget.settings.copyWith(
        apiUrl: _apiUrlController.text,
        apiKey: _apiKeyController.text,
        themeMode: _themeMode,
      ),
    );

    if (!mounted) {
      return;
    }

    setState(() {
      _isSaving = false;
    });

    ScaffoldMessenger.of(
      context,
    ).showSnackBar(const SnackBar(content: Text('설정을 저장했습니다.')));
    Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            TextFormField(
              controller: _apiUrlController,
              keyboardType: TextInputType.url,
              decoration: const InputDecoration(
                labelText: 'API URL',
                hintText: 'https://your-bridge.example.com',
                border: OutlineInputBorder(),
              ),
              validator: (value) {
                final trimmed = value?.trim() ?? '';
                if (trimmed.isEmpty) {
                  return 'API URL을 입력해주세요.';
                }

                final uri = Uri.tryParse(trimmed);
                if (uri == null ||
                    !uri.hasScheme ||
                    !(uri.scheme == 'http' || uri.scheme == 'https') ||
                    uri.host.isEmpty) {
                  return '올바른 API URL 형식이 아닙니다.';
                }

                return null;
              },
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _apiKeyController,
              obscureText: true,
              decoration: const InputDecoration(
                labelText: 'API Key',
                border: OutlineInputBorder(),
              ),
              validator: (value) {
                if ((value?.trim() ?? '').isEmpty) {
                  return 'API Key를 입력해주세요.';
                }
                return null;
              },
            ),
            const SizedBox(height: 12),
            DropdownButtonFormField<AppThemeMode>(
              initialValue: _themeMode,
              decoration: const InputDecoration(
                labelText: 'Theme',
                border: OutlineInputBorder(),
              ),
              items: const [
                DropdownMenuItem(
                  value: AppThemeMode.light,
                  child: Text('Light'),
                ),
                DropdownMenuItem(value: AppThemeMode.dark, child: Text('Dark')),
              ],
              onChanged: (value) {
                if (value == null) {
                  return;
                }
                setState(() {
                  _themeMode = value;
                });
              },
            ),
            const SizedBox(height: 20),
            FilledButton(
              onPressed: _isSaving ? null : _save,
              child: Text(_isSaving ? 'Saving...' : 'Save'),
            ),
          ],
        ),
      ),
    );
  }
}

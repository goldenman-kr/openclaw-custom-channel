import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'screens/chat_screen.dart';
import 'screens/settings_screen.dart';
import 'settings/app_settings.dart';
import 'settings/app_settings_controller.dart';
import 'settings/settings_repository.dart';
import 'theme/app_theme.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final preferences = await SharedPreferences.getInstance();
  final settingsRepository = SharedPreferencesSettingsRepository(preferences);
  final initialSettings = await settingsRepository.load();

  runApp(
    OpenClawClientApp(
      settingsRepository: settingsRepository,
      initialSettings: initialSettings,
    ),
  );
}

class OpenClawClientApp extends StatefulWidget {
  const OpenClawClientApp({
    required this.settingsRepository,
    this.initialSettings = AppSettings.empty,
    super.key,
  });

  final SettingsRepository settingsRepository;
  final AppSettings initialSettings;

  @override
  State<OpenClawClientApp> createState() => _OpenClawClientAppState();
}

class _OpenClawClientAppState extends State<OpenClawClientApp> {
  late final AppSettingsController _settingsController;

  @override
  void initState() {
    super.initState();
    _settingsController = AppSettingsController(
      repository: widget.settingsRepository,
      initialSettings: widget.initialSettings,
    );
  }

  @override
  void dispose() {
    _settingsController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _settingsController,
      builder: (context, _) {
        return MaterialApp(
          title: 'OpenClaw Chat',
          theme: AppTheme.light(),
          darkTheme: AppTheme.dark(),
          themeMode: _settingsController.settings.themeMode
              .toMaterialThemeMode(),
          routes: {
            '/': (_) => ChatScreen(settings: _settingsController.settings),
            '/settings': (_) => SettingsScreen(
              settings: _settingsController.settings,
              onSave: _settingsController.save,
            ),
          },
        );
      },
    );
  }
}

extension on AppThemeMode {
  ThemeMode toMaterialThemeMode() {
    return switch (this) {
      AppThemeMode.light => ThemeMode.light,
      AppThemeMode.dark => ThemeMode.dark,
    };
  }
}

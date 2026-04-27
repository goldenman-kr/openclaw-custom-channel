import 'package:flutter/foundation.dart';

import 'app_settings.dart';
import 'settings_repository.dart';

class AppSettingsController extends ChangeNotifier {
  AppSettingsController({
    required SettingsRepository repository,
    required AppSettings initialSettings,
  }) : _repository = repository,
       _settings = initialSettings;

  final SettingsRepository _repository;
  AppSettings _settings;

  AppSettings get settings => _settings;

  Future<void> save(AppSettings settings) async {
    final normalized = settings.copyWith(
      apiUrl: settings.apiUrl.trim(),
      apiKey: settings.apiKey.trim(),
      deviceId: settings.deviceId?.trim(),
      userId: settings.userId?.trim(),
    );

    await _repository.save(normalized);
    _settings = normalized;
    notifyListeners();
  }
}

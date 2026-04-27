import 'package:shared_preferences/shared_preferences.dart';

import 'app_settings.dart';

abstract class SettingsRepository {
  Future<AppSettings> load();
  Future<void> save(AppSettings settings);
}

class SharedPreferencesSettingsRepository implements SettingsRepository {
  SharedPreferencesSettingsRepository(this._preferences);

  final SharedPreferences _preferences;

  static const _apiUrlKey = 'settings.apiUrl';
  static const _apiKeyKey = 'settings.apiKey';
  static const _themeModeKey = 'settings.themeMode';
  static const _deviceIdKey = 'settings.deviceId';
  static const _userIdKey = 'settings.userId';

  @override
  Future<AppSettings> load() async {
    final themeValue = _preferences.getString(_themeModeKey);
    return AppSettings(
      apiUrl: _preferences.getString(_apiUrlKey) ?? '',
      apiKey: _preferences.getString(_apiKeyKey) ?? '',
      themeMode: AppThemeMode.values.firstWhere(
        (mode) => mode.name == themeValue,
        orElse: () => AppThemeMode.light,
      ),
      deviceId: _preferences.getString(_deviceIdKey),
      userId: _preferences.getString(_userIdKey),
    );
  }

  @override
  Future<void> save(AppSettings settings) async {
    await _preferences.setString(_apiUrlKey, settings.apiUrl.trim());
    await _preferences.setString(_apiKeyKey, settings.apiKey.trim());
    await _preferences.setString(_themeModeKey, settings.themeMode.name);

    if (settings.deviceId?.trim().isNotEmpty ?? false) {
      await _preferences.setString(_deviceIdKey, settings.deviceId!.trim());
    } else {
      await _preferences.remove(_deviceIdKey);
    }

    if (settings.userId?.trim().isNotEmpty ?? false) {
      await _preferences.setString(_userIdKey, settings.userId!.trim());
    } else {
      await _preferences.remove(_userIdKey);
    }
  }
}

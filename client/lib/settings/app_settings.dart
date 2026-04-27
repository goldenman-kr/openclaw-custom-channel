enum AppThemeMode { light, dark }

class AppSettings {
  const AppSettings({
    required this.apiUrl,
    required this.apiKey,
    required this.themeMode,
    this.deviceId,
    this.userId,
  });

  final String apiUrl;
  final String apiKey;
  final AppThemeMode themeMode;
  final String? deviceId;
  final String? userId;

  AppSettings copyWith({
    String? apiUrl,
    String? apiKey,
    AppThemeMode? themeMode,
    String? deviceId,
    String? userId,
  }) {
    return AppSettings(
      apiUrl: apiUrl ?? this.apiUrl,
      apiKey: apiKey ?? this.apiKey,
      themeMode: themeMode ?? this.themeMode,
      deviceId: deviceId ?? this.deviceId,
      userId: userId ?? this.userId,
    );
  }

  static const empty = AppSettings(
    apiUrl: '',
    apiKey: '',
    themeMode: AppThemeMode.light,
  );
}

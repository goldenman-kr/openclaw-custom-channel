import 'package:flutter_test/flutter_test.dart';

import 'package:openclaw_custom_channel_client/main.dart';
import 'package:openclaw_custom_channel_client/settings/app_settings.dart';
import 'package:openclaw_custom_channel_client/settings/settings_repository.dart';

class FakeSettingsRepository implements SettingsRepository {
  AppSettings savedSettings = AppSettings.empty;

  @override
  Future<AppSettings> load() async => savedSettings;

  @override
  Future<void> save(AppSettings settings) async {
    savedSettings = settings;
  }
}

void main() {
  testWidgets('renders chat shell', (tester) async {
    await tester.pumpWidget(
      OpenClawClientApp(settingsRepository: FakeSettingsRepository()),
    );

    expect(find.text('OpenClaw Chat'), findsOneWidget);
    expect(find.text('메시지를 입력하세요'), findsOneWidget);
    expect(find.text('Send'), findsOneWidget);
  });
}

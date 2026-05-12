# OpenClaw iOS WebView Client

Minimal SwiftUI + WKWebView wrapper for a configurable OpenClaw Web/PWA URL.

## Build on macOS

1. Open `ios-webview/OpenClawWebView.xcodeproj` in Xcode.
2. Select target `OpenClawWebView`.
3. In **Signing & Capabilities**, choose your Apple Developer Team.
4. Optionally set build settings `OPENCLAW_START_URL` and `OPENCLAW_ALLOWED_HOST` for your deployment URL.
5. Connect an iPhone and press **Run**.

## Notes

- Bundle identifier: `ai.kryp.openclaw`
- iOS deployment target: 15.0
- Uses `WKWebView` with persistent website data, so API key/settings/history cache behave like Safari/PWA storage.
- Pull-to-refresh is enabled via `UIRefreshControl`.
- Location permission text is included in `Info.plist`; browser geolocation is still requested by the web app per message.
- External links outside the configured `OPENCLAW_ALLOWED_HOST` open in the system browser/app.

import SwiftUI

struct ContentView: View {
    private var startURL: URL {
        let configured = Bundle.main.object(forInfoDictionaryKey: "OpenClawStartURL") as? String
        let value = (configured?.hasPrefix("$(") == false) ? configured : nil
        return URL(string: value ?? "http://localhost:29999/")!
    }

    var body: some View {
        WebView(url: startURL)
            .ignoresSafeArea(.keyboard, edges: .bottom)
            .background(Color(red: 21 / 255, green: 21 / 255, blue: 21 / 255))
    }
}

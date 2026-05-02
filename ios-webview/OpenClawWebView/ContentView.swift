import SwiftUI

struct ContentView: View {
    var body: some View {
        WebView(url: URL(string: "https://ai.kryp.xyz/")!)
            .ignoresSafeArea(.keyboard, edges: .bottom)
            .background(Color(red: 15 / 255, green: 23 / 255, blue: 42 / 255))
    }
}

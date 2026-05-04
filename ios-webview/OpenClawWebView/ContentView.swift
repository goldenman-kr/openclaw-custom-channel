import SwiftUI

struct ContentView: View {
    var body: some View {
        WebView(url: URL(string: "https://ai.kryp.xyz/")!)
            .ignoresSafeArea(.keyboard, edges: .bottom)
            .background(Color(red: 21 / 255, green: 21 / 255, blue: 21 / 255))
    }
}

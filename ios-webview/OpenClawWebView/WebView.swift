import SwiftUI
import WebKit

struct WebView: UIViewRepresentable {
    let url: URL

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.allowsInlineMediaPlayback = true
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        configuration.userContentController.addUserScript(Self.disableInputZoomUserScript())
        configuration.userContentController.add(context.coordinator, name: "openClawTheme")

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = true
        webView.isOpaque = false
        context.coordinator.applyTheme("dark", to: webView)
        webView.scrollView.keyboardDismissMode = .interactive
        webView.scrollView.contentInsetAdjustmentBehavior = .never

        let refreshControl = UIRefreshControl()
        refreshControl.tintColor = UIColor(white: 0.82, alpha: 1)
        refreshControl.addTarget(context.coordinator, action: #selector(Coordinator.refresh(_:)), for: .valueChanged)
        webView.scrollView.refreshControl = refreshControl
        context.coordinator.webView = webView
        context.coordinator.refreshControl = refreshControl

        webView.load(URLRequest(url: url))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}

    private static func disableInputZoomUserScript() -> WKUserScript {
        let source = """
        (() => {
          const viewport = document.querySelector('meta[name="viewport"]') || document.createElement('meta');
          viewport.setAttribute('name', 'viewport');
          viewport.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover');
          if (!viewport.parentNode) document.head.appendChild(viewport);

          const style = document.createElement('style');
          style.textContent = 'input, textarea, select { font-size: 16px !important; }';
          document.head.appendChild(style);
        })();
        """
        return WKUserScript(source: source, injectionTime: .atDocumentEnd, forMainFrameOnly: true)
    }

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
        weak var webView: WKWebView?
        weak var refreshControl: UIRefreshControl?

        func applyTheme(_ mode: String, to webView: WKWebView? = nil) {
            let light = mode == "light"
            let background = light
                ? UIColor(red: 226 / 255, green: 232 / 255, blue: 240 / 255, alpha: 1)
                : UIColor(red: 21 / 255, green: 21 / 255, blue: 21 / 255, alpha: 1)
            let tint = light ? UIColor(red: 100 / 255, green: 116 / 255, blue: 139 / 255, alpha: 1) : UIColor(white: 0.82, alpha: 1)
            let targetWebView = webView ?? self.webView
            targetWebView?.backgroundColor = background
            targetWebView?.scrollView.backgroundColor = background
            refreshControl?.tintColor = tint
        }

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.name == "openClawTheme" else { return }
            if let payload = message.body as? [String: Any], let mode = payload["mode"] as? String {
                applyTheme(mode)
            } else if let mode = message.body as? String {
                applyTheme(mode)
            }
        }

        @objc func refresh(_ sender: UIRefreshControl) {
            webView?.reload()
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            refreshControl?.endRefreshing()
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            refreshControl?.endRefreshing()
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            refreshControl?.endRefreshing()
        }

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            guard let host = navigationAction.request.url?.host else {
                decisionHandler(.allow)
                return
            }

            if host == "ai.kryp.xyz" {
                decisionHandler(.allow)
                return
            }

            if navigationAction.navigationType == .linkActivated,
               let url = navigationAction.request.url,
               UIApplication.shared.canOpenURL(url) {
                UIApplication.shared.open(url)
                decisionHandler(.cancel)
                return
            }

            decisionHandler(.allow)
        }
    }
}

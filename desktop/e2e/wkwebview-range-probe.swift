import AppKit
import Foundation
import WebKit

private let html = #"""
<!doctype html><meta charset="utf-8"><script>
(async () => {
  const result = {origin: location.origin, secure: isSecureContext};
  try {
    const response = await fetch('https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny-q5_1.bin', {
      headers: {Range: 'bytes=4-5'}
    });
    result.status = response.status;
    result.range = response.headers.get('Content-Range');
    result.bytes = (await response.arrayBuffer()).byteLength;
  } catch (error) { result.error = String(error); }
  window.webkit.messageHandlers.probe.postMessage(result);
})();
</script>
"""#

final class Scheme: NSObject, WKURLSchemeHandler {
  func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
    let body = Data(html.utf8)
    guard let url = task.request.url,
          let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "text/html; charset=utf-8"]) else {
      task.didFailWithError(NSError(domain: "probe", code: 1)); return
    }
    task.didReceive(response); task.didReceive(body); task.didFinish()
  }
  func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}

final class ResultHandler: NSObject, WKScriptMessageHandler {
  func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
    guard let result = message.body as? [String: Any],
          let serialized = try? JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]),
          let output = String(data: serialized, encoding: .utf8) else {
      fputs("INVALID RESULT\n", stderr); exit(1)
    }
    print("RESULT: \(output)"); fflush(stdout)
    let ok = result["origin"] as? String == "tauri://localhost"
      && result["status"] as? Int == 206
      && result["range"] as? String == "bytes 4-5/32152673"
      && result["bytes"] as? Int == 2
    exit(ok ? 0 : 1)
  }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
  let scheme = Scheme()
  let reporter = ResultHandler()
  var window: NSWindow?
  var view: WKWebView?

  func applicationDidFinishLaunching(_ notification: Notification) {
    let config = WKWebViewConfiguration()
    config.websiteDataStore = .nonPersistent()
    config.setURLSchemeHandler(scheme, forURLScheme: "tauri")
    config.userContentController.add(reporter, name: "probe")
    let rect = NSRect(x: 0, y: 0, width: 640, height: 480)
    let view = WKWebView(frame: rect, configuration: config)
    let window = NSWindow(contentRect: rect, styleMask: [.titled], backing: .buffered, defer: false)
    window.contentView = view
    window.makeKeyAndOrderFront(nil)
    self.window = window
    self.view = view
    view.load(URLRequest(url: URL(string: "tauri://localhost/index.html")!))
    DispatchQueue.main.asyncAfter(deadline: .now() + 35) {
      fputs("PROBE TIMEOUT\n", stderr); exit(1)
    }
  }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()

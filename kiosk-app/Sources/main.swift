import Cocoa
import WebKit

/// LaunchAgent の登録状況が「完全キオスクの ON/OFF スイッチ」を兼ねる。
///
/// - kiosk-on.sh で LaunchAgent を登録すると：次回以降このアプリはフルスクリーン・
///   Dock/メニューバー非表示・終了操作無効の「完全キオスクモード」で起動する。
/// - kiosk-off.sh で LaunchAgent を解除すると：このアプリは普通のウインドウ・
///   普通の Dock アイコン・普通の Cmd+Q が効く「通常モード」で起動する
///   （中身は同じシミュレータなので、動作確認用のプレビューとしても使える）。
///
/// つまり自動起動を入れる/切るという1つの操作だけで、次回起動時の見た目そのものが
/// 完全キオスク／通常ウインドウに切り替わる。
let kioskLabel = "jp.noriball.anorthoscope.kiosk"

func kioskLaunchAgentPlistURL() -> URL {
    FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Library/LaunchAgents/\(kioskLabel).plist")
}

/// LaunchAgent の plist が存在する＝自動起動が有効＝完全キオスクを使う、とみなす。
func isKioskEnabled() -> Bool {
    FileManager.default.fileExists(atPath: kioskLaunchAgentPlistURL().path)
}

/// LaunchAgent を launchd から外す（plist は残っていても消えていても安全に呼べる）。
func unloadLaunchAgent() {
    let task = Process()
    task.executableURL = URL(fileURLWithPath: "/bin/launchctl")
    task.arguments = ["bootout", "gui/\(getuid())/\(kioskLabel)"]
    try? task.run()
    task.waitUntilExit()
}

/// 同梱した web ビルド（Resources/site）を、file:// ではなくカスタムスキームで配信する。
///
/// file:// で type="module" スクリプトを読み込むと WebKit がブロックし、真っ黒な
/// 画面のまま JS が一切実行されない（コンソールにもエラーが出ない、静かな失敗）。
/// カスタムスキームを "本物のオリジン" として扱わせることで、Vite が出力する
/// ES モジュール・fetch() が普通の web サーバと同じように動くようにする。
final class LocalSiteSchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "anortho-kiosk"

    private lazy var siteRoot: URL? = Bundle.main.url(forResource: "site", withExtension: nil)

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url, let siteRoot else {
            urlSchemeTask.didFailWithError(URLError(.fileDoesNotExist))
            return
        }
        var relativePath = url.path
        if relativePath.isEmpty || relativePath == "/" { relativePath = "/index.html" }
        let fileURL = siteRoot.appendingPathComponent(relativePath)

        guard let data = try? Data(contentsOf: fileURL) else {
            urlSchemeTask.didFailWithError(URLError(.fileDoesNotExist))
            return
        }
        let mimeType = Self.mimeType(for: fileURL.pathExtension)
        // 普通の URLResponse だと JS 側から見た fetch/XHR の status が 0 になり、
        // アプリ側の `if (!res.ok) throw` 等が軒並み失敗扱いになる。
        // HTTPURLResponse で明示的に 200 を返すことで、本物の HTTP サーバと同じに見せる。
        let response = HTTPURLResponse(
            url: url,
            statusCode: 200,
            httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type": mimeType, "Content-Length": String(data.count)]
        )!
        urlSchemeTask.didReceive(response)
        urlSchemeTask.didReceive(data)
        urlSchemeTask.didFinish()
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {
        // ローカルファイル読み出しのみで非同期処理は無いため、特に何もしない。
    }

    private static func mimeType(for ext: String) -> String {
        switch ext.lowercased() {
        case "html": return "text/html"
        case "js", "mjs": return "text/javascript"
        case "css": return "text/css"
        case "json": return "application/json"
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "svg": return "image/svg+xml"
        case "webm": return "video/webm"
        case "ico": return "image/x-icon"
        default: return "application/octet-stream"
        }
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate, WKUIDelegate, WKNavigationDelegate {
    private var window: NSWindow!
    private var webView: WKWebView!
    private var escapeMonitor: Any?
    private var allowTermination = false
    #if STANDALONE
    // 単体版：キオスク機能は一切使わない（LaunchAgent の有無にも左右されない）
    private let kiosk = false
    private let appTitle = "Anorthoscope Simulator"
    #else
    private let kiosk = isKioskEnabled()
    private let appTitle = "Anorthoscope Kiosk (通常モード・プレビュー)"
    #endif
    private let schemeHandler = LocalSiteSchemeHandler()

    func applicationDidFinishLaunching(_ notification: Notification) {
        let screenFrame = NSScreen.main?.frame ?? NSRect(x: 0, y: 0, width: 1280, height: 800)

        if kiosk {
            window = NSWindow(
                contentRect: screenFrame,
                styleMask: [.borderless],
                backing: .buffered,
                defer: false
            )
            window.setFrame(screenFrame, display: true)
            window.level = .mainMenu + 1
            window.collectionBehavior = [.fullScreenPrimary, .stationary, .ignoresCycle]
        } else {
            let size = NSSize(width: 1280, height: 800)
            let origin = NSPoint(
                x: screenFrame.midX - size.width / 2,
                y: screenFrame.midY - size.height / 2
            )
            window = NSWindow(
                contentRect: NSRect(origin: origin, size: size),
                styleMask: [.titled, .closable, .miniaturizable, .resizable],
                backing: .buffered,
                defer: false
            )
            window.title = appTitle
            window.collectionBehavior = [.fullScreenPrimary]
            window.center()
            installNormalModeMenu()
        }
        window.backgroundColor = .black
        window.isReleasedWhenClosed = false
        window.isOpaque = true

        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(schemeHandler, forURLScheme: LocalSiteSchemeHandler.scheme)
        // WebKit には、WKURLSchemeHandler で登録したカスタムスキームに対して
        // fetch() だけが "URL is not valid or contains user credentials" で
        // 失敗する既知の制約がある（XMLHttpRequest は問題なく動く）。
        // アプリ側コードは無改造のまま使いたいので、fetch を XHR 経由の実装に
        // 差し替えるポリフィルをページの一番最初に注入する。
        let fetchPolyfill = WKUserScript(
            source: """
            (function() {
              window.fetch = function(input, init) {
                init = init || {};
                var url = (typeof input === 'string') ? input : input.url;
                var method = init.method || 'GET';
                return new Promise(function(resolve, reject) {
                  var xhr = new XMLHttpRequest();
                  xhr.open(method, url, true);
                  xhr.responseType = 'blob';
                  if (init.headers) {
                    var h = init.headers;
                    if (typeof h.forEach === 'function') {
                      h.forEach(function(v, k) { xhr.setRequestHeader(k, v); });
                    } else {
                      for (var k in h) xhr.setRequestHeader(k, h[k]);
                    }
                  }
                  xhr.onload = function() {
                    var headers = new Headers();
                    var raw = xhr.getAllResponseHeaders() || '';
                    raw.trim().split(/\\r?\\n/).forEach(function(line) {
                      var idx = line.indexOf(':');
                      if (idx > 0) headers.append(line.slice(0, idx).trim(), line.slice(idx + 1).trim());
                    });
                    resolve(new Response(xhr.response, { status: xhr.status, statusText: xhr.statusText, headers: headers }));
                  };
                  xhr.onerror = function() { reject(new TypeError('Network request failed for ' + url)); };
                  xhr.send(init.body || null);
                });
              };
            })();
            """,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        )
        config.userContentController.addUserScript(fetchPolyfill)
        webView = WKWebView(frame: window.contentView?.bounds ?? screenFrame, configuration: config)
        webView.uiDelegate = self
        webView.navigationDelegate = self
        webView.autoresizingMask = [.width, .height]
        webView.setValue(false, forKey: "drawsBackground") // 読み込み中の白フラッシュを防ぐ
        window.contentView = webView

        webView.load(URLRequest(url: URL(string: "\(LocalSiteSchemeHandler.scheme)://local/index.html")!))

        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)

        if kiosk {
            enterKioskPresentation()
            installEscapeHatch()
        }
    }

    private func enterKioskPresentation() {
        // Dock・メニューバーを隠し、Force Quit ウインドウ等も出せなくする。
        // 通常モードと違いメニューを一切作らないため、Cmd+Q は元々どこにもバインドされていない
        // （＝この時点で既に「普通の操作では終了できない」状態になっている）。
        NSApp.presentationOptions = [
            .hideDock,
            .hideMenuBar,
            .disableForceQuit,
            .disableProcessSwitching,
            .disableSessionTermination,
            .disableHideApplication,
        ]
    }

    /// 通常モード用のメニュー：終了（Cmd+Q）／ウインドウを閉じる（Cmd+W）／フルスクリーン（Ctrl+Cmd+F）。
    private func installNormalModeMenu() {
        let mainMenu = NSMenu()

        let appMenuItem = NSMenuItem()
        mainMenu.addItem(appMenuItem)
        let appMenu = NSMenu()
        appMenu.addItem(
            withTitle: "\(appTitle) を終了",
            action: #selector(NSApplication.terminate(_:)),
            keyEquivalent: "q"
        )
        appMenuItem.submenu = appMenu

        let viewMenuItem = NSMenuItem()
        mainMenu.addItem(viewMenuItem)
        let viewMenu = NSMenu(title: "表示")
        let fullScreenItem = viewMenu.addItem(
            withTitle: "フルスクリーンにする",
            action: #selector(NSWindow.toggleFullScreen(_:)),
            keyEquivalent: "f"
        )
        fullScreenItem.keyEquivalentModifierMask = [.control, .command]
        viewMenu.addItem(
            withTitle: "ウインドウを閉じる",
            action: #selector(NSWindow.performClose(_:)),
            keyEquivalent: "w"
        )
        viewMenuItem.submenu = viewMenu

        NSApp.mainMenu = mainMenu
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        !kiosk
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        if !kiosk || allowTermination { return .terminateNow }
        return .terminateCancel
    }

    /// Cmd+Option+Control+Shift+Q で、キオスクを解除しつつ終了する（メンテナンス用）。
    /// LaunchAgent の KeepAlive によって即再起動されてしまわないよう、
    /// 終了前に自動起動そのものを外す＝スイッチを OFF にしてから抜ける。
    private func installEscapeHatch() {
        let qKeyCode: UInt16 = 12 // kVK_ANSI_Q（Q キーの物理キーコード）
        // 当面は普通の Cmd+Q だけで抜けられるようにする（覚えやすさ・確実さ優先）。
        // より重い組み合わせ（Cmd+Option+Control+Shift+Q）も念のため残しておく。
        let combos: [NSEvent.ModifierFlags] = [
            [.command],
            [.command, .option, .control, .shift],
        ]
        escapeMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
            // Control が押下されていると characters/charactersIgnoringModifiers は
            // "q" ではなく制御文字（0x11 等）を返してしまい文字での判定が効かないため、
            // レイアウトに依存しない物理キーコードで判定する。
            if combos.contains(flags), event.keyCode == qKeyCode {
                self?.allowTermination = true
                unloadLaunchAgent()
                NSApp.terminate(nil)
                return nil
            }
            return event
        }
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()

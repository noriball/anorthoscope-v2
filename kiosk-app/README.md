# Anorthoscope Kiosk

Mac mini（Intel 最終世代／Apple Silicon M1 いずれも）で動くキオスク展示用の単体アプリ。

Xcode プロジェクトは使わず、Command Line Tools の `swiftc` + `lipo` だけで
Universal 2（x86_64 + arm64）バイナリを作る、依存ゼロの最小構成。
中身は `web/`（`npm run build` の出力＝`docs/`）を `WKWebView` でそのまま表示するだけ。

**ビルド済みバイナリは既に Intel/Apple Silicon 両対応なので、別の Mac にそのまま
コピーして使える**（そちらで `swiftc` や Node.js を用意する必要はない）。

## 単体アプリ版（キオスクなし）

ダブルクリックだけで動く、普通のmacOSアプリ。キオスク機能（LaunchAgent・全画面ロック）は
コンパイル時に除外してあるので、勝手に全画面になることも、抜けられなくなることもない。

```bash
./build.sh standalone     # build/AnorthoscopeSimulator.app ができる
```

- Cmd+Q で終了、Cmd+W でウインドウを閉じる、Ctrl+Cmd+F（または緑ボタン）でフルスクリーン
- 配布は `ditto -c -k --keepParent build/AnorthoscopeSimulator.app AnorthoscopeSimulator.zip`
- 初回起動で「開発元を確認できません」と出たら、右クリック→「開く」を一度行う

以下はキオスク版（`./build.sh`）の説明。

## 完全キオスクの ON/OFF は「自動起動」がそのままスイッチ

このアプリには設定画面などは無く、**自動起動が入っているかどうか**で
起動時の見た目が変わる。

| 状態 | 見た目 |
|---|---|
| 自動起動 OFF（`kiosk-off.sh` 実行後、または未設定） | 普通のウインドウ（タイトルバー・Dock アイコンあり、Cmd+Q で普通に終了） |
| 自動起動 ON（`kiosk-on.sh` 実行後） | 画面いっぱいのボーダーレス表示、Dock・メニューバー非表示、通常の終了操作は無効 |

`kiosk-on.sh` / `kiosk-off.sh` を実行するたびに、次にアプリが起動したときの
モードが切り替わる。ログイン時の自動起動そのものも、この ON/OFF と連動する
（OFF のときは自動起動しない＝手動で開いたときだけ普通のウインドウとして使える）。

## 別の Mac で使う手順

1. `AnorthoscopeKiosk-forOtherMac.zip` を対象の Mac にコピーして展開
2. ターミナルで `kiosk-app` フォルダに移動し、まずは動作確認:
   ```bash
   cd kiosk-app
   ./install.sh
   ```
   （`/Applications` にコピーするだけ。この時点ではまだ普通のウインドウで開ける）
3. 常設展示にする場合、画面を明け渡す準備ができてから:
   ```bash
   ./kiosk-on.sh
   ```
   実行した瞬間に画面が完全キオスクに切り替わる（フルスクリーン化・Dock/メニューバー非表示）。

### 初回起動時の Gatekeeper 警告について

ビルドした Mac 以外にコピーすると、ad-hoc 署名のみのため Gatekeeper が
「開発元を確認できません」と警告することがある。その場合は Finder で
`AnorthoscopeKiosk.app` を右クリック→「開く」を一度行えば、以降は普通に起動できる
（Apple Developer 証明書での正式な署名・公証をすれば、この確認自体が不要になる）。

## 構成

```
kiosk-app/
  Sources/main.swift   アプリ本体（Cocoa + WebKit、外部依存なし）
  Info.plist            アプリの Info.plist
  build.sh               ビルドスクリプト（web ビルド→Swift コンパイル→.app 組み立て→署名）
  install.sh              /Applications へコピーするだけ（自動起動はまだ入れない）
  kiosk-on.sh              完全キオスク ON（LaunchAgent 登録＋今すぐ起動）
  kiosk-off.sh             完全キオスク OFF（LaunchAgent 解除＋起動中のインスタンスを終了）
  uninstall.sh             kiosk-off した上でアプリごと削除（完全撤去）
  launchd/                 ログイン時自動起動・クラッシュ時自動再起動用の LaunchAgent plist
```

## 開発側（このリポジトリ）でのビルド

```bash
cd kiosk-app
./build.sh
```

`kiosk-app/build/AnorthoscopeKiosk.app` ができる。`web/` の最新内容を毎回自動でビルドしてから
バンドルするので、シミュレータ側を更新したら `./build.sh` を再実行すればよい。

## 完全キオスクの中身

- 画面いっぱいのボーダーレスウィンドウ（実質フルスクリーン）
- Dock・メニューバーを非表示（`NSApp.presentationOptions`）
- メニューを一切作らないため、Cmd+Q はそもそもどこにもバインドされていない
- `applicationShouldTerminate` を常に拒否するので、AppleScript 等からの `quit` も無効

**メンテナンス用の脱出ハッチ**: `Cmd + Option + Control + Shift + Q` を押すと、
自動起動そのものを OFF にした上で終了する（＝スイッチも一緒に OFF になるので、
LaunchAgent の自動再起動で即座に生き返ることはない）。再度キオスクに戻すには
`./kiosk-on.sh` を実行する。

## 常時無人展示に向けて（任意・手動設定）

- **自動ログイン**: システム設定 > ユーザとグループ でこの Mac 用アカウントの自動ログインを
  有効にすると、再起動後も人手を介さず展示が復帰する（パスワード無しでログインできる状態に
  なるため、設置場所のセキュリティ要件と要相談）。
- **ディスプレイスリープ無効化**: システム設定 > ロック画面 で「電源接続中はディスプレイを
  オフにしない」等を設定（据え置き展示機なら常時電源接続が前提）。

## 完全に取り除く

```bash
./uninstall.sh
```

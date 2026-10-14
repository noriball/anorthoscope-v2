#!/bin/bash
# 完全キオスクを ON にする（＝自動起動スイッチを入れる）。
#
# - LaunchAgent を登録する（ログイン時に自動起動／クラッシュ時に自動再起動）
# - この plist の「存在そのもの」を、アプリが起動時に読み取って
#   「完全キオスクモードで起動するか、普通のウインドウで起動するか」を判断する
#
# 注意：実行すると LaunchAgent が読み込まれてアプリが今すぐ全画面で起動し、
# Dock・メニューバーが隠れます（画面がその場で乗っ取られます）。
set -euo pipefail

APP_NAME="AnorthoscopeKiosk"
DEST_APP="/Applications/$APP_NAME.app"
LABEL="jp.noriball.anorthoscope.kiosk"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLIST_SRC="$HERE/launchd/$LABEL.plist"
PLIST_DEST="$HOME/Library/LaunchAgents/$LABEL.plist"

if [ ! -d "$DEST_APP" ]; then
  echo "先に ./install.sh を実行してください（$DEST_APP が見つかりません）" >&2
  exit 1
fi

# 起動中の通常モードのインスタンスがあれば一旦終了しておく
killall "$APP_NAME" 2>/dev/null || true

mkdir -p "$HOME/Library/LaunchAgents"
cp "$PLIST_SRC" "$PLIST_DEST"

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST_DEST"
launchctl enable "gui/$(id -u)/$LABEL"

echo "完全キオスク: ON"
echo "終了するには（メンテナンス用）: Cmd+Option+Control+Shift+Q"
echo "OFF に戻すには: ./kiosk-off.sh"

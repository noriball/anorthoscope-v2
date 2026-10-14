#!/bin/bash
# 完全キオスクを OFF にする（＝自動起動スイッチを切る）。
# LaunchAgent を解除し、起動中のキオスクインスタンスを終了する。
# アプリ自体は /Applications に残るので、そのまま普通のウインドウとして開ける。
set -euo pipefail

APP_NAME="AnorthoscopeKiosk"
LABEL="jp.noriball.anorthoscope.kiosk"
PLIST_DEST="$HOME/Library/LaunchAgents/$LABEL.plist"

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
rm -f "$PLIST_DEST"
killall "$APP_NAME" 2>/dev/null || true

echo "完全キオスク: OFF"
echo "普通のウインドウで開く: open \"/Applications/$APP_NAME.app\""
echo "再度 ON にするには: ./kiosk-on.sh"

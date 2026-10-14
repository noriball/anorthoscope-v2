#!/bin/bash
# 完全キオスクを OFF にした上で、/Applications からアプリごと削除する（完全撤去）。
# 自動起動だけ止めて中身は残したい場合は uninstall.sh ではなく ./kiosk-off.sh を使う。
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_NAME="AnorthoscopeKiosk"
DEST_APP="/Applications/$APP_NAME.app"

"$HERE/kiosk-off.sh"

echo "== /Applications から削除 =="
rm -rf "$DEST_APP"

echo "アンインストール完了。"

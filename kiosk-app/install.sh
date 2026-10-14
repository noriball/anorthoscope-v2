#!/bin/bash
# AnorthoscopeKiosk.app を /Applications にコピーするだけのセットアップ。
# この時点ではまだ自動起動は入れない（＝完全キオスクはまだ ON にならない）。
# 有効にするときは ./kiosk-on.sh を実行する。
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_NAME="AnorthoscopeKiosk"
SRC_APP="$HERE/build/$APP_NAME.app"
DEST_APP="/Applications/$APP_NAME.app"

if [ ! -d "$SRC_APP" ]; then
  echo "先に ./build.sh を実行してください（$SRC_APP が見つかりません）" >&2
  exit 1
fi

echo "== /Applications へコピー =="
rm -rf "$DEST_APP"
cp -R "$SRC_APP" "$DEST_APP"

echo
echo "インストール完了：$DEST_APP"
echo "・普通のウインドウで試す:   open \"$DEST_APP\""
echo "・完全キオスクを有効にする: ./kiosk-on.sh"

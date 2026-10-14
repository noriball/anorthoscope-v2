#!/bin/bash
# Anorthoscope のアプリをビルドする。
#   ./build.sh              キオスク版（AnorthoscopeKiosk.app。kiosk-on.sh で完全キオスクに切替可能）
#   ./build.sh standalone   単体版（AnorthoscopeSimulator.app。キオスク機能なしの普通のアプリ）
# Xcode プロジェクトを使わず、Command Line Tools の swiftc + lipo だけで
# Intel(x86_64) / Apple Silicon(arm64) 両対応の Universal 2 バイナリを作る。
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
WEB_DIR="$ROOT/web"
DOCS_DIR="$ROOT/docs"
BUILD_DIR="$HERE/build"
VARIANT="${1:-kiosk}"
SWIFT_FLAGS=()
if [ "$VARIANT" = "standalone" ]; then
  APP_NAME="AnorthoscopeSimulator"
  DISPLAY_NAME="Anorthoscope Simulator"
  BUNDLE_ID="jp.noriball.anorthoscope.simulator"
  SWIFT_FLAGS=(-D STANDALONE)
elif [ "$VARIANT" = "kiosk" ]; then
  APP_NAME="AnorthoscopeKiosk"
  DISPLAY_NAME="Anorthoscope Kiosk"
  BUNDLE_ID="jp.noriball.anorthoscope.kiosk"
else
  echo "使い方: ./build.sh [kiosk|standalone]" >&2
  exit 1
fi
APP_DIR="$BUILD_DIR/$APP_NAME.app"
MIN_MACOS="11.0"

echo "== 1/5: Web アプリをビルド =="
(cd "$WEB_DIR" && npm run build)

echo "== 2/5: Swift を x86_64 / arm64 それぞれでコンパイル =="
# もう一方のバリアントのビルド結果は消さない（自分のアプリだけ作り直す）
rm -rf "$APP_DIR" "$BUILD_DIR/$APP_NAME"
mkdir -p "$BUILD_DIR"
swiftc -O ${SWIFT_FLAGS[@]+"${SWIFT_FLAGS[@]}"} -target "x86_64-apple-macosx${MIN_MACOS}" "$HERE/Sources/main.swift" -o "$BUILD_DIR/$APP_NAME-x86_64"
swiftc -O ${SWIFT_FLAGS[@]+"${SWIFT_FLAGS[@]}"} -target "arm64-apple-macosx${MIN_MACOS}" "$HERE/Sources/main.swift" -o "$BUILD_DIR/$APP_NAME-arm64"

echo "== 3/5: lipo で Universal バイナリに結合 =="
lipo -create "$BUILD_DIR/$APP_NAME-x86_64" "$BUILD_DIR/$APP_NAME-arm64" -output "$BUILD_DIR/$APP_NAME"
rm "$BUILD_DIR/$APP_NAME-x86_64" "$BUILD_DIR/$APP_NAME-arm64"
lipo -info "$BUILD_DIR/$APP_NAME"

echo "== 4/5: .app バンドルを組み立て =="
mkdir -p "$APP_DIR/Contents/MacOS" "$APP_DIR/Contents/Resources/site"
cp "$BUILD_DIR/$APP_NAME" "$APP_DIR/Contents/MacOS/$APP_NAME"
sed -e "s|<string>AnorthoscopeKiosk</string>|<string>$APP_NAME</string>|g" \
    -e "s|<string>Anorthoscope Kiosk</string>|<string>$DISPLAY_NAME</string>|g" \
    -e "s|<string>jp.noriball.anorthoscope.kiosk</string>|<string>$BUNDLE_ID</string>|g" \
    "$HERE/Info.plist" > "$APP_DIR/Contents/Info.plist"
printf 'APPL????' > "$APP_DIR/Contents/PkgInfo"
# docs/ の中身（index.html・assets・data・presets）をそのままリソースへ
cp -R "$DOCS_DIR/." "$APP_DIR/Contents/Resources/site/"
find "$APP_DIR/Contents/Resources/site" -name ".DS_Store" -delete

echo "== 5/5: ad-hoc 署名 =="
codesign --force --deep --sign - "$APP_DIR"

echo
echo "ビルド完了: $APP_DIR"
echo "確認: file \"$APP_DIR/Contents/MacOS/$APP_NAME\""
file "$APP_DIR/Contents/MacOS/$APP_NAME"

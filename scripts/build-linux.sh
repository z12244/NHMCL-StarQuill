#!/usr/bin/env bash
# Build on Ubuntu 24.04 amd64 with unzip, curl, python3, xz, gcc, wmctrl and OpenJDK 21.
set -euo pipefail
cd "$(dirname "$0")/.."
[[ $(dpkg --print-architecture) == amd64 ]]
mkdir -p build dist
archive=${NHMCL_BASE_ASAR:-build/stable-1.0.3.asar}
echo "74aa2dff74cb7735dfa5f368037f2d5c5b9638571d9560d967915b8d42b2ca23  $archive" | sha256sum --check --status || { echo '需要原版 stable-1.0.3 的 resources/app.asar' >&2; exit 1; }
electron=build/electron.zip
url=${ELECTRON_DOWNLOAD_URL:-https://github.com/electron/electron/releases/download/v45.2.2/electron-v45.2.2-linux-x64.zip}
if [[ ! -f $electron ]]; then curl -fL --retry 3 "$url" -o "$electron.part"; mv "$electron.part" "$electron"; fi
echo "b5d3e7e5a80faeb194e741f85c667951490ba8052b655566d47dacb20f9868f9  $electron" | sha256sum --check --status
stage=$(mktemp -d "$PWD/build/portable.XXXXXXXX")
trap 'rm -rf -- "$stage"' EXIT
app="$stage/app"
mkdir -p "$app"
unzip -q "$electron" -d "$app"
mv "$app/electron" "$app/nhmcl-starquill"
mv "$app/chrome-sandbox" "$app/resources/chrome-sandbox.bin"
rm -f "$app/resources/default_app.asar"
dest="$app/resources/app"
mkdir -p "$dest" "$app/resources/tools"
cp -- *.cjs *.css *.html THIRD-PARTY-NOTICES.txt "$dest/"
cp -r assets "$dest/"
cp tools/*.jar tools/*.zip tools/*.txt tools/game-window-ready.sh "$app/resources/tools/"
chmod 755 "$app/resources/tools/game-window-ready.sh"
python3 scripts/linux-release-resources.py "$archive" "$dest"
jdk=${JAVA_HOME:-/usr/lib/jvm/java-21-openjdk-amd64}
grep -Eq '^JAVA_VERSION="21([."]|$)' "$jdk/release"
"$jdk/bin/jlink" --module-path "$jdk/jmods" --add-modules ALL-MODULE-PATH --strip-debug --no-header-files --no-man-pages --output "$app/resources/runtime"
cp /usr/share/doc/openjdk-21-jre-headless/copyright "$app/resources/runtime/UBUNTU-COPYRIGHT"
"$app/resources/runtime/bin/java" -version
install -m755 /usr/bin/wmctrl "$app/resources/tools/wmctrl"
cp /usr/share/doc/wmctrl/copyright "$app/resources/tools/WMCTRL-COPYRIGHT"
tar -C "$app" -c . | xz -T2 -4 > "$stage/payload.xz"
digest=$(sha256sum "$stage/payload.xz" | cut -d' ' -f1)
size=$(stat -c %s "$stage/payload.xz")
python3 - "$stage/portable.h" <<'PY'
import json, pathlib, sys
script = pathlib.Path("scripts/linux-portable.sh").read_text()
pathlib.Path(sys.argv[1]).write_text("static const char startup[] = " + json.dumps(script,ensure_ascii=False) + ";\n")
PY
cc -Os -Wall -Wextra -Werror -s -I "$stage" -DPAYLOAD_SIZE="\"$size\"" -DPAYLOAD_SHA256="\"$digest\"" scripts/portable-linux.c -o "$stage/stable-1.0.3-linux"
cat "$stage/payload.xz" >> "$stage/stable-1.0.3-linux"
mv "$stage/stable-1.0.3-linux" dist/

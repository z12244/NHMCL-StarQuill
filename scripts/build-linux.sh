#!/usr/bin/env bash
# Build on Ubuntu 24.04 amd64 with unzip, curl, python3, xz, gcc, wmctrl and OpenJDK 21.
set -euo pipefail
cd "$(dirname "$0")/.."
[[ $(dpkg --print-architecture) == amd64 ]]
mkdir -p build dist
release=stable-1.0.4
display=v1.0.4
archive=${NHMCL_BASE_ASAR:-build/$release.asar}
if [[ ! -f $archive && -f dist/win-unpacked/resources/app.asar ]]; then
    mkdir -p "$(dirname "$archive")"
    cp dist/win-unpacked/resources/app.asar "$archive"
    echo "已从 dist/win-unpacked/resources/app.asar 复制基线到 $archive"
fi
if [[ ! -f $archive ]]; then
    echo "缺少基线 $archive" >&2
    echo "请先运行 Windows 构建（npm run dist:win）生成 dist/win-unpacked/resources/app.asar，或从 Release 附件复制为 $archive。详见 docs/BUILD.md" >&2
    exit 1
fi
actual=$(sha256sum "$archive" | cut -d' ' -f1)
if [[ -n ${NHMCL_BASE_ASAR_SHA256-} ]]; then
    # Release builds pin the exact baseline; pass the hash printed by the Windows build.
    [[ $actual == "$NHMCL_BASE_ASAR_SHA256" ]] || { echo "基线 SHA-256 不匹配：$archive（期望 $NHMCL_BASE_ASAR_SHA256，实际 $actual）" >&2; exit 1; }
else
    echo "基线 asar SHA-256：$actual（发布时可用 NHMCL_BASE_ASAR_SHA256=$actual 固定）"
    grep -aq '"main": "src/main/main.cjs"' "$archive" || { echo "基线不是星翎启动器的 app.asar：$archive" >&2; exit 1; }
    grep -aq '"displayVersion": "'"$display"'"' "$archive" || { echo "基线版本不是 $display：$archive" >&2; exit 1; }
fi
electron=build/electron.zip
url=${ELECTRON_DOWNLOAD_URL:-https://npmmirror.com/mirrors/electron/45.2.2/electron-v45.2.2-linux-x64.zip}
if [[ ! -f $electron ]]; then
    curl -fL --retry 3 "$url" -o "$electron.part" || curl -fL --retry 3 \
        "https://github.com/electron/electron/releases/download/v45.2.2/electron-v45.2.2-linux-x64.zip" -o "$electron.part"
    mv "$electron.part" "$electron"
fi
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
mkdir -p "$dest/src" "$app/resources/tools"
cp -r src/. "$dest/src/"
cp THIRD-PARTY-NOTICES.txt "$dest/"
for f in tools/*.jar tools/*.zip tools/*.txt; do
  case "$(basename "$f")" in
    m2sfix-agent-1.0.0.jar|M2SFIX-LICENSE.txt) continue ;;
  esac
  cp "$f" "$app/resources/tools/"
done
cp tools/game-window-ready.sh "$app/resources/tools/"
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
cc -Os -Wall -Wextra -Werror -s -I "$stage" -DPAYLOAD_SIZE="\"$size\"" -DPAYLOAD_SHA256="\"$digest\"" scripts/portable-linux.c -o "$stage/$release-linux"
cat "$stage/payload.xz" >> "$stage/$release-linux"
mv "$stage/$release-linux" dist/

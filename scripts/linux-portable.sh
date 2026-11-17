set -euo pipefail
size=$1
digest=$2
shift 2
umask 077
cache="${XDG_CACHE_HOME:-$HOME/.cache}/NHMCL-StarQuill/$digest"
mkdir -p "$(dirname "$cache")"
exec 9>"$cache.lock"
flock 9
if [[ ! -x "$cache/nhmcl-starquill" ]]; then
    stage=$(mktemp -d "$cache.tmp.XXXXXXXX")
    trap 'rm -rf -- "$stage"' EXIT
    tail -c "$size" "$0" > "$stage/payload.xz"
    echo "$digest  $stage/payload.xz" | sha256sum --check --status
    mkdir "$stage/files"
    tar -xJf "$stage/payload.xz" --no-same-owner -C "$stage/files"
    mv -T "$stage/files" "$cache"
    rm -rf -- "$stage"
    trap - EXIT
fi
exec 9>&-
export PORTABLE_EXECUTABLE_DIR
PORTABLE_EXECUTABLE_DIR=$(dirname -- "$0")
if ! unshare -Ur true >/dev/null 2>&1; then
    helper=/usr/local/lib/nhmcl-starquill/electron-45.2.2-sandbox
    expected=f16e2562837856845cfc8ebf4aa7f78b57fdadc6b69130509b1db87ce5d2f869
    if [[ $(stat -Lc '%u:%a' "$helper" 2>/dev/null || true) != 0:4755 ]] ||
       ! echo "$expected  $helper" | sha256sum --check --status; then
        # Install only the verified upstream helper; the launcher stays unprivileged.
        elevate=(pkexec)
        if command -v sudo >/dev/null && sudo -n true 2>/dev/null; then elevate=(sudo -n); fi
        "${elevate[@]}" /bin/sh -c '
            set -eu
            dest=/usr/local/lib/nhmcl-starquill
            install -d -m 755 "$dest"
            tmp=$(mktemp "$dest/.sandbox.XXXXXXXX")
            trap '\''rm -f -- "$tmp"'\'' EXIT
            cat -- "$1" > "$tmp"
            echo "$2  $tmp" | sha256sum --check --status
            chmod 4755 "$tmp"
            mv -fT -- "$tmp" "$dest/electron-45.2.2-sandbox"
        ' nhmcl "$cache/resources/chrome-sandbox.bin" "$expected"
    fi
    export CHROME_DEVEL_SANDBOX="$helper"
fi
exec "$cache/nhmcl-starquill" "$@"

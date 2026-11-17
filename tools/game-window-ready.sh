#!/bin/sh
# Minecraft's LWJGL X11 window publishes _NET_WM_PID, including under XWayland.
wmctrl=$(dirname "$0")/wmctrl
[ -x "$wmctrl" ] || wmctrl=wmctrl
while kill -0 "$1" 2>/dev/null && kill -0 "$2" 2>/dev/null; do
    if "$wmctrl" -lp 2>/dev/null | awk -v pid="$1" '$3 == pid {found=1} END {exit !found}'; then
        exit 0
    fi
    sleep 0.5
done
exit 1

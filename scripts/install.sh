#!/bin/sh
# Quiro installer for macOS and Linux.
#   curl -fsSL https://raw.githubusercontent.com/Nweremizu/quiro/main/scripts/install.sh | sh
set -e

REPO="Nweremizu/quiro"
BASE="https://github.com/$REPO/releases/latest/download"

os="$(uname -s)"
arch="$(uname -m)"

case "$os" in
  Darwin)
    case "$arch" in
      arm64) a="arm64" ;;
      x86_64) a="x64" ;;
      *) echo "Unsupported macOS arch: $arch" >&2; exit 1 ;;
    esac
    tmp="$(mktemp -d)"
    echo "Downloading Quiro ($a)..."
    curl -fSL "$BASE/Quiro-$a.zip" -o "$tmp/Quiro.zip"
    echo "Installing to /Applications..."
    rm -rf "/Applications/Quiro.app"
    unzip -q "$tmp/Quiro.zip" -d /Applications
    rm -rf "$tmp"
    echo "Opening Quiro..."
    open -a Quiro
    ;;
  Linux)
    [ "$arch" = "x86_64" ] || { echo "Unsupported Linux arch: $arch (only x64 is built)" >&2; exit 1; }
    dir="$HOME/.local/bin"
    mkdir -p "$dir"
    echo "Downloading Quiro..."
    curl -fSL "$BASE/Quiro-linux-x64.AppImage" -o "$dir/Quiro.AppImage"
    chmod +x "$dir/Quiro.AppImage"
    echo "Opening Quiro..."
    "$dir/Quiro.AppImage" >/dev/null 2>&1 &
    case ":$PATH:" in *":$dir:"*) ;; *) echo "Note: add $dir to your PATH to run it as 'Quiro.AppImage'." ;; esac
    ;;
  *)
    echo "Unsupported OS: $os" >&2; exit 1 ;;
esac

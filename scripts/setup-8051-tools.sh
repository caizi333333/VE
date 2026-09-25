#!/usr/bin/env bash
set -euo pipefail

# Build AS31 locally from a pinned upstream revision; no third-party binary is vendored.
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$ROOT/tmp"
BUILD="$(mktemp -d "$ROOT/tmp/as31-build-XXXXXX")"
PIN="53f1a78a1f262a67e1a388c20ec7e8357ac30eaa"
git clone --quiet https://github.com/ve3wwg/as31.git "$BUILD"
git -C "$BUILD" checkout --quiet "$PIN"
python3 - "$BUILD/parser.y" <<'PY'
from pathlib import Path
import sys
path = Path(sys.argv[1])
source = path.read_text()
old = '#define bit(a)\t( 1 << ((a)%(sizeof(long)*8)) )'
new = '#define bit(a)\t( 1UL << ((a)%(sizeof(long)*8)) )'
if source.count(old) != 1:
    raise SystemExit('AS31 source layout changed; stop before building')
path.write_text(source.replace(old, new))
PY
make -C "$BUILD" as31
mkdir -p "$HOME/.local/bin"
install -m 755 "$BUILD/as31" "$HOME/.local/bin/ve-as31"
printf 'AS31 installed: %s\n' "$HOME/.local/bin/ve-as31"
if ! command -v s51 >/dev/null 2>&1; then
  printf 's51 missing: install SDCC (macOS Homebrew: brew install sdcc).\n' >&2
  exit 1
fi
printf 's51 found: %s\n' "$(command -v s51)"

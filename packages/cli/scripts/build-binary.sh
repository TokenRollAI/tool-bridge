#!/bin/sh
set -eu

tb_package_dir=$(CDPATH='' cd -- "$(dirname "$0")/.." && pwd)
tb_build_dir=$(mktemp -d "${TMPDIR:-/tmp}/tb-cli-build.XXXXXX")

cleanup() {
  rm -rf -- "$tb_build_dir"
}
trap cleanup EXIT HUP INT TERM

if [ ! -f "$tb_package_dir/dist/index.js" ]; then
  echo "dist/index.js is missing; run the package build before build:binary" >&2
  exit 1
fi

mkdir -p "$tb_package_dir/binary"
cd "$tb_build_dir"
bun build "$tb_package_dir/dist/index.js" \
  --compile \
  --minify \
  --outfile "$tb_package_dir/binary/tb"

#!/bin/sh
# Starts the Oasis (macOS, Linux). The same as: node scripts/oasis.mjs start
# Not yet run on a Mac by its authors.
cd "$(dirname "$0")" || exit 1
exec node scripts/oasis.mjs start "$@"

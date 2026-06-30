#!/bin/sh
cd /root/.picoclaw/workspace/Na-api
# Remove npm rename temp directories
rm -rf node_modules/.chalk-* node_modules/.supports-color-* node_modules/.has-flag-* 2>/dev/null
# Also remove any other .*-* temp dirs from npm
find node_modules -maxdepth 1 -name '.*-*' -type d 2>/dev/null | while read d; do rm -rf "$d"; done
# Remove existing axios dirs if any
rm -rf node_modules/axios node_modules/axios-cookiejar-support 2>/dev/null
echo "Cleanup done"

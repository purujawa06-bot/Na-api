#!/bin/sh
cd /root/.picoclaw/workspace/Na-api/node_modules || exit 1
for d in .*/; do
    case "$d" in
        "."|"../"|".bin/"|".package-lock.json") continue ;;
        *) rm -r "$d" 2>/dev/null ;;
    esac
done
echo "Cleanup done"

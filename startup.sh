#!/bin/sh
set -eu
cd /workspace
node scripts/preview.mjs stop || true
if ! curl -sf -o /dev/null --max-time 2 http://127.0.0.1:8090/api/panel; then
  mkdir -p java/out java/data
  javac --release 17 -d java/out java/src/*.java
  java -cp java/out ServoServer >>/tmp/servo-java.log 2>&1 &
  i=0
  while [ "$i" -lt 40 ]; do
    if curl -sf -o /dev/null --max-time 1 http://127.0.0.1:8090/api/panel; then
      break
    fi
    i=$((i + 1))
    sleep 0.25
  done
fi
if curl -sf -o /dev/null --max-time 2 http://127.0.0.1:8080/; then
  exit 0
fi
npm run dev >>/tmp/app-startup.log 2>&1 &

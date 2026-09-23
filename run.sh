#!/usr/bin/env bash
# Local static server launcher for macOS/Linux (Windows users: double-click run.bat instead).
cd "$(dirname "$0")"

PORT=8000
URL="http://localhost:$PORT"

open_browser() {
  sleep 1
  if command -v open >/dev/null 2>&1; then open "$URL"        # macOS
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL"  # Linux
  else echo "Open $URL in your browser."
  fi
}

if command -v python3 >/dev/null 2>&1; then
  echo "Starting local server with Python 3 on $URL ..."
  open_browser &
  python3 -m http.server $PORT
elif command -v python >/dev/null 2>&1; then
  echo "Starting local server with Python on $URL ..."
  open_browser &
  python -m http.server $PORT
elif command -v npx >/dev/null 2>&1; then
  echo "Python not found, using Node.js (npx serve) ..."
  open_browser &
  npx --yes serve -l $PORT .
else
  echo "Neither Python nor Node.js was found on this machine."
  echo "Install Python (https://www.python.org/downloads/) and run this script again,"
  echo "or open this folder with any other local static file server."
  exit 1
fi

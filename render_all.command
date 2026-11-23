#!/bin/sh
set -eu
cd "$(dirname "$0")"
python3 pipeline.py render
printf '\nFinished. Run: python3 pipeline.py preview\n'


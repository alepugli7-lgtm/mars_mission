#!/bin/bash
cd -- "$(dirname -- "$0")"
python3 -m pip install -r requirements.txt || exit 1
python3 server.py

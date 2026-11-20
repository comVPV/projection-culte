#!/bin/bash
cd "$(dirname "$0")"
export CULTE_LOOP=1
while true; do
  node server.js
  [ $? -eq 42 ] || break
done

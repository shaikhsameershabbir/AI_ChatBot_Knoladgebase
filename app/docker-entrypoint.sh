#!/bin/sh
set -e
node scripts/wait-qdrant.js
node scripts/ingest.js
exec node src/app.js

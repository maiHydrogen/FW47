# bench/

Load and failure tests for the streaming pipeline (plan step A9): `load_test.py` replays a 2025 race at
50 Hz and records ingest rate, consumer lag and latency percentiles. Results are written here with the
commit hash and the machine they ran on.

`incidents.py` (A5): raw rule hits vs incidents for replayed races, scored in one process without Redis.

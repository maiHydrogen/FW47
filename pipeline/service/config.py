"""Service settings, read from the environment so docker-compose can set them."""

import os
import socket
from dataclasses import dataclass, field


def _env(name, default, cast=str):
    v = os.environ.get(name)
    return default if v in (None, "") else cast(v)


@dataclass(frozen=True)
class Config:
    redis_url: str = field(default_factory=lambda: _env("REDIS_URL", "redis://localhost:6379/0"))
    telemetry_stream: str = field(default_factory=lambda: _env("FW47_TELEMETRY_STREAM", "fw47:telemetry"))
    laps_stream: str = field(default_factory=lambda: _env("FW47_LAPS_STREAM", "fw47:laps"))
    deviation_stream: str = field(default_factory=lambda: _env("FW47_DEVIATION_STREAM", "fw47:deviations"))
    # Telemetry older than this (wall clock) is trimmed from the stream: stale telemetry is worthless.
    retention_s: float = field(default_factory=lambda: _env("FW47_RETENTION_S", 60.0, float))
    laps_maxlen: int = field(default_factory=lambda: _env("FW47_LAPS_MAXLEN", 10_000, int))
    scorer_group: str = field(default_factory=lambda: _env("FW47_SCORER_GROUP", "scorers"))
    # Stable per instance, so a restarted scorer finds its own unacknowledged entries.
    consumer: str = field(default_factory=lambda: _env("FW47_CONSUMER", socket.gethostname()))
    # Entries another consumer has held this long are taken over at start-up (XAUTOCLAIM).
    claim_idle_ms: int = field(default_factory=lambda: _env("FW47_CLAIM_IDLE_MS", 10_000, int))
    # Replayer
    data_dir: str = field(default_factory=lambda: _env("FW47_DATA_DIR", "data"))
    season: int = field(default_factory=lambda: _env("FW47_SEASON", 2024, int))
    session_key: int = field(default_factory=lambda: _env("FW47_SESSION_KEY", 9472, int))   # Sakhir 2024
    speed: float | None = field(default_factory=lambda: _env("FW47_SPEED", 1.0, lambda v: float(v) or None))

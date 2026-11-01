"""Service settings, read from the environment so docker-compose can set them."""

import os
import socket
from dataclasses import dataclass, field
from pathlib import Path


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
    deviations_maxlen: int = field(default_factory=lambda: _env("FW47_DEVIATIONS_MAXLEN", 100_000, int))
    # Scorer: B4's exported baselines and detector settings (pipeline/baselines in the repo and the image)
    baseline_dir: str = field(default_factory=lambda: _env(
        "FW47_BASELINE_DIR", str(Path(__file__).resolve().parents[1] / "baselines")))
    latency_out: str = field(default_factory=lambda: _env("FW47_LATENCY_OUT", ""))
    # Aggregator: groups deviations into incidents (A5); see service.incidents
    aggregator_group: str = field(default_factory=lambda: _env("FW47_AGGREGATOR_GROUP", "aggregators"))
    incident_types: tuple = field(default_factory=lambda: _env(
        "FW47_INCIDENT_TYPES", ("engine-stall", "gearbox-failure", "drs-failure"), lambda v: tuple(v.split(","))))
    incident_cooldown_s: float = field(default_factory=lambda: _env("FW47_INCIDENT_COOLDOWN_S", 60.0, float))
    outbox_stream: str = field(default_factory=lambda: _env("FW47_OUTBOX_STREAM", "fw47:outbox"))
    outbox_maxlen: int = field(default_factory=lambda: _env("FW47_OUTBOX_MAXLEN", 100_000, int))
    # Delivery to the Forge webtrigger; with no URL, events wait in the outbox
    delivery_group: str = field(default_factory=lambda: _env("FW47_DELIVERY_GROUP", "delivery"))
    dlq_stream: str = field(default_factory=lambda: _env("FW47_DLQ_STREAM", "fw47:dlq"))
    webhook_url: str = field(default_factory=lambda: _env("FW47_WEBHOOK_URL", ""))
    webhook_secret: str = field(default_factory=lambda: _env("FW47_WEBHOOK_SECRET", ""))
    delivery_max_attempts: int = field(default_factory=lambda: _env("FW47_DELIVERY_MAX_ATTEMPTS", 6, int))
    # /metrics and /healthz (A7)
    metrics_port: int = field(default_factory=lambda: _env("FW47_METRICS_PORT", 9100, int))
    # Replayer
    data_dir: str = field(default_factory=lambda: _env("FW47_DATA_DIR", "data"))
    season: int = field(default_factory=lambda: _env("FW47_SEASON", 2024, int))
    session_key: int = field(default_factory=lambda: _env("FW47_SESSION_KEY", 9472, int))   # Sakhir 2024
    speed: float | None = field(default_factory=lambda: _env("FW47_SPEED", 1.0, lambda v: float(v) or None))

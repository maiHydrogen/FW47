"""Service settings, read from the environment so docker-compose can set them."""

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Config:
    redis_url: str = os.environ.get("REDIS_URL", "redis://localhost:6379/0")
    telemetry_stream: str = os.environ.get("FW47_TELEMETRY_STREAM", "fw47:telemetry")
    deviation_stream: str = os.environ.get("FW47_DEVIATION_STREAM", "fw47:deviations")

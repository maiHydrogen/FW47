"""Entry point: `python -m service {replayer,scorer,aggregator}`.

A1 skeleton: each role only connects to Redis, says it's ready and waits. The real loops are built in
A2-A3 (replayer), A4 (scorer) and A5 (aggregator); until then this checks the container wiring only.
"""

import argparse
import logging
import signal
import time

import redis

from service.config import Config

ROLES = {"replayer": "A2-A3", "scorer": "A4", "aggregator": "A5"}
log = logging.getLogger("fw47")


def connect(url, attempts=30):
    """Redis client, retrying while the server starts up."""
    client = redis.Redis.from_url(url)
    for i in range(attempts):
        try:
            client.ping()
            return client
        except redis.ConnectionError:
            if i == attempts - 1:
                raise
            time.sleep(1)


def main():
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("role", choices=ROLES)
    args = p.parse_args()
    logging.basicConfig(level=logging.INFO, format=f"%(asctime)s {args.role} %(levelname)s %(message)s")
    cfg = Config()
    client = connect(cfg.redis_url)
    log.info("connected to %s (redis %s); skeleton only, the loop is built in %s",
             cfg.redis_url, client.info("server")["redis_version"], ROLES[args.role])
    stop = []
    signal.signal(signal.SIGTERM, lambda *_: stop.append(True))
    while not stop:
        time.sleep(1)
    log.info("stopped")


if __name__ == "__main__":
    main()

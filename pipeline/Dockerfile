FROM python:3.14-slim
WORKDIR /app
COPY pyproject.toml ./
COPY fw47_core ./fw47_core
COPY service ./service
RUN pip install --no-cache-dir .
COPY baselines ./baselines
USER nobody
CMD ["python", "-m", "service", "scorer"]

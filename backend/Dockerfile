# ─── Stage 1: Builder ───────────────────────────────────────────────────────
# Use slim Python image to keep layers small. Avoid alpine — OR-Tools has
# C-extensions that need glibc (musl on alpine causes complex issues).
FROM python:3.12-slim AS builder

# System build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

COPY requirements.txt .

# Install into a prefix directory so we can COPY just site-packages to runtime
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt


# ─── Stage 2: Runtime ───────────────────────────────────────────────────────
FROM python:3.12-slim AS runtime

# Non-root user for security
RUN groupadd -r appgroup && useradd -r -g appgroup appuser

# Pull installed packages from builder stage
COPY --from=builder /install /usr/local

WORKDIR /app

# Copy application code
COPY models.py solver.py main.py ./

# Ensure Python output isn't buffered (critical for Cloud Logging to work)
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# Switch to non-root user
USER appuser

# Cloud Run delivers traffic on port 8080
EXPOSE 8080

# Start Uvicorn — single worker per container, Cloud Run scales horizontally
CMD ["uvicorn", "main:app", \
     "--host", "0.0.0.0", \
     "--port", "8080", \
     "--workers", "1", \
     "--log-level", "info"]

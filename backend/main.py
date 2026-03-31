"""
main.py — FastAPI Application
==============================

Single entry point for the Route Optimization API.

Endpoints:
  GET  /health   → health check (used by Cloud Run readiness probe)
  POST /optimize → accepts geocoded waypoints, returns optimised route

CORS is configured to allow the Firebase Hosting domain and localhost for dev.
Each request is fully stateless — no shared mutable state between requests.
"""
from __future__ import annotations

import logging
import os

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from models import ErrorResponse, OptimizeRequest, OptimizeResponse
from solver import solve

# ─────────────────────────────────────────────────────────────────────────────
# Logging
# ─────────────────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s — %(message)s",
)
logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────────────────────────────────────
# App
# ─────────────────────────────────────────────────────────────────────────────
app = FastAPI(
    title="Route Optimizer API",
    description=(
        "Bulk-address route optimization powered by Google OR-Tools "
        "and the Google Routes API."
    ),
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

# ─────────────────────────────────────────────────────────────────────────────
# CORS
# ─────────────────────────────────────────────────────────────────────────────
ALLOWED_ORIGINS = [
    "https://mapsapp-route-optimizer-8fe77.web.app",
    "https://mapsapp-route-optimizer-8fe77.firebaseapp.com",
    "http://localhost:5000",   # firebase serve
    "http://localhost:8080",   # local dev
    "http://127.0.0.1:5000",
    "http://127.0.0.1:8080",
]

# Allow additional origins via env var (useful for custom domains)
_extra = os.getenv("EXTRA_ALLOWED_ORIGINS", "")
if _extra:
    ALLOWED_ORIGINS.extend(o.strip() for o in _extra.split(",") if o.strip())

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "Authorization"],
)


# ─────────────────────────────────────────────────────────────────────────────
# Exception handler
# ─────────────────────────────────────────────────────────────────────────────
@app.exception_handler(Exception)
async def generic_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.exception("Unhandled exception: %s", exc)
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error. Please try again."},
    )


# ─────────────────────────────────────────────────────────────────────────────
# Routes
# ─────────────────────────────────────────────────────────────────────────────
@app.get("/health", tags=["ops"])
async def health_check() -> dict:
    """Liveness / readiness probe for Cloud Run."""
    return {"status": "ok"}


@app.post(
    "/optimize",
    response_model=OptimizeResponse,
    responses={400: {"model": ErrorResponse}, 500: {"model": ErrorResponse}},
    tags=["routing"],
)
async def optimize_route(request: OptimizeRequest) -> OptimizeResponse:
    """
    Accepts a list of geocoded waypoints and optional start/end locations.
    Returns the OR-Tools optimised visit order plus a Google Maps navigation URL.

    **Notes:**
    - Maximum 25 waypoints (Routes API matrix limit).
    - The solver runs for `time_limit_seconds` (default 5 s) before returning
      the best solution found so far.
    - Each call is fully stateless — safe for concurrent Cloud Run requests.
    """
    logger.info(
        "Optimize request: %d waypoints, start=%s, end=%s",
        len(request.waypoints),
        bool(request.start),
        bool(request.end),
    )
    try:
        result = await solve(request)
        logger.info(
            "Optimized: %d stops, %d m, %d s",
            len(result.ordered_route),
            result.total_distance_m,
            result.total_duration_s,
        )
        return result
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

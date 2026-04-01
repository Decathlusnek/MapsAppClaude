"""
Pydantic data models for the Route Optimization API.
All input/output is strictly validated through these models.
"""
from __future__ import annotations

from typing import Optional
from pydantic import BaseModel, Field, field_validator


class Location(BaseModel):
    """A geocoded geographic coordinate."""
    lat: float = Field(..., ge=-90, le=90, description="Latitude in decimal degrees")
    lng: float = Field(..., ge=-180, le=180, description="Longitude in decimal degrees")
    address: Optional[str] = Field(None, description="Human-readable address label")


class OptimizeRequest(BaseModel):
    """
    Request body for the /optimize endpoint.

    waypoints  - the bulk addresses the user loaded (already geocoded by the frontend)
    start      - optional depot/origin (must be geocoded)
    end        - optional final destination (must be geocoded)
    api_key    - caller's Google Maps API key (used server-side for Routes Matrix)
    time_limit_seconds - max solver wall-clock time (capped at 30 s on the server)
    """
    waypoints: list[Location] = Field(..., min_length=1, max_length=25)
    start: Optional[Location] = None
    end: Optional[Location] = None
    api_key: Optional[str] = Field(None, min_length=10, description="Google Maps API key (fallback if MAPS_API_KEY env is not set)")
    time_limit_seconds: int = Field(5, ge=1, le=30)

    @field_validator("waypoints")
    @classmethod
    def at_least_one_waypoint(cls, v: list[Location]) -> list[Location]:
        if not v:
            raise ValueError("At least one waypoint is required.")
        return v


class RouteSegment(BaseModel):
    """A single step in the optimised route."""
    index: int = Field(..., description="Original waypoint index (0-based)")
    location: Location
    order: int = Field(..., description="Position in the optimised route (0 = first stop)")


class OptimizeResponse(BaseModel):
    """
    Response body from the /optimize endpoint.

    ordered_route   - waypoints in the optimised visit order
    total_distance_m - total estimated road distance in metres
    total_duration_s - total estimated duration in seconds (traffic-aware)
    maps_url         - ready-to-use Google Maps navigation URL
    """
    ordered_route: list[RouteSegment]
    total_distance_m: int
    total_duration_s: int
    maps_url: str


class ErrorResponse(BaseModel):
    detail: str

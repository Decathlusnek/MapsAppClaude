"""
solver.py — OR-Tools VRP/TSP Engine
====================================

HOW IT WORKS (plain English):
1.  We ask Google Routes API for a duration matrix: how long (seconds) does it
    take to drive from every point to every other point, with live traffic.
2.  We hand that matrix to Google OR-Tools, which treats the problem as a
    Traveling Salesman Problem (1 vehicle, visit all stops, minimise total time).
3.  Phase 1 – PATH_CHEAPEST_ARC: greedy construction — always go to the nearest
    unvisited stop. Fast, runs in milliseconds.
4.  Phase 2 – GUIDED_LOCAL_SEARCH: improvement — repeatedly try swapping pairs
    of stops and keep swaps that shorten the route. Runs until the time limit.
5.  The solver returns an ordered list of indices into the original waypoints
    array, plus total distance and duration.

STATELESS DESIGN:
Each call to `solve()` creates its own OR-Tools model, manager, and routing
object. No shared mutable state ⇒ safe for concurrent Cloud Run requests.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Optional

import httpx
from ortools.constraint_solver import pywrapcp, routing_enums_pb2

from models import Location, OptimizeRequest, OptimizeResponse, RouteSegment

logger = logging.getLogger(__name__)

ROUTES_MATRIX_URL = (
    "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix"
)

# ─────────────────────────────────────────────────────────────────────────────
# Routes API helpers
# ─────────────────────────────────────────────────────────────────────────────

def _location_to_waypoint(loc: Location) -> dict:
    return {
        "waypoint": {
            "location": {
                "latLng": {"latitude": loc.lat, "longitude": loc.lng}
            }
        }
    }


async def _fetch_distance_matrix(
    locations: list[Location], api_key: str
) -> tuple[list[list[int]], list[list[int]]]:
    """
    Call the Routes API Compute Route Matrix endpoint.

    Returns two n×n matrices:
      - duration_matrix[i][j]  (seconds, traffic-aware)
      - distance_matrix[i][j]  (metres)

    Falls back to Haversine distances if the API call fails (e.g. in tests).
    """
    n = len(locations)
    origins = [_location_to_waypoint(loc) for loc in locations]
    destinations = origins  # square matrix

    payload = {
        "origins": origins,
        "destinations": destinations,
        "travelMode": "DRIVE",
        "routingPreference": "TRAFFIC_AWARE",
        "extraComputations": ["TOLLS"],
    }
    headers = {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": api_key,
        "X-Goog-FieldMask": (
            "originIndex,destinationIndex,"
            "duration,distanceMeters,status"
        ),
    }

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(ROUTES_MATRIX_URL, json=payload, headers=headers)
            resp.raise_for_status()
            elements = resp.json()

        # Build n×n matrices from the flat element list
        duration_matrix = [[0] * n for _ in range(n)]
        distance_matrix = [[0] * n for _ in range(n)]

        for elem in elements:
            i = elem["originIndex"]
            j = elem["destinationIndex"]
            status = elem.get("status", {}).get("code", 0)
            if status != 0:
                # Non-OK element — use a large penalty
                duration_matrix[i][j] = 10_000_000
                distance_matrix[i][j] = 10_000_000
            else:
                # duration comes as "123s" string
                dur_str = elem.get("duration", "0s")
                duration_matrix[i][j] = int(dur_str.rstrip("s"))
                distance_matrix[i][j] = int(elem.get("distanceMeters", 0))

        return duration_matrix, distance_matrix

    except Exception as exc:  # noqa: BLE001
        logger.warning("Routes API failed (%s); falling back to Haversine.", exc)
        return _haversine_matrices(locations)


def _haversine_matrices(
    locations: list[Location],
) -> tuple[list[list[int]], list[list[int]]]:
    """
    Fallback distance matrix using Haversine formula (straight-line distance).
    Duration is estimated at 40 km/h average urban speed.
    """
    import math

    n = len(locations)
    dur = [[0] * n for _ in range(n)]
    dist = [[0] * n for _ in range(n)]

    for i, a in enumerate(locations):
        for j, b in enumerate(locations):
            if i == j:
                continue
            R = 6_371_000  # earth radius in metres
            φ1, φ2 = math.radians(a.lat), math.radians(b.lat)
            Δφ = math.radians(b.lat - a.lat)
            Δλ = math.radians(b.lng - a.lng)
            h = (
                math.sin(Δφ / 2) ** 2
                + math.cos(φ1) * math.cos(φ2) * math.sin(Δλ / 2) ** 2
            )
            d = int(2 * R * math.asin(math.sqrt(h)))
            dist[i][j] = d
            dur[i][j] = int(d / (40_000 / 3600))  # 40 km/h → m/s

    return dur, dist


# ─────────────────────────────────────────────────────────────────────────────
# OR-Tools solver
# ─────────────────────────────────────────────────────────────────────────────

def _run_ortools(
    duration_matrix: list[list[int]],
    distance_matrix: list[list[int]],
    depot_index: int,
    end_index: Optional[int],
    time_limit_seconds: int,
) -> tuple[list[int], int, int]:
    """
    Solve the TSP using OR-Tools.

    Returns (ordered_indices, total_duration_s, total_distance_m).
    `ordered_indices` starts and ends at depot_index unless end_index differs.
    """
    n = len(duration_matrix)

    # Manager maps internal solver nodes ↔ problem indices
    manager = pywrapcp.RoutingIndexManager(n, 1, [depot_index], [end_index or depot_index])
    routing = pywrapcp.RoutingModel(manager)

    # Duration callback (primary cost)
    def duration_callback(from_idx: int, to_idx: int) -> int:
        i = manager.IndexToNode(from_idx)
        j = manager.IndexToNode(to_idx)
        return duration_matrix[i][j]

    transit_id = routing.RegisterTransitCallback(duration_callback)
    routing.SetArcCostEvaluatorOfAllVehicles(transit_id)

    # Distance dimension (secondary — used for reporting)
    def distance_callback(from_idx: int, to_idx: int) -> int:
        i = manager.IndexToNode(from_idx)
        j = manager.IndexToNode(to_idx)
        return distance_matrix[i][j]

    dist_id = routing.RegisterTransitCallback(distance_callback)
    routing.AddDimension(dist_id, 0, 10_000_000, True, "Distance")

    # Search parameters
    params = pywrapcp.DefaultRoutingSearchParameters()
    params.first_solution_strategy = (
        routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC
    )
    params.local_search_metaheuristic = (
        routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH
    )
    params.time_limit.seconds = time_limit_seconds
    params.log_search = False

    solution = routing.SolveWithParameters(params)

    if not solution:
        # Return naive order as last resort
        logger.warning("OR-Tools found no solution; returning input order.")
        total_dur = sum(duration_matrix[i][(i + 1) % n] for i in range(n))
        total_dist = sum(distance_matrix[i][(i + 1) % n] for i in range(n))
        return list(range(n)), total_dur, total_dist

    # Extract ordered route
    ordered: list[int] = []
    index = routing.Start(0)
    while not routing.IsEnd(index):
        ordered.append(manager.IndexToNode(index))
        index = solution.Value(routing.NextVar(index))

    # Compute totals from the solution
    total_dur = 0
    total_dist = 0
    for k in range(len(ordered) - 1):
        i, j = ordered[k], ordered[k + 1]
        total_dur += duration_matrix[i][j]
        total_dist += distance_matrix[i][j]

    return ordered, total_dur, total_dist


# ─────────────────────────────────────────────────────────────────────────────
# Maps URL builder
# ─────────────────────────────────────────────────────────────────────────────

def _build_maps_url(ordered_locations: list[Location]) -> str:
    """
    Build a Google Maps Directions URL with up to 9 intermediate waypoints.
    Format: https://www.google.com/maps/dir/?api=1&origin=...&destination=...&waypoints=...
    """
    if len(ordered_locations) < 1:
        return ""

    origin = ordered_locations[0]
    destination = ordered_locations[-1]
    middle = ordered_locations[1:-1]

    origin_str = f"{origin.lat},{origin.lng}"
    dest_str = f"{destination.lat},{destination.lng}"

    url = (
        f"https://www.google.com/maps/dir/?api=1"
        f"&origin={origin_str}"
        f"&destination={dest_str}"
        f"&travelmode=driving"
    )

    if middle:
        # Google Maps URL supports up to 9 waypoints
        waypoints_str = "|".join(f"{loc.lat},{loc.lng}" for loc in middle[:9])
        url += f"&waypoints={waypoints_str}"

    return url


# ─────────────────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────────────────

async def solve(request: OptimizeRequest) -> OptimizeResponse:
    """
    Main solver entry point. Call this from the FastAPI route handler.

    Steps:
      1. Assemble the full location list (start + waypoints + end).
      2. Fetch the traffic-aware duration/distance matrix from Routes API.
      3. Run OR-Tools TSP solver in a thread pool (CPU-bound).
      4. Map solver indices back to locations.
      5. Build the Google Maps navigation URL.
      6. Return structured OptimizeResponse.
    """
    # 1. Build unified list: [start?] + waypoints + [end?]
    all_locations: list[Location] = []
    depot_index = 0
    end_index: Optional[int] = None

    if request.start:
        all_locations.append(request.start)
        depot_index = 0
    
    waypoint_offset = len(all_locations)
    all_locations.extend(request.waypoints)

    if request.end:
        all_locations.append(request.end)
        end_index = len(all_locations) - 1

    n = len(all_locations)

    if n == 1:
        # Trivial single-point case
        segment = RouteSegment(index=0, location=all_locations[0], order=0)
        return OptimizeResponse(
            ordered_route=[segment],
            total_distance_m=0,
            total_duration_s=0,
            maps_url=_build_maps_url(all_locations),
        )

    # 2. Fetch matrix
    duration_matrix, distance_matrix = await _fetch_distance_matrix(
        all_locations, request.api_key
    )

    # 3. Run solver in a thread pool to avoid blocking the event loop
    loop = asyncio.get_running_loop()
    ordered_indices, total_dur, total_dist = await loop.run_in_executor(
        None,
        _run_ortools,
        duration_matrix,
        distance_matrix,
        depot_index,
        end_index,
        request.time_limit_seconds,
    )

    # 4. Build response
    ordered_locations = [all_locations[i] for i in ordered_indices]
    ordered_route = [
        RouteSegment(
            index=ordered_indices[pos],
            location=ordered_locations[pos],
            order=pos,
        )
        for pos in range(len(ordered_indices))
    ]

    # 5. Build Maps URL
    maps_url = _build_maps_url(ordered_locations)

    return OptimizeResponse(
        ordered_route=ordered_route,
        total_distance_m=total_dist,
        total_duration_s=total_dur,
        maps_url=maps_url,
    )

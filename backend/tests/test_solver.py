"""
tests/test_solver.py — PyTest suite for the Route Optimizer backend
=====================================================================

Test locations are in the Alto Caiçaras neighbourhood of Belo Horizonte, MG,
Brazil. All Routes API calls are mocked — no real API key is needed to run
these tests.

Run:
    cd backend
    pip install -r requirements.txt pytest pytest-asyncio pytest-mock
    pytest tests/ -v
"""
from __future__ import annotations

import pytest
import pytest_asyncio
from unittest.mock import AsyncMock, patch

import sys
import os

# Allow imports from parent directory (backend/)
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from models import Location, OptimizeRequest
from solver import (
    _build_maps_url,
    _haversine_matrices,
    _run_ortools,
    solve,
)

# ─────────────────────────────────────────────────────────────────────────────
# Demo locations — Alto Caiçaras, Belo Horizonte, MG
# ─────────────────────────────────────────────────────────────────────────────
BH_LOCATIONS = [
    Location(lat=-19.9245, lng=-44.0082, address="Rua Padre Eustáquio, 1000 – Alto Caiçaras"),
    Location(lat=-19.9212, lng=-44.0051, address="Av. Silva Lobo, 500 – Alto Caiçaras"),
    Location(lat=-19.9280, lng=-44.0120, address="Rua Itapecerica, 200 – Alto Caiçaras"),
    Location(lat=-19.9255, lng=-44.0089, address="Rua Jequitinhonha, 150 – Alto Caiçaras"),
    Location(lat=-19.9230, lng=-44.0065, address="Av. Amazonas, 3000 – Alto Caiçaras"),
]

BH_START = Location(lat=-19.9200, lng=-44.0040, address="Start – Alto Caiçaras Depot")
BH_END   = Location(lat=-19.9290, lng=-44.0130, address="End – Alto Caiçaras Depot")

DUMMY_API_KEY = "TEST_API_KEY_NOT_REAL"


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────
def _make_request(**kwargs) -> OptimizeRequest:
    defaults = dict(
        waypoints=BH_LOCATIONS[:3],
        api_key=DUMMY_API_KEY,
        time_limit_seconds=2,
    )
    defaults.update(kwargs)
    return OptimizeRequest(**defaults)


# ─────────────────────────────────────────────────────────────────────────────
# Unit tests — pure logic (no I/O)
# ─────────────────────────────────────────────────────────────────────────────
class TestBuildMapsUrl:
    def test_single_location_returns_url(self):
        url = _build_maps_url([BH_LOCATIONS[0]])
        assert "google.com/maps" in url

    def test_two_locations_origin_destination(self):
        url = _build_maps_url(BH_LOCATIONS[:2])
        assert "origin=" in url
        assert "destination=" in url
        assert "waypoints" not in url

    def test_three_locations_has_waypoints(self):
        url = _build_maps_url(BH_LOCATIONS[:3])
        assert "waypoints=" in url

    def test_caps_at_9_intermediate_waypoints(self):
        # 11 locations → 9 intermediate (indices 1-9), destination=index 10
        locs = BH_LOCATIONS * 3  # 15 locs
        url = _build_maps_url(locs)
        # Count pipes: 9 waypoints = 8 pipes
        waypoints_segment = url.split("waypoints=")[1]
        assert waypoints_segment.count("|") <= 8

    def test_url_contains_travelmode_driving(self):
        url = _build_maps_url(BH_LOCATIONS)
        assert "travelmode=driving" in url


class TestHaversineMatrices:
    def test_returns_square_matrices(self):
        n = len(BH_LOCATIONS)
        dur, dist = _haversine_matrices(BH_LOCATIONS)
        assert len(dur) == n
        assert all(len(row) == n for row in dur)
        assert len(dist) == n
        assert all(len(row) == n for row in dist)

    def test_diagonal_is_zero(self):
        dur, dist = _haversine_matrices(BH_LOCATIONS)
        for i in range(len(BH_LOCATIONS)):
            assert dur[i][i] == 0
            assert dist[i][i] == 0

    def test_non_zero_off_diagonal(self):
        dur, dist = _haversine_matrices(BH_LOCATIONS)
        assert dur[0][1] > 0
        assert dist[0][1] > 0

    def test_symmetry_approximate(self):
        """Haversine distances should be symmetric."""
        dur, dist = _haversine_matrices(BH_LOCATIONS)
        for i in range(len(BH_LOCATIONS)):
            for j in range(len(BH_LOCATIONS)):
                assert abs(dist[i][j] - dist[j][i]) < 10  # within 10 m


class TestRunOrtools:
    def test_returns_valid_route(self):
        dur, dist = _haversine_matrices(BH_LOCATIONS)
        ordered, total_dur, total_dist = _run_ortools(dur, dist, 0, None, 2)
        assert isinstance(ordered, list)
        assert len(ordered) == len(BH_LOCATIONS)
        assert set(ordered) == set(range(len(BH_LOCATIONS)))

    def test_starts_at_depot(self):
        dur, dist = _haversine_matrices(BH_LOCATIONS)
        ordered, _, _ = _run_ortools(dur, dist, 0, None, 2)
        assert ordered[0] == 0

    def test_single_location(self):
        """Single location should return trivially."""
        dur = [[0]]
        dist = [[0]]
        ordered, total_dur, total_dist = _run_ortools(dur, dist, 0, None, 1)
        assert ordered == [0]
        assert total_dur == 0
        assert total_dist == 0

    def test_two_locations(self):
        dur, dist = _haversine_matrices(BH_LOCATIONS[:2])
        ordered, total_dur, total_dist = _run_ortools(dur, dist, 0, None, 1)
        assert len(ordered) == 2
        assert 0 in ordered and 1 in ordered

    def test_with_explicit_end(self):
        all_locs = [BH_START] + list(BH_LOCATIONS[:3]) + [BH_END]
        dur, dist = _haversine_matrices(all_locs)
        end_index = len(all_locs) - 1
        ordered, _, _ = _run_ortools(dur, dist, 0, end_index, 2)
        assert ordered[0] == 0
        assert ordered[-1] == end_index


# ─────────────────────────────────────────────────────────────────────────────
# Integration tests — mocked Routes API
# ─────────────────────────────────────────────────────────────────────────────
@pytest.mark.asyncio
class TestSolveEndToEnd:
    async def test_basic_solve_returns_response(self):
        req = _make_request(waypoints=BH_LOCATIONS[:3])
        with patch("solver._fetch_distance_matrix") as mock_matrix:
            dur, dist = _haversine_matrices(BH_LOCATIONS[:3])
            mock_matrix.return_value = (dur, dist)
            result = await solve(req)
        assert len(result.ordered_route) == 3
        assert result.total_duration_s >= 0
        assert result.total_distance_m >= 0
        assert "google.com/maps" in result.maps_url

    async def test_solve_with_all_five_bh_locations(self):
        req = _make_request(waypoints=BH_LOCATIONS)
        with patch("solver._fetch_distance_matrix") as mock_matrix:
            dur, dist = _haversine_matrices(BH_LOCATIONS)
            mock_matrix.return_value = (dur, dist)
            result = await solve(req)
        # All 5 stops must appear in result
        assert len(result.ordered_route) == 5
        indices = [s.index for s in result.ordered_route]
        assert sorted(indices) == list(range(5))

    async def test_solve_with_start_and_end(self):
        req = _make_request(
            waypoints=BH_LOCATIONS[:3],
            start=BH_START,
            end=BH_END,
        )
        with patch("solver._fetch_distance_matrix") as mock_matrix:
            all_locs = [BH_START] + BH_LOCATIONS[:3] + [BH_END]
            dur, dist = _haversine_matrices(all_locs)
            mock_matrix.return_value = (dur, dist)
            result = await solve(req)
        assert len(result.ordered_route) == 5  # start + 3 waypoints + end

    async def test_single_waypoint_trivial(self):
        req = _make_request(waypoints=[BH_LOCATIONS[0]])
        result = await solve(req)
        assert len(result.ordered_route) == 1
        assert result.total_distance_m == 0
        assert result.total_duration_s == 0

    async def test_maps_url_is_valid(self):
        req = _make_request(waypoints=BH_LOCATIONS[:4])
        with patch("solver._fetch_distance_matrix") as mock_matrix:
            dur, dist = _haversine_matrices(BH_LOCATIONS[:4])
            mock_matrix.return_value = (dur, dist)
            result = await solve(req)
        assert result.maps_url.startswith("https://www.google.com/maps/dir/")
        assert "origin=" in result.maps_url
        assert "destination=" in result.maps_url


# ─────────────────────────────────────────────────────────────────────────────
# Validation tests — bad inputs
# ─────────────────────────────────────────────────────────────────────────────
class TestModelValidation:
    def test_empty_waypoints_raises(self):
        with pytest.raises(Exception):
            OptimizeRequest(waypoints=[], api_key=DUMMY_API_KEY)

    def test_too_many_waypoints_raises(self):
        with pytest.raises(Exception):
            OptimizeRequest(
                waypoints=[BH_LOCATIONS[0]] * 26,  # > max 25
                api_key=DUMMY_API_KEY,
            )

    def test_invalid_lat_raises(self):
        with pytest.raises(Exception):
            Location(lat=999, lng=0)

    def test_invalid_lng_raises(self):
        with pytest.raises(Exception):
            Location(lat=0, lng=999)

    def test_short_api_key_raises(self):
        with pytest.raises(Exception):
            OptimizeRequest(waypoints=BH_LOCATIONS[:1], api_key="short")

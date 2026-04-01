/**
 * script.js — Route Optimizer Frontend Logic
 * ============================================
 *
 * Responsibilities:
 *  1. Initialize Google Maps centered on Alto Caiçaras, Belo Horizonte.
 *  2. Geocode bulk address input using the Geocoding API.
 *  3. Track GPS coordinates for optional start/end points.
 *  4. POST geocoded waypoints to the backend /optimize endpoint.
 *  5. Draw the optimized polyline on the map.
 *  6. Display ordered stop list + stats, and expose Google Maps nav URL.
 *
 * BACKEND URL: Update BACKEND_URL below to point to your Cloud Run service
 * after deploying. For local development, leave as-is (localhost:8080).
 */

'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

/** Update this to your deployed Cloud Run URL after deployment. */
const BACKEND_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? 'http://localhost:8080'
  : 'https://YOUR_CLOUD_RUN_URL';  // ← replace after `gcloud run deploy`

/** Default map center: Alto Caiçaras, Belo Horizonte, MG */
const DEFAULT_CENTER = { lat: -19.9245, lng: -44.0082 };
const DEFAULT_ZOOM   = 14;

/** Demo addresses for testing (Alto Caiçaras, BH) */
const DEMO_ADDRESSES = [
  'Rua Padre Eustáquio, 1000, Belo Horizonte, MG',
  'Av. Silva Lobo, 500, Belo Horizonte, MG',
  'Rua Itapecerica, 200, Belo Horizonte, MG',
  'Rua Jequitinhonha, 150, Belo Horizonte, MG',
  'Av. Amazonas, 3000, Belo Horizonte, MG',
].join('\n');

// ─────────────────────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────────────────────

/** @type {google.maps.Map} */
let map = null;

/** @type {google.maps.Geocoder} */
let geocoder = null;

/** @type {google.maps.Polyline | null} */
let routePolyline = null;

/**
 * @typedef {{ lat: number, lng: number, address: string }} GeoPoint
 * @type {GeoPoint[]}  — geocoded waypoints (in input order)
 */
let geocodedWaypoints = [];

/** @type {{ lat: number, lng: number } | null} */
let startCoords = null;

/** @type {{ lat: number, lng: number } | null} */
let endCoords   = null;

/** @type {google.maps.Marker[]} */
let waypointMarkers = [];

/** @type {google.maps.Marker | null} */
let startMarker = null;

/** @type {google.maps.Marker | null} */
let endMarker   = null;

// ─────────────────────────────────────────────────────────────────────────────
// DOM helpers
// ─────────────────────────────────────────────────────────────────────────────

const $  = (id) => document.getElementById(id);

const el = {
  sidebar:        () => $('sidebar'),
  sidebarToggle:  () => $('sidebarToggle'),
  expandBtn:      () => $('expandBtn'),
  startInput:     () => $('startInput'),
  endInput:       () => $('endInput'),
  startGpsBtn:    () => $('startGpsBtn'),
  endGpsBtn:      () => $('endGpsBtn'),
  addressTextarea:() => $('addressTextarea'),
  loadDemoBtn:    () => $('loadDemoBtn'),
  geocodeBtn:     () => $('geocodeBtn'),
  apiKeyInput:    () => $('apiKeyInput'),
  optimizeBtn:    () => $('optimizeBtn'),
  optimizeHint:   () => $('optimizeHint'),
  resultsCard:    () => $('resultsCard'),
  statDistanceVal:() => $('statDistanceVal'),
  statDurationVal:() => $('statDurationVal'),
  routeList:      () => $('routeList'),
  mapsLink:       () => $('mapsLink'),
  toast:          () => $('toast'),
  loadingOverlay: () => $('loadingOverlay'),
  loadingText:    () => $('loadingText'),
};

// ─────────────────────────────────────────────────────────────────────────────
// Toast notifications
// ─────────────────────────────────────────────────────────────────────────────

let _toastTimer = null;

/**
 * Show a toast message.
 * @param {string} message
 * @param {'success'|'error'|'info'} [type]
 * @param {number} [duration] milliseconds
 */
function showToast(message, type = 'info', duration = 3500) {
  const toast = el.toast();
  toast.textContent = message;
  toast.className = `toast toast-visible toast-${type}`;
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => {
    toast.classList.remove('toast-visible');
  }, duration);
}

// ─────────────────────────────────────────────────────────────────────────────
// Loading overlay
// ─────────────────────────────────────────────────────────────────────────────

function showLoading(text = 'Optimizing route…') {
  el.loadingText().textContent = text;
  el.loadingOverlay().classList.remove('hidden');
}

function hideLoading() {
  el.loadingOverlay().classList.add('hidden');
}

// ─────────────────────────────────────────────────────────────────────────────
// Formatting helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Format metres → "1.2 km" or "450 m"
 * @param {number} metres
 * @returns {string}
 */
function formatDistance(metres) {
  if (metres >= 1000) return `${(metres / 1000).toFixed(1)} km`;
  return `${metres} m`;
}

/**
 * Format seconds → "1 h 23 min" or "45 min"
 * @param {number} seconds
 * @returns {string}
 */
function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h > 0) return `${h} h ${m} min`;
  return `${m} min`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Map initialization (called by Google Maps JS API callback)
// ─────────────────────────────────────────────────────────────────────────────

function initMap() {
  map = new google.maps.Map($('map'), {
    center: DEFAULT_CENTER,
    zoom: DEFAULT_ZOOM,
    disableDefaultUI: false,
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: true,
    zoomControl: true,
    styles: DARK_MAP_STYLES,
  });

  geocoder = new google.maps.Geocoder();
  bindEvents();
}

// ─────────────────────────────────────────────────────────────────────────────
// Event binding
// ─────────────────────────────────────────────────────────────────────────────

function bindEvents() {
  // Sidebar toggle
  el.sidebarToggle().addEventListener('click', () => setSidebarCollapsed(true));
  el.expandBtn().addEventListener('click',    () => setSidebarCollapsed(false));

  // Demo data
  el.loadDemoBtn().addEventListener('click', () => {
    el.addressTextarea().value = DEMO_ADDRESSES;
    showToast('Demo addresses loaded — click "Pin on Map"', 'info');
  });

  // Geocode
  el.geocodeBtn().addEventListener('click', handleGeocode);

  // GPS buttons
  el.startGpsBtn().addEventListener('click', () => captureGPS('start'));
  el.endGpsBtn().addEventListener('click',   () => captureGPS('end'));

  // Optimize
  el.optimizeBtn().addEventListener('click', handleOptimize);

  // Update optimize button state when API key is typed
  el.apiKeyInput().addEventListener('input', updateOptimizeButton);
}

// ─────────────────────────────────────────────────────────────────────────────
// Sidebar collapse / expand
// ─────────────────────────────────────────────────────────────────────────────

function setSidebarCollapsed(collapsed) {
  el.sidebar().classList.toggle('collapsed', collapsed);
  el.expandBtn().classList.toggle('hidden', !collapsed);
}

// ─────────────────────────────────────────────────────────────────────────────
// GPS capture
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {'start'|'end'} which
 */
function captureGPS(which) {
  if (!navigator.geolocation) {
    showToast('Geolocation is not supported by your browser.', 'error');
    return;
  }

  const btn = which === 'start' ? el.startGpsBtn() : el.endGpsBtn();
  btn.classList.add('active');
  showToast('Acquiring GPS position…', 'info');

  navigator.geolocation.getCurrentPosition(
    (position) => {
      const coords = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
      };
      const label = `GPS (${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)})`;

      if (which === 'start') {
        startCoords = coords;
        el.startInput().value = label;
        placeSpecialMarker('start', coords, '🟢 Start');
      } else {
        endCoords = coords;
        el.endInput().value = label;
        placeSpecialMarker('end', coords, '🔴 End');
      }

      btn.classList.remove('active');
      map.panTo(coords);
      showToast(`${which === 'start' ? 'Start' : 'End'} location captured!`, 'success');
    },
    (err) => {
      btn.classList.remove('active');
      showToast(`GPS error: ${err.message}`, 'error');
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Special markers (start / end)
// ─────────────────────────────────────────────────────────────────────────────

function placeSpecialMarker(which, coords, label) {
  const isStart = which === 'start';
  const existing = isStart ? startMarker : endMarker;
  if (existing) existing.setMap(null);

  const marker = new google.maps.Marker({
    position: coords,
    map,
    title: label,
    icon: {
      path: google.maps.SymbolPath.CIRCLE,
      scale: 10,
      fillColor: isStart ? '#3fb950' : '#f85149',
      fillOpacity: 1,
      strokeColor: '#fff',
      strokeWeight: 2,
    },
    zIndex: 100,
  });

  const info = new google.maps.InfoWindow({ content: `<strong>${label}</strong>` });
  marker.addListener('click', () => info.open(map, marker));

  if (isStart) startMarker = marker;
  else          endMarker   = marker;
}

// ─────────────────────────────────────────────────────────────────────────────
// Geocoding
// ─────────────────────────────────────────────────────────────────────────────

async function handleGeocode() {
  const raw = el.addressTextarea().value.trim();
  if (!raw) {
    showToast('Please enter at least one address.', 'error');
    return;
  }

  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length > 25) {
    showToast('Maximum 25 addresses allowed.', 'error');
    return;
  }

  // Geocode any manually typed start/end addresses (if coords not yet set)
  await geocodeSpecialInputs();

  // Clear previous markers
  clearWaypointMarkers();
  geocodedWaypoints = [];

  el.geocodeBtn().disabled = true;
  el.geocodeBtn().textContent = 'Geocoding…';
  showToast(`Geocoding ${lines.length} address${lines.length > 1 ? 'es' : ''}…`, 'info');

  const bounds = new google.maps.LatLngBounds();
  let successCount = 0;
  const failed = [];

  for (const [i, address] of lines.entries()) {
    try {
      const result = await geocodeAddress(address);
      if (result) {
        geocodedWaypoints.push(result);
        placeWaypointMarker(result, i + 1);
        bounds.extend({ lat: result.lat, lng: result.lng });
        successCount++;
      } else {
        failed.push(address);
      }
    } catch (err) {
      failed.push(address);
    }
    // Small yield to keep UI responsive
    await sleep(50);
  }

  el.geocodeBtn().disabled = false;
  el.geocodeBtn().innerHTML = `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
      <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
    </svg>
    Pin on Map`;

  if (successCount > 0) {
    map.fitBounds(bounds, { padding: 60 });
    updateOptimizeButton();
    showToast(
      failed.length
        ? `${successCount} pinned, ${failed.length} failed.`
        : `${successCount} address${successCount > 1 ? 'es' : ''} pinned!`,
      failed.length ? 'error' : 'success'
    );
  } else {
    showToast('No addresses could be geocoded. Check your input.', 'error');
  }
}

/**
 * Geocode the typed start/end text inputs if not already set by GPS.
 */
async function geocodeSpecialInputs() {
  const startText = el.startInput().value.trim();
  const endText   = el.endInput().value.trim();

  if (startText && !startCoords && !startText.startsWith('GPS')) {
    const r = await geocodeAddress(startText);
    if (r) {
      startCoords = { lat: r.lat, lng: r.lng };
      placeSpecialMarker('start', startCoords, '🟢 Start');
    }
  }

  if (endText && !endCoords && !endText.startsWith('GPS')) {
    const r = await geocodeAddress(endText);
    if (r) {
      endCoords = { lat: r.lat, lng: r.lng };
      placeSpecialMarker('end', endCoords, '🔴 End');
    }
  }
}

/**
 * Geocode a single address string.
 * @param {string} address
 * @returns {Promise<GeoPoint|null>}
 */
function geocodeAddress(address) {
  return new Promise((resolve) => {
    geocoder.geocode({ address }, (results, status) => {
      if (status === google.maps.GeocoderStatus.OK && results.length > 0) {
        const loc = results[0].geometry.location;
        resolve({
          lat: loc.lat(),
          lng: loc.lng(),
          address: results[0].formatted_address,
        });
      } else {
        resolve(null);
      }
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Waypoint markers
// ─────────────────────────────────────────────────────────────────────────────

function placeWaypointMarker(point, number) {
  const marker = new google.maps.Marker({
    position: { lat: point.lat, lng: point.lng },
    map,
    title: point.address,
    label: {
      text: String(number),
      color: '#ffffff',
      fontSize: '11px',
      fontWeight: '700',
    },
    icon: {
      path: google.maps.SymbolPath.CIRCLE,
      scale: 14,
      fillColor: '#3b82f6',
      fillOpacity: 0.9,
      strokeColor: '#fff',
      strokeWeight: 2,
    },
    zIndex: 50,
  });

  const info = new google.maps.InfoWindow({
    content: `<div style="font-family:Inter,sans-serif;font-size:13px;max-width:220px">
      <strong>#${number}</strong><br>${point.address}
    </div>`,
  });
  marker.addListener('click', () => info.open(map, marker));
  waypointMarkers.push(marker);
}

function clearWaypointMarkers() {
  waypointMarkers.forEach(m => m.setMap(null));
  waypointMarkers = [];
  clearPolyline();
}

// ─────────────────────────────────────────────────────────────────────────────
// Optimize button state
// ─────────────────────────────────────────────────────────────────────────────

function updateOptimizeButton() {
  const hasWaypoints = geocodedWaypoints.length > 0;
  // We no longer strictly require a client-side key because the backend can provide one.
  const canOptimize = hasWaypoints;

  el.optimizeBtn().disabled = !canOptimize;
  el.optimizeHint().textContent = !hasWaypoints
    ? 'Pin addresses on the map first.'
    : `Ready to optimize ${geocodedWaypoints.length} stops.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Optimization
// ─────────────────────────────────────────────────────────────────────────────

async function handleOptimize() {
  const apiKey = el.apiKeyInput().value.trim();
  // apiKey is now optional. If empty, backend will use its own environment variable.
  if (geocodedWaypoints.length === 0) {
    showToast('No waypoints to optimize. Pin addresses first.', 'error');
    return;
  }

  showLoading('Building distance matrix…');
  el.optimizeBtn().disabled = true;

  const body = {
    waypoints: geocodedWaypoints.map(p => ({ lat: p.lat, lng: p.lng, address: p.address })),
    api_key: apiKey || null,
    time_limit_seconds: 5,
  };

  if (startCoords) body.start = { lat: startCoords.lat, lng: startCoords.lng };
  if (endCoords)   body.end   = { lat: endCoords.lat,   lng: endCoords.lng   };

  try {
    el.loadingText().textContent = 'Running OR-Tools solver…';

    const resp = await fetch(`${BACKEND_URL}/optimize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ detail: 'Network error' }));
      throw new Error(err.detail || `HTTP ${resp.status}`);
    }

    const data = await resp.json();
    renderResults(data);
    showToast('Route optimized! 🎉', 'success');

  } catch (err) {
    showToast(`Optimization failed: ${err.message}`, 'error', 6000);
    console.error('[Optimizer] Error:', err);
  } finally {
    hideLoading();
    el.optimizeBtn().disabled = false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Results rendering
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {{ ordered_route: Array, total_distance_m: number, total_duration_s: number, maps_url: string }} data
 */
function renderResults(data) {
  // Stats
  el.statDistanceVal().textContent = formatDistance(data.total_distance_m);
  el.statDurationVal().textContent = formatDuration(data.total_duration_s);

  // Ordered stop list
  const list = el.routeList();
  list.innerHTML = '';
  data.ordered_route.forEach((stop, pos) => {
    const li = document.createElement('li');
    li.className = 'route-list-item';
    li.innerHTML = `
      <span class="route-stop-number">${pos + 1}</span>
      <span class="route-stop-address">${stop.location.address || `${stop.location.lat.toFixed(5)}, ${stop.location.lng.toFixed(5)}`}</span>
    `;
    list.appendChild(li);
  });

  // Show results panel
  el.resultsCard().classList.remove('hidden');

  // Maps navigation link
  el.mapsLink().href = data.maps_url;

  // Draw polyline on map
  drawOptimizedPolyline(data.ordered_route);

  // Re-place markers in optimized order (re-number them)
  renumberMarkers(data.ordered_route);

  // Fit map to route
  const bounds = new google.maps.LatLngBounds();
  data.ordered_route.forEach(stop => bounds.extend({ lat: stop.location.lat, lng: stop.location.lng }));
  map.fitBounds(bounds, { padding: 60 });
}

// ─────────────────────────────────────────────────────────────────────────────
// Polyline
// ─────────────────────────────────────────────────────────────────────────────

function drawOptimizedPolyline(orderedRoute) {
  clearPolyline();

  const path = orderedRoute.map(stop => ({
    lat: stop.location.lat,
    lng: stop.location.lng,
  }));

  routePolyline = new google.maps.Polyline({
    path,
    geodesic: true,
    strokeColor: '#3b82f6',
    strokeOpacity: 0.85,
    strokeWeight: 4,
    icons: [{
      icon: { path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW, scale: 3 },
      offset: '0%',
      repeat: '80px',
    }],
  });

  routePolyline.setMap(map);
}

function clearPolyline() {
  if (routePolyline) {
    routePolyline.setMap(null);
    routePolyline = null;
  }
}

/**
 * Re-number existing markers to reflect optimized order.
 * @param {Array} orderedRoute
 */
function renumberMarkers(orderedRoute) {
  // Clear old waypoint markers and redraw in optimized order
  waypointMarkers.forEach(m => m.setMap(null));
  waypointMarkers = [];

  orderedRoute.forEach((stop, pos) => {
    // Skip start/end special points (they have dedicated markers)
    const point = {
      lat: stop.location.lat,
      lng: stop.location.lng,
      address: stop.location.address || '',
    };
    placeWaypointMarker(point, pos + 1);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Utility
// ─────────────────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─────────────────────────────────────────────────────────────────────────────
// Dark Map Styles (matches the dark UI theme)
// ─────────────────────────────────────────────────────────────────────────────

const DARK_MAP_STYLES = [
  { elementType: 'geometry',                 stylers: [{ color: '#1d2332' }] },
  { elementType: 'labels.text.stroke',       stylers: [{ color: '#1d2332' }] },
  { elementType: 'labels.text.fill',         stylers: [{ color: '#746855' }] },
  { featureType: 'administrative.locality',  elementType: 'labels.text.fill', stylers: [{ color: '#d59563' }] },
  { featureType: 'poi',                      elementType: 'labels.text.fill', stylers: [{ color: '#d59563' }] },
  { featureType: 'poi.park',                 elementType: 'geometry',         stylers: [{ color: '#263c3f' }] },
  { featureType: 'poi.park',                 elementType: 'labels.text.fill', stylers: [{ color: '#6b9a76' }] },
  { featureType: 'road',                     elementType: 'geometry',         stylers: [{ color: '#38414e' }] },
  { featureType: 'road',                     elementType: 'geometry.stroke',  stylers: [{ color: '#212a37' }] },
  { featureType: 'road',                     elementType: 'labels.text.fill', stylers: [{ color: '#9ca5b3' }] },
  { featureType: 'road.highway',             elementType: 'geometry',         stylers: [{ color: '#746855' }] },
  { featureType: 'road.highway',             elementType: 'geometry.stroke',  stylers: [{ color: '#1f2835' }] },
  { featureType: 'road.highway',             elementType: 'labels.text.fill', stylers: [{ color: '#f3d19c' }] },
  { featureType: 'transit',                  elementType: 'geometry',         stylers: [{ color: '#2f3948' }] },
  { featureType: 'transit.station',          elementType: 'labels.text.fill', stylers: [{ color: '#d59563' }] },
  { featureType: 'water',                    elementType: 'geometry',         stylers: [{ color: '#17263c' }] },
  { featureType: 'water',                    elementType: 'labels.text.fill', stylers: [{ color: '#515c6d' }] },
  { featureType: 'water',                    elementType: 'labels.text.stroke', stylers: [{ color: '#17263c' }] },
];

// ─────────────────────────────────────────────────────────────────────────────
// Exports (for Jest unit tests)
// ─────────────────────────────────────────────────────────────────────────────

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { formatDistance, formatDuration, DEMO_ADDRESSES, DEFAULT_CENTER, BACKEND_URL };
}

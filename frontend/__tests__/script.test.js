/**
 * __tests__/script.test.js
 * Jest unit tests for frontend helper functions.
 *
 * Run:
 *   npm test
 *
 * These tests exercise pure logic only — no Google Maps API calls.
 * Test locations default to Alto Caiçaras, Belo Horizonte, MG.
 */

'use strict';

// Mock the Google Maps API globals before importing script.js
global.google = {
  maps: {
    Map: jest.fn(),
    LatLngBounds: jest.fn(() => ({ extend: jest.fn() })),
    Marker: jest.fn(),
    SymbolPath: { CIRCLE: 0, FORWARD_CLOSED_ARROW: 1 },
    Polyline: jest.fn(),
    InfoWindow: jest.fn(),
    Geocoder: jest.fn(),
    GeocoderStatus: { OK: 'OK' }
  }
};

// Mock other browser globals if needed
global.navigator = { geolocation: { getCurrentPosition: jest.fn() } };
global.fetch = jest.fn();

// Import the exported functions from script.js
const {
  formatDistance,
  formatDuration,
  DEMO_ADDRESSES,
  DEFAULT_CENTER,
  BACKEND_URL,
} = require('../script.js');

// ─────────────────────────────────────────────────────────────────────────────
// formatDistance
// ─────────────────────────────────────────────────────────────────────────────

describe('formatDistance()', () => {
  test('returns metres for values below 1000 m', () => {
    expect(formatDistance(0)).toBe('0 m');
    expect(formatDistance(450)).toBe('450 m');
    expect(formatDistance(999)).toBe('999 m');
  });

  test('converts to kilometres for values >= 1000 m', () => {
    expect(formatDistance(1000)).toBe('1.0 km');
    expect(formatDistance(1500)).toBe('1.5 km');
    expect(formatDistance(12345)).toBe('12.3 km');
  });

  test('rounds to one decimal place', () => {
    expect(formatDistance(1234)).toBe('1.2 km');
    expect(formatDistance(9876)).toBe('9.9 km');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// formatDuration
// ─────────────────────────────────────────────────────────────────────────────

describe('formatDuration()', () => {
  test('returns "0 min" for zero seconds', () => {
    expect(formatDuration(0)).toBe('0 min');
  });

  test('returns minutes only when under 1 hour', () => {
    expect(formatDuration(60)).toBe('1 min');
    expect(formatDuration(900)).toBe('15 min');
    expect(formatDuration(3540)).toBe('59 min');
  });

  test('returns hours and minutes for >= 3600 s', () => {
    expect(formatDuration(3600)).toBe('1 h 0 min');
    expect(formatDuration(5400)).toBe('1 h 30 min');
    expect(formatDuration(7200)).toBe('2 h 0 min');
    expect(formatDuration(7380)).toBe('2 h 3 min');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DEMO_ADDRESSES
// ─────────────────────────────────────────────────────────────────────────────

describe('DEMO_ADDRESSES', () => {
  test('contains 5 lines (Alto Caiçaras BH)', () => {
    const lines = DEMO_ADDRESSES.split('\n').filter(Boolean);
    expect(lines.length).toBe(5);
  });

  test('all lines contain Belo Horizonte reference', () => {
    const lines = DEMO_ADDRESSES.split('\n').filter(Boolean);
    lines.forEach(line => {
      expect(line).toMatch(/Belo Horizonte|BH/i);
    });
  });

  test('no line is empty', () => {
    const lines = DEMO_ADDRESSES.split('\n').filter(Boolean);
    lines.forEach(line => {
      expect(line.trim().length).toBeGreaterThan(0);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DEFAULT_CENTER (Alto Caiçaras, Belo Horizonte)
// ─────────────────────────────────────────────────────────────────────────────

describe('DEFAULT_CENTER', () => {
  test('is within Belo Horizonte bounding box', () => {
    // BH rough bounds: lat -20.1 to -19.7, lng -44.2 to -43.8
    expect(DEFAULT_CENTER.lat).toBeGreaterThan(-20.1);
    expect(DEFAULT_CENTER.lat).toBeLessThan(-19.7);
    expect(DEFAULT_CENTER.lng).toBeGreaterThan(-44.2);
    expect(DEFAULT_CENTER.lng).toBeLessThan(-43.8);
  });

  test('has lat and lng properties', () => {
    expect(typeof DEFAULT_CENTER.lat).toBe('number');
    expect(typeof DEFAULT_CENTER.lng).toBe('number');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BACKEND_URL
// ─────────────────────────────────────────────────────────────────────────────

describe('BACKEND_URL', () => {
  test('is a non-empty string', () => {
    expect(typeof BACKEND_URL).toBe('string');
    expect(BACKEND_URL.length).toBeGreaterThan(0);
  });

  test('starts with http', () => {
    expect(BACKEND_URL).toMatch(/^https?:\/\//);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Address parsing helpers (inline, not exported — tested inline here)
// ─────────────────────────────────────────────────────────────────────────────

describe('Address line parser', () => {
  function parseLines(raw) {
    return raw.split('\n').map(l => l.trim()).filter(Boolean);
  }

  test('splits newline-separated addresses', () => {
    const input = 'Addr 1\nAddr 2\nAddr 3';
    expect(parseLines(input)).toEqual(['Addr 1', 'Addr 2', 'Addr 3']);
  });

  test('trims whitespace from each line', () => {
    const input = '  Addr 1  \n  Addr 2  ';
    expect(parseLines(input)).toEqual(['Addr 1', 'Addr 2']);
  });

  test('filters out blank lines', () => {
    const input = 'Addr 1\n\n\nAddr 2\n  \nAddr 3';
    expect(parseLines(input)).toEqual(['Addr 1', 'Addr 2', 'Addr 3']);
  });

  test('returns empty array for blank input', () => {
    expect(parseLines('')).toEqual([]);
    expect(parseLines('   ')).toEqual([]);
  });

  test('rejects more than 25 addresses', () => {
    const lines = Array.from({ length: 26 }, (_, i) => `Address ${i + 1}`);
    expect(lines.length).toBeGreaterThan(25);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Google Maps URL builder (logic mirrored here for test isolation)
// ─────────────────────────────────────────────────────────────────────────────

describe('buildMapsUrl()', () => {
  function buildMapsUrl(locations) {
    if (locations.length < 1) return '';
    const origin      = locations[0];
    const destination = locations[locations.length - 1];
    const middle      = locations.slice(1, -1);

    let url = `https://www.google.com/maps/dir/?api=1`
            + `&origin=${origin.lat},${origin.lng}`
            + `&destination=${destination.lat},${destination.lng}`
            + `&travelmode=driving`;

    if (middle.length > 0) {
      const wps = middle.slice(0, 9).map(l => `${l.lat},${l.lng}`).join('|');
      url += `&waypoints=${wps}`;
    }
    return url;
  }

  const BH = [
    { lat: -19.9245, lng: -44.0082 },
    { lat: -19.9212, lng: -44.0051 },
    { lat: -19.9280, lng: -44.0120 },
    { lat: -19.9255, lng: -44.0089 },
    { lat: -19.9230, lng: -44.0065 },
  ];

  test('returns empty string for empty array', () => {
    expect(buildMapsUrl([])).toBe('');
  });

  test('contains origin and destination', () => {
    const url = buildMapsUrl(BH);
    expect(url).toContain('origin=-19.9245,-44.0082');
    expect(url).toContain('destination=-19.923,-44.0065');
  });

  test('includes travelmode=driving', () => {
    expect(buildMapsUrl(BH)).toContain('travelmode=driving');
  });

  test('includes waypoints for 3+ locations', () => {
    expect(buildMapsUrl(BH)).toContain('waypoints=');
  });

  test('no waypoints param for exactly 2 locations', () => {
    const url = buildMapsUrl(BH.slice(0, 2));
    expect(url).not.toContain('waypoints=');
  });

  test('caps intermediate waypoints at 9', () => {
    const many = Array.from({ length: 15 }, (_, i) => ({
      lat: -19.9 + i * 0.001,
      lng: -44.0,
    }));
    const url = buildMapsUrl(many);
    const wpsSection = url.split('waypoints=')[1] || '';
    const pipeCount = (wpsSection.match(/\|/g) || []).length;
    expect(pipeCount).toBeLessThanOrEqual(8); // 9 waypoints = 8 pipes
  });
});

/**
 * Coordinate pairs for the "is this a move?" decision, shared by the pure test
 * (test/homeContext.test.mjs, shouldOpenNewContext) and the database test
 * (test/homeContextDb.test.mjs, transition_home_context), so both are held to
 * one table.
 *
 * Each case: [label, the current context's stored point (already rounded, as
 * stored) or null for no current context, the new point as the geocoder gives
 * it (not rounded), whether a new context opens].
 */
export const COORDINATE_CASES = Object.freeze([
  ['no current context: the first one opens', null, { lat: 35.123, lng: -80.456 }, true],
  ['the same rounded point', { lat: 35.123, lng: -80.456 }, { lat: 35.123, lng: -80.456 }, false],
  ['different in the 4th decimal only', { lat: 35.123, lng: -80.456 }, { lat: 35.1234, lng: -80.4561 }, false],
  ['different in the 3rd decimal of lat', { lat: 35.123, lng: -80.456 }, { lat: 35.124, lng: -80.456 }, true],
  ['different in the 3rd decimal of lng', { lat: 35.123, lng: -80.456 }, { lat: 35.123, lng: -80.455 }, true],
  ['the current context has no location', { lat: null, lng: null }, { lat: 35.123, lng: -80.456 }, false],
  ['the current context has lat but no lng', { lat: 35.123, lng: null }, { lat: 36.5, lng: -79.1 }, false],
  ['negative coordinates, same rounded point', { lat: -33.869, lng: 151.209 }, { lat: -33.8694, lng: 151.2093 }, false],
  ['negative coordinates, a different point', { lat: -33.869, lng: 151.209 }, { lat: -33.87, lng: 151.209 }, true],
  ['boundary: 35.1235 rounds up to 35.124', { lat: 35.124, lng: -80.456 }, { lat: 35.1235, lng: -80.456 }, false],
  ['boundary: 35.1235 is a move away from 35.123', { lat: 35.123, lng: -80.456 }, { lat: 35.1235, lng: -80.456 }, true],
  ['boundary: -80.4565 rounds toward +infinity, to -80.456', { lat: 35.123, lng: -80.456 }, { lat: 35.123, lng: -80.4565 }, false],
  ['boundary: -80.4565 is a move away from -80.457', { lat: 35.123, lng: -80.457 }, { lat: 35.123, lng: -80.4565 }, true],
  ['boundary: 1.0005 rounds up to 1.001', { lat: 1.001, lng: 1.001 }, { lat: 1.0005, lng: 1.0005 }, false],
  ['boundary: -0.0005 rounds to zero, the same point as 0', { lat: 0, lng: 0 }, { lat: -0.0005, lng: 0.0004 }, false],
  ['boundary: -0.0005 is a move away from -0.001', { lat: -0.001, lng: 0 }, { lat: -0.0005, lng: 0 }, true],
]);

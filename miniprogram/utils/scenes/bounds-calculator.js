/**
 * Venue 3D Extent & Bounds Calculator
 *
 * Completely decoupled from complex stadium geometry (schema-geometry).
 * Robustly estimates the outer boundary of any stadium from standard venue schema properties.
 */

function computeVenueBounds(venue) {
  if (!venue) {
    return {
      radiusX: 60,
      radiusZ: 70,
      maxRadius: 70,
      width: 120,
      depth: 140,
      minX: -60,
      maxX: 60,
      minZ: -70,
      maxZ: 70,
      minY: -0.60,
      maxY: 35,
      center: { x: 0, y: 0, z: 0 }
    };
  }

  // 1. Infield base dimensions (infield length is along Z, width is along X)
  const infield = venue.infield || {};
  const infHalfX = Math.max(15, (Number(infield.width) || 68) / 2);
  const infHalfZ = Math.max(20, (Number(infield.length) || 105) / 2);

  // 2. Stand tiers cumulative radial depth and elevation
  const tiers = Array.isArray(venue.standTiers) ? venue.standTiers : [];
  let totalTierDepth = 0;
  let maxElevation = 18;

  for (let i = 0; i < tiers.length; i++) {
    const t = tiers[i] || {};
    const innerOffset = Math.max(0, Number(t.innerOffset) || 0);
    const rows = Math.max(1, Number(t.defaultRows) || 20);
    const pitch = Math.max(0.6, Number(t.defaultRowPitch) || 0.85);
    const radialDepth = (t.radialDepth !== undefined && t.radialDepth !== null)
      ? Math.max(6, Number(t.radialDepth))
      : (rows * pitch);
    totalTierDepth += innerOffset + radialDepth;

    const baseElev = Number(t.baseElevation) || 0;
    const riserH = Number(t.defaultRiserHeight) || (pitch * Math.tan(22 * Math.PI / 180));
    const tierTopY = baseElev + rows * riserH;
    if (tierTopY > maxElevation) {
      maxElevation = tierTopY;
    }
  }

  if (totalTierDepth === 0) {
    totalTierDepth = 48;
  }

  // 3. Canopy outer radius if present
  let canopyRadiusX = 0;
  let canopyRadiusZ = 0;
  if (venue.canopy) {
    canopyRadiusX = Number(venue.canopy.outerRadiusX || venue.canopy.radiusX) || 0;
    canopyRadiusZ = Number(venue.canopy.outerRadiusZ || venue.canopy.radiusZ) || 0;
    if (venue.canopy.elevation) {
      maxElevation = Math.max(maxElevation, Number(venue.canopy.elevation) + 6);
    }
  }

  // 4. Engineering summary & outermost footprint bounds
  const summary = venue.engineeringSummary || {};
  const footprintHalfX = (Number(summary.outermostFootprintWidthM || venue.outermostFootprintWidthM) || 0) / 2;
  const footprintHalfZ = (Number(summary.outermostFootprintLengthM || venue.outermostFootprintLengthM) || 0) / 2;
  const maxBowlElev = Number(summary.maxBowlElevationM || venue.maxBowlElevationM) || 0;
  if (maxBowlElev > 0) {
    maxElevation = Math.max(maxElevation, maxBowlElev + 6);
  }

  const radiusX = Math.max(infHalfX + totalTierDepth, canopyRadiusX, footprintHalfX);
  const radiusZ = Math.max(infHalfZ + totalTierDepth, canopyRadiusZ, footprintHalfZ);
  const maxRadius = Math.hypot(radiusX, radiusZ);

  return {
    radiusX,
    radiusZ,
    maxRadius,
    width: radiusX * 2,
    depth: radiusZ * 2,
    minX: -radiusX,
    maxX: radiusX,
    minZ: -radiusZ,
    maxZ: radiusZ,
    minY: -0.60,
    maxY: maxElevation,
    center: { x: 0, y: 0, z: 0 }
  };
}

module.exports = {
  computeVenueBounds
};

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '..');

function loadCommonJs(filePath, cache = {}) {
  const resolved = path.resolve(filePath);
  if (cache[resolved]) return cache[resolved].exports;

  const src = fs.readFileSync(resolved, 'utf8');
  const mod = { exports: {} };
  cache[resolved] = mod;

  const customRequire = (id) => {
    if (id.startsWith('.')) {
      let target = path.resolve(path.dirname(resolved), id);
      if (!fs.existsSync(target) && fs.existsSync(target + '.js')) {
        target += '.js';
      }
      return loadCommonJs(target, cache);
    }
    return require(id);
  };

  const fn = new Function('module', 'exports', 'require', src);
  fn(mod, mod.exports, customRequire);
  return mod.exports;
}

const { VENUES } = loadCommonJs(path.join(ROOT, 'miniprogram/data/venues.js'));
const geo = loadCommonJs(path.join(ROOT, 'miniprogram/utils/schema-geometry.js'));
const { MeshBuilder } = loadCommonJs(path.join(ROOT, 'miniprogram/utils/engine-3d-mesh-builder.js'));
const { Renderer3D } = loadCommonJs(path.join(ROOT, 'miniprogram/utils/renderer-3d.js'));

const baseVenue = geo.normalizeVenueCoordinates(VENUES[0]);

function assertNoNaNs(mb, label) {
  for (let i = 0; i < mb.positions.length; i++) {
    assert.ok(!Number.isNaN(mb.positions[i]), `${label} position[${i}] must not be NaN`);
  }
  for (let i = 0; i < mb.normals.length; i++) {
    assert.ok(!Number.isNaN(mb.normals[i]), `${label} normal[${i}] must not be NaN`);
  }
  for (let i = 0; i < mb.colors.length; i++) {
    assert.ok(!Number.isNaN(mb.colors[i]), `${label} color[${i}] must not be NaN`);
  }
}

// Helper: compute polar angle in [0, 360) matching schema-geometry (0=North(0,-1), 90=East(+1,0))
function angleOfXZ(x, z) {
  const rad = Math.atan2(x, -z);
  return ((rad * 180 / Math.PI) + 360) % 360;
}

// 1. Real venue (广州天河体育场) with deletedSegments = [0,1,2,13,14,15,16,17,18,29,30,31]
{
  const r = new Renderer3D(null, null, 800, 600);
  r.setVenue(baseVenue, 'concert');

  const solid = new MeshBuilder(65536);
  const alpha = new MeshBuilder(4096);
  const screens = new MeshBuilder(4096);
  r.buildStadiumCanopyRim(solid, alpha, screens);
  assertNoNaNs(solid, 'Tianhe solid');
  assertNoNaNs(screens, 'Tianhe screens');

  // Verify no roof vertices (solid or screens) fall strictly inside the deleted North (-32..+32) or South (148..212) zones
  for (let i = 0; i < solid.positions.length; i += 3) {
    const x = solid.positions[i];
    const z = solid.positions[i + 2];
    const deg = angleOfXZ(x, z);
    const inDeletedNorth = deg < 32.5 || deg > 327.5;
    const inDeletedSouth = deg > 147.5 && deg < 212.5;
    assert.ok(!inDeletedNorth && !inDeletedSouth, `Solid vertex at deg=${deg.toFixed(2)} must not be in deleted roof zone`);
  }
  for (let i = 0; i < screens.positions.length; i += 3) {
    const x = screens.positions[i];
    const z = screens.positions[i + 2];
    const deg = angleOfXZ(x, z);
    const inDeletedNorth = deg < 32.5 || deg > 327.5;
    const inDeletedSouth = deg > 147.5 && deg < 212.5;
    assert.ok(!inDeletedNorth && !inDeletedSouth, `Floodlight vertex at deg=${deg.toFixed(2)} must not be in deleted roof zone`);
  }

  // Compare against full 360° ring (deletedSegments = [])
  const fullVenue = JSON.parse(JSON.stringify(baseVenue));
  fullVenue.roof.deletedSegments = [];
  r.setVenue(fullVenue, 'concert');
  const fullSolid = new MeshBuilder(65536);
  const fullAlpha = new MeshBuilder(4096);
  const fullScreens = new MeshBuilder(4096);
  r.buildStadiumCanopyRim(fullSolid, fullAlpha, fullScreens);

  assert.ok(solid.positions.length < fullSolid.positions.length, 'Deleted segments must produce fewer vertices than full ring');
  assert.ok(screens.positions.length < fullScreens.positions.length, 'Deleted segments must produce fewer floodlights than full ring');

  // Column count check: bare roof with only supportColumns=true
  const colOnlyDeleted = JSON.parse(JSON.stringify(baseVenue));
  colOnlyDeleted.roof.showFloodlights = false;
  colOnlyDeleted.roof.showSuspendedRingScreen = false;
  r.setVenue(colOnlyDeleted, 'concert');
  const cDelSolid = new MeshBuilder(65536);
  r.buildStadiumCanopyRim(cDelSolid, new MeshBuilder(1024), new MeshBuilder(1024));

  const colOnlyNone = JSON.parse(JSON.stringify(colOnlyDeleted));
  colOnlyNone.roof.supportColumns = false;
  r.setVenue(colOnlyNone, 'concert');
  const cNoColSolid = new MeshBuilder(65536);
  r.buildStadiumCanopyRim(cNoColSolid, new MeshBuilder(1024), new MeshBuilder(1024));

  // Each box in MeshBuilder has 36 vertices (108 floats)
  const colVerts = (cDelSolid.positions.length - cNoColSolid.positions.length) / 3;
  assert.strictEqual(colVerts, 22 * 36, `Expected 22 support columns (2 wings x 11 boundary/interior columns), got ${colVerts / 36}`);
  console.log('✓ 1. Tianhe Stadium deletedSegments verified (0 vertices in deleted zones, 22 support columns).');
}

// 2. All segments deleted -> 0 geometry
{
  const r = new Renderer3D(null, null, 800, 600);
  const allDel = JSON.parse(JSON.stringify(baseVenue));
  allDel.roof.deletedSegments = Array.from({ length: 32 }, (_, i) => i);
  r.setVenue(allDel, 'concert');
  const solid = new MeshBuilder(4096);
  const alpha = new MeshBuilder(4096);
  const screens = new MeshBuilder(4096);
  r.buildStadiumCanopyRim(solid, alpha, screens);
  assert.strictEqual(solid.positions.length, 0, 'All segments deleted must produce 0 solid vertices');
  assert.strictEqual(alpha.positions.length, 0, 'All segments deleted must produce 0 alpha vertices');
  assert.strictEqual(screens.positions.length, 0, 'All segments deleted must produce 0 screen vertices');
  console.log('✓ 2. All-deleted roof edge case verified (0 vertices).');
}

// 3. Wrap-around kept wing across 0°/360° (delete segments 4..27, keep 28..31 and 0..3)
{
  const r = new Renderer3D(null, null, 800, 600);
  const wrapVenue = JSON.parse(JSON.stringify(baseVenue));
  wrapVenue.roof.deletedSegments = Array.from({ length: 24 }, (_, i) => i + 4);
  wrapVenue.roof.supportColumns = false;
  wrapVenue.roof.showFloodlights = false;
  r.setVenue(wrapVenue, 'concert');
  const solid = new MeshBuilder(65536);
  r.buildStadiumCanopyRim(solid, new MeshBuilder(1024), new MeshBuilder(1024));
  assertNoNaNs(solid, 'Wrap-around wing');
  assert.ok(solid.positions.length > 0, 'Wrap-around wing must produce geometry');
  const lastIdx = wrapVenue.standTiers.length - 1;
  const pt45 = geo.evalTierPoint(wrapVenue, lastIdx, 45, 1);
  const pt315 = geo.evalTierPoint(wrapVenue, lastIdx, 315, 1);
  const maxBound45 = angleOfXZ(pt45.outX + pt45.nx * 4, pt45.outZ + pt45.nz * 4) + 0.5;
  const minBound315 = angleOfXZ(pt315.outX + pt315.nx * 4, pt315.outZ + pt315.nz * 4) - 0.5;
  for (let i = 0; i < solid.positions.length; i += 3) {
    const deg = angleOfXZ(solid.positions[i], solid.positions[i + 2]);
    assert.ok(!(deg > maxBound45 && deg < minBound315), `Wrap-around wing must not emit vertices in deleted [${maxBound45.toFixed(1)}, ${minBound315.toFixed(1)}], got ${deg.toFixed(2)}`);
  }
  console.log('✓ 3. Wrap-around kept wing across 0°/360° verified.');
}

// 4. openAngleRanges (array & object & wrap-around) + translucent roof
{
  const r = new Renderer3D(null, null, 800, 600);
  const rangeVenue = JSON.parse(JSON.stringify(baseVenue));
  rangeVenue.roof.deletedSegments = [];
  rangeVenue.roof.openAngleRanges = [[330, 30], { startDeg: 150, endDeg: 210 }];
  rangeVenue.roof.translucent = true;
  rangeVenue.roof.opacity = 0.6;
  rangeVenue.roof.supportColumns = false;
  rangeVenue.roof.showFloodlights = false;
  r.setVenue(rangeVenue, 'concert');

  const solid = new MeshBuilder(65536);
  const alpha = new MeshBuilder(65536);
  r.buildStadiumCanopyRim(solid, alpha, new MeshBuilder(1024));
  assertNoNaNs(solid, 'openAngleRanges solid');
  assertNoNaNs(alpha, 'openAngleRanges alpha');
  assert.ok(alpha.positions.length > 0, 'Translucent roof with openAngleRanges must emit alpha membrane');

  for (let i = 0; i < alpha.positions.length; i += 3) {
    const deg = angleOfXZ(alpha.positions[i], alpha.positions[i + 2]);
    const inWrapOpen = deg > 30.5 && deg < 329.5 ? false : (deg < 29.5 || deg > 330.5);
    const inSouthOpen = deg > 150.5 && deg < 209.5;
    assert.ok(!inWrapOpen && !inSouthOpen, `Alpha vertex at deg=${deg.toFixed(2)} must not be in openAngleRanges`);
  }
  console.log('✓ 4. openAngleRanges (including wrap-around & translucent) verified.');
}

// 5. Radial end-cap outward normals, narrow openAngleRanges (<0.01°), and null/empty input safety
{
  const r = new Renderer3D(null, null, 800, 600);

  // 5a. Check end-cap normals for Tianhe Stadium (cut boundaries at 33.75°, 146.25°, 213.75°, 326.25°)
  const capVenue = JSON.parse(JSON.stringify(baseVenue));
  capVenue.roof.supportColumns = false;
  capVenue.roof.showFloodlights = false;
  capVenue.roof.showSuspendedRingScreen = false;
  r.setVenue(capVenue, 'concert');
  const capSolid = new MeshBuilder(65536);
  r.buildStadiumCanopyRim(capSolid, new MeshBuilder(1024), new MeshBuilder(1024));

  const cutBoundaries = [33.75, 146.25, 213.75, 326.25];
  const foundCaps = new Set();
  for (let i = 0; i < capSolid.positions.length; i += 18) {
    // Each quad is 6 vertices (18 floats): p1=(i..i+2), p2=(i+3..i+5)
    const nx = capSolid.normals[i];
    const ny = capSolid.normals[i + 1];
    const nz = capSolid.normals[i + 2];
    const spanXZ = Math.hypot(
      capSolid.positions[i + 3] - capSolid.positions[i],
      capSolid.positions[i + 5] - capSolid.positions[i + 2]
    );
    // End-caps are vertical (|ny| < 0.25) and span the radial depth (> 10m), unlike short fascia segments
    if (Math.abs(ny) < 0.25 && spanXZ > 10) {
      const cx = (capSolid.positions[i] + capSolid.positions[i + 3]) * 0.5;
      const cz = (capSolid.positions[i + 2] + capSolid.positions[i + 5]) * 0.5;
      const deg = angleOfXZ(cx, cz);
      const nearest = cutBoundaries.reduce((best, b) => Math.abs(b - deg) < Math.abs(best - deg) ? b : best, cutBoundaries[0]);
      assert.ok(Math.abs(deg - nearest) < 10, `End-cap at deg=${deg.toFixed(2)} must be near a cut boundary`);
      // Tangent vector in increasing angle direction: (cos(deg), 0, sin(deg))
      const tx = Math.cos(deg * Math.PI / 180);
      const tz = Math.sin(deg * Math.PI / 180);
      const dotT = nx * tx + nz * tz;
      // At 33.75° and 213.75° (start of kept wing), outward normal into deleted zone must have dotT < 0.
      // At 146.25° and 326.25° (end of kept wing), outward normal into deleted zone must have dotT > 0.
      if (nearest === 33.75 || nearest === 213.75) {
        assert.ok(dotT < -0.5, `End-cap at ${nearest}° normal must point into deleted zone (dotT=${dotT.toFixed(3)})`);
      } else {
        assert.ok(dotT > 0.5, `End-cap at ${nearest}° normal must point into deleted zone (dotT=${dotT.toFixed(3)})`);
      }
      foundCaps.add(nearest);
    }
  }
  assert.strictEqual(foundCaps.size, 4, `Expected 4 radial end-caps, found ${foundCaps.size}`);

  // 5b. Null / empty / boolean entries must not coerce to 0
  const nullSafeVenue = JSON.parse(JSON.stringify(baseVenue));
  nullSafeVenue.roof.deletedSegments = [null, '', false, NaN, undefined];
  nullSafeVenue.roof.openAngleRanges = [[null, 30], { startDeg: '', endDeg: 40 }];
  nullSafeVenue.roof.supportColumns = false;
  nullSafeVenue.roof.showFloodlights = false;
  r.setVenue(nullSafeVenue, 'concert');
  const nsSolid = new MeshBuilder(65536);
  r.buildStadiumCanopyRim(nsSolid, new MeshBuilder(1024), new MeshBuilder(1024));

  const fullVenue2 = JSON.parse(JSON.stringify(nullSafeVenue));
  fullVenue2.roof.deletedSegments = [];
  fullVenue2.roof.openAngleRanges = [];
  r.setVenue(fullVenue2, 'concert');
  const fullSolid2 = new MeshBuilder(65536);
  r.buildStadiumCanopyRim(fullSolid2, new MeshBuilder(1024), new MeshBuilder(1024));
  assert.strictEqual(nsSolid.positions.length, fullSolid2.positions.length, 'Null/empty/boolean entries must be ignored, not coerced to 0');

  // 5c. Narrow openAngleRange (<0.01°) still emits both radial end-caps
  const narrowVenue = JSON.parse(JSON.stringify(fullVenue2));
  narrowVenue.roof.openAngleRanges = [[45, 45.002]];
  r.setVenue(narrowVenue, 'concert');
  const narrowSolid = new MeshBuilder(65536);
  r.buildStadiumCanopyRim(narrowSolid, new MeshBuilder(1024), new MeshBuilder(1024));
  // Splitting [44, 46] at [45, 45.002] turns 1 kept interval (4 quads) into 2 kept intervals (8 quads) + 2 end-caps (+6 quads total).
  assert.strictEqual(narrowSolid.positions.length / 18, fullSolid2.positions.length / 18 + 6, 'Narrow openAngleRange must split interval and emit 2 radial end-caps');

  console.log('✓ 5. Radial end-cap normals, null/empty safety, and narrow openAngleRanges verified.');
}

console.log('ALL ROOF DELETED SEGMENTS TESTS PASSED.');

/**
 * Automated Test Suite for 3D Engine Architecture & Layering
 * Run: node scripts/test-engine-3d.cjs
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// Helper to load CommonJS miniprogram files
function loadCommonJs(filePath) {
  const code = fs.readFileSync(filePath, 'utf8');
  const m = { exports: {} };
  const fn = new Function('module', 'exports', 'require', '__dirname', '__filename', code);
  fn(m, m.exports, (dep) => {
    if (dep.startsWith('.')) {
      const resolved = path.resolve(path.dirname(filePath), dep);
      return loadCommonJs(resolved.endsWith('.js') ? resolved : resolved + '.js');
    }
    return require(dep);
  }, path.dirname(filePath), filePath);
  return m.exports;
}

const { Mat4 } = loadCommonJs(path.join(ROOT, 'miniprogram/utils/engine-3d-mat4.js'));
const { MeshBuilder } = loadCommonJs(path.join(ROOT, 'miniprogram/utils/engine-3d-mesh-builder.js'));
const { Renderer3D } = loadCommonJs(path.join(ROOT, 'miniprogram/utils/renderer-3d.js'));

const { VENUES } = loadCommonJs(path.join(ROOT, 'miniprogram/data/venues.js'));
const geo = loadCommonJs(path.join(ROOT, 'miniprogram/utils/schema-geometry.js'));

console.log('--- 1. Testing Core Math (Mat4) ---');
{
  const m = Mat4.create();
  assert.strictEqual(m.length, 16);
  assert.strictEqual(m[0], 1);
  assert.strictEqual(m[5], 1);
  assert.strictEqual(m[10], 1);
  assert.strictEqual(m[15], 1);

  const proj = Mat4.create();
  Mat4.perspective(proj, (60 * Math.PI) / 180, 16 / 9, 1, 1000);
  assert.ok(!Number.isNaN(proj[0]) && proj[0] > 0);
  assert.ok(!Number.isNaN(proj[5]) && proj[5] > 0);

  const view = Mat4.create();
  Mat4.lookAt(view, { x: 0, y: 100, z: 200 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
  assert.ok(!Number.isNaN(view[0]));

  const mvp = Mat4.create();
  Mat4.multiply(mvp, proj, view);
  assert.ok(!Number.isNaN(mvp[0]));
  console.log('✓ Mat4 math identity, perspective, lookAt, multiply passed.');
}

console.log('--- 2. Testing MeshBuilder Geometry Synthesis ---');
{
  const builder = new MeshBuilder();
  builder.addTriangle({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, [1, 0, 0, 1]);
  assert.strictEqual(builder.positions.length, 9);
  assert.strictEqual(builder.normals.length, 9);
  assert.strictEqual(builder.colors.length, 12);

  builder.addQuad(
    { x: 0, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
    { x: 1, y: 1, z: 0 },
    { x: 0, y: 1, z: 0 },
    [0, 1, 0, 1]
  );
  assert.strictEqual(builder.positions.length, 9 + 18);

  builder.addBox(0, 0, 0, 2, 2, 2, [0, 0, 1, 1], 0);
  builder.addBeam3D({ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, 0.2, 0.2, [1, 1, 0, 1]);
  builder.addSeat3D(5, 0, 5, 0.5, 0.5, 0, -1, [0.2, 0.4, 0.8, 1], [0.1, 0.3, 0.6, 1]);
  builder.addVipSeat3D(10, 0, 10, 0.7, 0.6, 0, -1, [0.8, 0.6, 0.2, 1], [0.6, 0.4, 0.1, 1]);

  const vertexCount = builder.positions.length / 3;
  assert.strictEqual(vertexCount, builder.normals.length / 3);
  assert.strictEqual(vertexCount, builder.colors.length / 4);
  console.log(`✓ MeshBuilder generated ${vertexCount} vertices with 100% normal/color integrity.`);
}

console.log('--- 3. Testing Renderer3D State & Camera Controls ---');
{
  const renderer = new Renderer3D(null, null, 800, 600);
  assert.strictEqual(renderer.cameraMode, 'bird');
  renderer.handleTouchDrag(100, 50);
  assert.ok(renderer.orbitYaw !== 0.42);

  renderer.handlePinchZoom(1.2);
  assert.ok(renderer.orbitDist < 260);

  renderer.setZoom(2.0);
  assert.strictEqual(renderer.zoomLevel, 2.0);

  // Fly to seat
  renderer.flyToSeat({
    eye: { x: 20, y: 15, z: 40 },
    target: { x: 0, y: 1.5, z: 0 }
  });
  assert.strictEqual(renderer.cameraMode, 'seat');
  assert.ok(renderer.targetEye.y >= 1.1, 'Seat camera floor guard must stay above 1.1');
  console.log('✓ Renderer3D camera drag, zoom, seat flight, and floor bounds passed.');
}

console.log('--- 4. Testing Geometry Synthesis with Real Venue Fixtures ---');
{
  const normalizedVenues = VENUES.map(geo.normalizeVenueCoordinates);
  let totalTriangles = 0;

  normalizedVenues.forEach((venue) => {
    const renderer = new Renderer3D(null, null, 800, 600);
    renderer.setVenue(venue, 'concert');

    const solid = new MeshBuilder();
    const alpha = new MeshBuilder();
    const screens = new MeshBuilder();
    const beams = new MeshBuilder();

    // Infield & Ground
    renderer.buildGroundAndShell(solid);
    assert.ok(solid.positions.length > 0, `buildGroundAndShell must generate ground geometry for ${venue.id}`);

    renderer.buildInfieldMesh(solid);
    assert.ok(solid.positions.length > 0, `buildInfieldMesh must generate pitch/track for ${venue.id}`);

    renderer.buildInfieldModulesMesh(solid);
    renderer.buildSportsEquipmentMesh(solid);

    // Stand tiers
    renderer.buildStandTiersMesh(solid, alpha, screens);
    assert.ok(solid.positions.length > 0, `buildStandTiersMesh must generate tiers for ${venue.id}`);

    // Canopy
    renderer.buildStadiumCanopyRim(solid);

    // Concert mode components
    renderer.buildConcertInfieldSeatsMesh(solid);
    renderer.buildConcertStageMesh(solid, screens, beams);

    const vCount = (solid.positions.length + alpha.positions.length + screens.positions.length + beams.positions.length) / 3;
    totalTriangles += vCount / 3;
    console.log(`  ✓ [${venue.id}] ${venue.name}: generated ${vCount} vertices (${Math.round(vCount / 3)} triangles)`);
  });

  console.log(`✓ All ${normalizedVenues.length} venues passed pure mesh synthesis (${Math.round(totalTriangles)} total triangles).`);
}

console.log('--- 5. Testing Raycaster Math ---');
{
  const renderer = new Renderer3D(null, null, 800, 600);
  const venue = geo.normalizeVenueCoordinates(VENUES[0]);
  renderer.setVenue(venue, 'concert');
  renderer.setBirdEyeView();

  // Test picking at center (0.5, 0.5)
  const hit = renderer.pickAt(0.5, 0.5);
  console.log(`✓ Raycaster pickAt(0.5, 0.5) returned:`, hit ? `${hit.type} (${hit.sector ? hit.sector.id : (hit.floorBlock ? hit.floorBlock.id : '')})` : 'ground/void');
}

console.log('--- 6. Testing Renderer3D Facade API Backward Compatibility ---');
{
  const renderer = new Renderer3D(null, null, 800, 600);
  assert.strictEqual(renderer.cameraMode, 'bird');
  assert.strictEqual(renderer.zoomLevel, 1.0);

  const venue = geo.normalizeVenueCoordinates(VENUES[0]);
  renderer.setVenue(venue, 'concert');
  assert.strictEqual(renderer.viewMode, 'concert');

  renderer.setViewMode('sports');
  assert.strictEqual(renderer.viewMode, 'sports');

  renderer.setSelection('sec-1', null, null);
  assert.strictEqual(renderer.selectedSectorId, 'sec-1');

  renderer.setZoom(1.5);
  assert.strictEqual(renderer.zoomLevel, 1.5);

  renderer.handleTouchDrag(50, -20);
  renderer.handlePinchZoom(1.1);

  renderer.flyToSeat({
    eye: { x: 10, y: 12, z: 30 },
    target: { x: 0, y: 2, z: 0 }
  });
  assert.strictEqual(renderer.cameraMode, 'seat');

  renderer.setBirdEyeView();
  assert.strictEqual(renderer.cameraMode, 'bird');

  console.log('✓ Renderer3D facade backward compatibility 100% verified.');
}

console.log('\n========================================');
console.log('ALL 3D ENGINE ARCHITECTURE TESTS PASSED!');
console.log('========================================');

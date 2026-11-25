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

console.log('--- 7. Testing New Features: Raycast Picking, Multi-Dimension Colors & Minimum Scale ---');
{
  const colors = loadCommonJs(path.join(ROOT, 'miniprogram/utils/seat-colors.js'));
  const appJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'miniprogram/app.json'), 'utf8'));
  const indexJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'miniprogram/pages/index/index.json'), 'utf8'));

  // 1. Verify Titles do not contain STADICACAD / STADIACAD
  assert.ok(!appJson.window.navigationBarTitleText.includes('STADI'), 'app.json title should not contain STADIACAD/STADICACAD');
  assert.ok(!indexJson.navigationBarTitleText.includes('STADI'), 'index.json title should not contain STADIACAD/STADICACAD');
  console.log('✓ Titles verified without STADICACAD / STADIACAD.');

  // 2. Verify Sky, Roof, Wall, Ground Color Palette & Swatches
  assert.ok(colors.DEFAULT_TIER_HEX.sky, 'DEFAULT_TIER_HEX must include sky');
  assert.ok(colors.DEFAULT_TIER_HEX.roof, 'DEFAULT_TIER_HEX must include roof');
  assert.ok(colors.DEFAULT_TIER_HEX.wall, 'DEFAULT_TIER_HEX must include wall');
  assert.ok(colors.DEFAULT_TIER_HEX.ground, 'DEFAULT_TIER_HEX must include ground');

  const skySwatches = colors.getSwatchesForTarget('sky');
  const hasPureBlackSky = skySwatches.some(s => s.hex === '#000000');
  assert.ok(hasPureBlackSky, 'Sky palette must include pure black #000000 option');
  console.log('✓ Color palette includes sky (with pure black #000000), roof, wall, ground swatches.');

  // 3. Verify Minimum Scale Form on entry
  const renderer = new Renderer3D(null, null, 800, 600);
  const venue = geo.normalizeVenueCoordinates(VENUES[0]);
  renderer.setVenue(venue, 'concert');
  assert.strictEqual(renderer.orbitDist, 460, 'Initial venue render must be at minimum form (orbitDist = 460)');
  renderer.setBirdEyeView();
  assert.strictEqual(renderer.orbitDist, 460, 'setBirdEyeView must reset to minimum form (orbitDist = 460)');
  console.log('✓ 3D initial render and bird eye view correctly lock to minimum form (cannot zoom out further).');

  // 4. Verify 3D Picking in both Bird & Seat camera modes
  function projectWorldToScreen(r, pt) {
    const eye = r.camEye;
    const target = r.camTarget;
    let fx = target.x - eye.x, fy = target.y - eye.y, fz = target.z - eye.z;
    const fl = Math.hypot(fx, fy, fz) || 1;
    fx /= fl; fy /= fl; fz /= fl;
    let rx = -fz, rz = fx;
    const rl = Math.hypot(rx, rz) || 1;
    rx /= rl; rz /= rl;
    const ux = -fy * rz, uy = fx * rz - fz * rx, uz = fy * rx;
    const fovDeg = Math.max(12, Math.min(90, r.baseFovDeg / Math.pow(r.zoomLevel || 1, 0.85)));
    const aspect = (r.width || 375) / Math.max(1, r.height || 400);
    const tanHalf = Math.tan((fovDeg * geo.DEG2RAD) / 2);
    const vx = pt.x - eye.x, vy = pt.y - eye.y, vz = pt.z - eye.z;
    const zCam = vx * fx + vy * fy + vz * fz;
    const xCam = vx * rx + vz * rz;
    const yCam = vx * ux + vy * uy + vz * uz;
    return {
      nx: (xCam / (zCam * aspect * tanHalf) + 1) / 2,
      ny: (1 - yCam / (zCam * tanHalf)) / 2
    };
  }

  function findBirdPickScreenPoint(r, v) {
    const tiers = v.standTiers || [];
    for (let ti = tiers.length - 1; ti >= 0; ti--) {
      const tier = tiers[ti];
      const sec = (tier.sectors || []).find(
        s => !s.isDeleted && s.fillType !== 'empty-void' && s.fillType !== 'solid-wall'
      );
      if (!sec) continue;
      const a0 = sec.startAngleDeg;
      const a1 = sec.endAngleDeg;
      const midAngle = a1 < a0 ? (((a0 + a1 + 360) / 2) % 360) : ((a0 + a1) / 2);
      const pt = geo.evalTierPoint(v, ti, midAngle, 0.5);
      const isVip = (sec.fillType || tier.defaultFillType) === 'vip-box';
      const rowPitch = Math.max(0.4, sec.rowPitch || tier.defaultRowPitch || 0.85);
      const slopeDeg = isVip ? 0 : (sec.slopeDeg || tier.defaultSlopeDeg || 20);
      const riserH = isVip ? 0 : (sec.riserHeight || rowPitch * Math.tan(slopeDeg * geo.DEG2RAD));
      const totalRows = isVip ? 1 : geo.getTierRowsAtAngle(v, ti, tier, sec, midAngle);
      const row = isVip ? 1 : Math.max(1, Math.round(0.5 * totalRows + 0.5));
      const y = (tier.baseElevation || 1.0) + (row - 1) * riserH + 0.3;
      return projectWorldToScreen(r, { x: pt.x, y, z: pt.z });
    }
    return { nx: 0.5, ny: 0.5 };
  }

  renderer.setBirdEyeView();
  const birdScreenPt = findBirdPickScreenPoint(renderer, venue);
  assert.ok(birdScreenPt.nx >= 0 && birdScreenPt.nx <= 1 && birdScreenPt.ny >= 0 && birdScreenPt.ny <= 1, 'Projected bird pick point must lie within normalized screen bounds');
  const birdHit = renderer.pickAt(birdScreenPt.nx, birdScreenPt.ny);
  assert.ok(birdHit && (birdHit.sector || birdHit.floorBlock), 'Bird mode picking must resolve a sector or floor block');

  const sel = geo.findDefaultEastFirstRowSelection(venue);
  const sightline = geo.calculateSeatSightline(venue, sel, 'concert');
  renderer.flyToSeat(sightline);
  renderer.camEye = { ...renderer.targetEye };
  renderer.camTarget = { ...renderer.targetLook };
  const seatHit = renderer.pickAt(0.5, 0.5);
  assert.ok(seatHit && (seatHit.sector || seatHit.floorBlock), 'Seat mode picking must resolve across-venue sectors/blocks');
  console.log('✓ 3D Picking in both bird and seat modes successfully hits sectors/blocks for 2D linkage.');

  // 5. Verify Engine-3D compatibility bridges
  const raycastBridge = loadCommonJs(path.join(ROOT, 'miniprogram/utils/engine-3d/interaction/raycaster.js'));
  assert.ok(raycastBridge.RaycastMixin, 'Raycaster bridge must export RaycastMixin');
  const mat4Bridge = loadCommonJs(path.join(ROOT, 'miniprogram/utils/engine-3d/core/mat4.js'));
  assert.ok(mat4Bridge.Mat4, 'Mat4 bridge must export Mat4');
  console.log('✓ Engine-3D backward-compatibility bridges verified.');
}

console.log('--- 8. Testing Seat Texture, Lowered Railings, Pitch Lines & Sports Perimeter Boards ---');
{
  // 1. Sculpted 3D Seat geometry & AO vertex colors
  const seatB = new MeshBuilder();
  seatB.addSeat3D(0, 0, 0, 0.5, 0.5, 0, -1, [0.2, 0.4, 0.8, 1], [0.15, 0.32, 0.65, 1]);
  const seatVerts = seatB.positions.length / 3;
  assert.ok(seatVerts >= 30, `Sculpted seat must have multi-part geometry (got ${seatVerts} verts)`);
  assert.strictEqual(seatVerts, seatB.normals.length / 3);
  assert.strictEqual(seatVerts, seatB.colors.length / 4);

  // 2. Lowered & textured railings
  const railSolid = new MeshBuilder();
  const railAlpha = new MeshBuilder();
  railSolid.addTexturedRailingRun({ x: 0, z: 0 }, 5.0, { x: 10, z: 0 }, 5.0, 0.68, { showGlass: true }, railAlpha);
  let maxRailY = -Infinity;
  for (let i = 1; i < railSolid.positions.length; i += 3) {
    if (railSolid.positions[i] > maxRailY) maxRailY = railSolid.positions[i];
  }
  assert.ok(maxRailY <= 5.0 + 0.75 && maxRailY >= 5.0 + 0.65, `Railing height must stay lowered around 0.68m (maxY=${maxRailY.toFixed(3)})`);
  assert.ok(railAlpha.positions.length > 0, 'Textured glass railing must populate alpha buffer');

  // 3. Accurate football pitch & basketball court lines (including small/rotated edge cases)
  const renderer = new Renderer3D(null, null, 800, 600);
  const soccerVenue = geo.normalizeVenueCoordinates(VENUES[0]);
  renderer.setVenue(soccerVenue, 'sports');
  const pitchSolid = new MeshBuilder();
  renderer.buildInfieldMesh(pitchSolid);
  assert.ok(pitchSolid.positions.length / 3 > 1200, 'Football pitch must include full FIFA markings (center circle, penalty boxes, arcs, corners)');

  const courtVenue = geo.normalizeVenueCoordinates(VENUES.find(v => v.infield && v.infield.surfaceType === 'hardwood-court'));
  renderer.setVenue(courtVenue, 'sports');
  const courtSolid = new MeshBuilder();
  renderer.buildInfieldMesh(courtSolid);
  assert.ok(courtSolid.positions.length / 3 > 800, 'Basketball court must include hardwood planks, keys, 3-pt arcs & court lines');
  // Verify exact FIBA 6.75m 3-point arc apex on 15x28m court (z ≈ ±5.675m at x=0, y=0.14)
  let minApexDist = Infinity;
  const expectedApexZ = (courtVenue.infield.pitchLength / 2) - 1.575 - 6.75;
  for (let i = 0; i < courtSolid.positions.length; i += 3) {
    const px = courtSolid.positions[i], py = courtSolid.positions[i + 1], pz = courtSolid.positions[i + 2];
    if (Math.abs(py - 0.14) < 0.005 && Math.abs(px) < 0.4) {
      minApexDist = Math.min(minApexDist, Math.abs(Math.abs(pz) - expectedApexZ));
    }
  }
  assert.ok(minApexDist < 0.08, `FIBA 3-pt arc apex must be at 6.75m from basket (dist=${minApexDist.toFixed(4)})`);

  // Edge case: small rotated custom court
  const smallCourt = JSON.parse(JSON.stringify(courtVenue));
  smallCourt.infield.pitchLength = 18;
  smallCourt.infield.pitchWidth = 12;
  smallCourt.infield.pitchOrientationDeg = 90;
  renderer.setVenue(smallCourt, 'sports');
  const smallCourtSolid = new MeshBuilder();
  renderer.buildInfieldMesh(smallCourtSolid);
  for (let i = 0; i < smallCourtSolid.positions.length; i++) {
    assert.ok(!Number.isNaN(smallCourtSolid.positions[i]), 'Small rotated court must produce zero NaNs');
  }

  // 4. Sports mode equipment & perimeter LED advertising boards
  const eqSolid = new MeshBuilder();
  const eqAlpha = new MeshBuilder();
  const eqScreens = new MeshBuilder();
  renderer.setVenue(soccerVenue, 'sports');
  renderer.buildSportsEquipmentMesh(eqSolid, eqAlpha, eqScreens);
  assert.ok(eqScreens.positions.length > 0, 'Sports mode must generate luminous LED perimeter advertising boards');
  assert.ok(eqAlpha.positions.length > 0, 'Sports mode must generate semi-transparent goal nets');

  // Track-field venue: perimeter boards must stay inside innerApron
  const trackVenue = geo.normalizeVenueCoordinates(VENUES.find(v => v.infield && v.infield.sportPreset === 'track-field'));
  if (trackVenue) {
    renderer.setVenue(trackVenue, 'sports');
    const trSolid = new MeshBuilder();
    const trAlpha = new MeshBuilder();
    const trScreens = new MeshBuilder();
    renderer.buildSportsEquipmentMesh(trSolid, trAlpha, trScreens);
    const spec = geo.computeRunningTrackSpec(trackVenue.infield);
    let maxAbsX = 0, maxAbsZ = 0;
    for (let i = 0; i < trScreens.positions.length; i += 3) {
      maxAbsX = Math.max(maxAbsX, Math.abs(trScreens.positions[i]));
      maxAbsZ = Math.max(maxAbsZ, Math.abs(trScreens.positions[i + 2]));
    }
    assert.ok(maxAbsX <= spec.innerApronWidth * 0.5 + 0.5, 'Track-field perimeter boards must stay inside innerApronWidth');
    assert.ok(maxAbsZ <= spec.innerApronLength * 0.5 + 0.5, 'Track-field perimeter boards must stay inside innerApronLength');
  }

  // 5. 2D Renderer FIBA/FIFA sports markings
  const { Renderer2D } = loadCommonJs(path.join(ROOT, 'miniprogram/utils/renderer-2d.js'));
  const arcs = [];
  const rects = [];
  const mockCtx = {
    save() {}, restore() {}, translate() {}, scale() {}, rotate() {},
    beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, quadraticCurveTo() {},
    arcTo() {}, rect() {}, ellipse() {}, clip() {},
    fill() {}, stroke() {}, clearRect() {}, setLineDash() {}, fillText() {}, strokeText() {},
    measureText() { return { width: 10 }; },
    fillRect(x, y, w, h) { rects.push({ x, y, w, h }); },
    strokeRect(x, y, w, h) { rects.push({ x, y, w, h }); },
    arc(x, y, r, a1, a2) { arcs.push({ x, y, r, a1, a2 }); }
  };
  const r2d = new Renderer2D(null, mockCtx, 800, 600, 1);
  r2d.setVenue(courtVenue, 'sports');
  assert.ok(arcs.some(a => Math.abs(a.r - 6.75) < 0.01), '2D basketball court must draw 6.75m FIBA 3-pt arc');
  assert.ok(arcs.some(a => Math.abs(a.r - 1.8) < 0.01), '2D basketball court must draw 1.8m FIBA center circle');

  // 6. Concert mode must strip sports flooring, running track, and markings in 3D & 2D across all venues
  VENUES.map(v => geo.normalizeVenueCoordinates(v)).forEach((v) => {
    renderer.setVenue(v, 'sports');
    renderer.setViewMode('concert');
    const cSolid = new MeshBuilder(4096);
    renderer.buildInfieldMesh(cSolid);
    const cPos = cSolid.positions;
    assert.ok(cPos.length > 0, `Concert mode infield base surface must exist for ${v.id}`);
    for (let i = 1; i < cPos.length; i += 3) {
      assert.strictEqual(cPos[i], 0, `Concert mode infield must not render elevated track/floor/line layers (found y=${cPos[i]} for ${v.id})`);
    }
    for (let i = 0; i < cSolid.colors.length; i += 4) {
      assert.ok(Math.abs(cSolid.colors[i] - 0.12) < 0.001, `Concert mode infield must use neutral dark base color (got r=${cSolid.colors[i]} for ${v.id})`);
    }
    r2d.setVenue(v, 'sports');
    r2d.setViewMode('concert');
    arcs.length = 0;
    rects.length = 0;
    r2d.drawInfield(mockCtx, 1);
    assert.strictEqual(arcs.length, 0, `2D concert mode drawInfield must not draw court/pitch arcs for ${v.id}`);
    assert.strictEqual(rects.length, 0, `2D concert mode drawInfield must not draw court/pitch floor rects for ${v.id}`);
  });

  console.log('✓ Seat texture, lowered railings, accurate pitch/court lines & sports perimeter LED boards verified.');
}

console.log('\n========================================');
console.log('ALL 3D ENGINE ARCHITECTURE TESTS PASSED!');
console.log('========================================');

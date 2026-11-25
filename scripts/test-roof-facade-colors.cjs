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
const { Renderer2D } = loadCommonJs(path.join(ROOT, 'miniprogram/utils/renderer-2d.js'));
const { parseHexRgb, hexToSeat2D } = loadCommonJs(path.join(ROOT, 'miniprogram/utils/seat-colors.js'));

const baseVenue = geo.normalizeVenueCoordinates(VENUES[0]);

function assertNoNaNs(mb, label) {
  for (let i = 0; i < mb.positions.length; i++) {
    assert.ok(!Number.isNaN(mb.positions[i]), `${label} position[${i}] must not be NaN`);
  }
  for (let i = 0; i < mb.colors.length; i++) {
    assert.ok(!Number.isNaN(mb.colors[i]), `${label} color[${i}] must not be NaN`);
  }
}

function hasColorCloseTo(mb, hex, tol = 0.02) {
  const rgb = parseHexRgb(hex);
  const tr = rgb.r / 255, tg = rgb.g / 255, tb = rgb.b / 255;
  const cols = mb.colors;
  for (let i = 0; i < cols.length; i += 4) {
    if (
      Math.abs(cols[i] - tr) < tol &&
      Math.abs(cols[i + 1] - tg) < tol &&
      Math.abs(cols[i + 2] - tb) < tol
    ) {
      return true;
    }
  }
  return false;
}

console.log('--- 1. Testing Roof Schema Support ---');
{
  const r = new Renderer3D(null, null, 800, 600);
  r.setVenue(baseVenue, 'concert');

  const solid = new MeshBuilder(65536);
  const alpha = new MeshBuilder(4096);
  const screens = new MeshBuilder(4096);
  r.buildStadiumCanopyRim(solid, alpha, screens);

  assert.ok(solid.positions.length > 0, 'Enabled roof must generate solid geometry');
  assert.ok(screens.positions.length > 0, 'showFloodlights=true must generate floodlight geometry in screens');
  assert.strictEqual(alpha.positions.length, 0, 'translucent=false roof must not emit alpha geometry');
  assert.ok(hasColorCloseTo(solid, baseVenue.roof.color), 'Roof must use venue.roof.color (#334155)');
  assert.ok(hasColorCloseTo(solid, baseVenue.roof.trussColor), 'Roof trusses must use venue.roof.trussColor (#94a3b8)');
  assertNoNaNs(solid, 'Roof solid');
  assertNoNaNs(screens, 'Roof screens');

  // Override roof color via tierColorOverrides
  r.tierColorOverrides = { roof: '#C82834' };
  const solidOverride = new MeshBuilder(65536);
  const screensOverride = new MeshBuilder(4096);
  r.buildStadiumCanopyRim(solidOverride, alpha, screensOverride);
  assert.ok(hasColorCloseTo(solidOverride, '#C82834'), 'tierColorOverrides.roof must override venue.roof.color');

  // Translucent roof + suspended ring screen
  const transVenue = JSON.parse(JSON.stringify(baseVenue));
  transVenue.roof.translucent = true;
  transVenue.roof.opacity = 0.55;
  transVenue.roof.showSuspendedRingScreen = true;
  r.tierColorOverrides = {};
  r.setVenue(transVenue, 'concert');
  const tSolid = new MeshBuilder(65536);
  const tAlpha = new MeshBuilder(4096);
  const tScreens = new MeshBuilder(4096);
  r.buildStadiumCanopyRim(tSolid, tAlpha, tScreens);
  assert.ok(tAlpha.positions.length > 0, 'translucent=true roof must emit membrane into alpha builder');
  assert.ok(Math.abs(tAlpha.colors[3] - 0.55) < 0.02, 'translucent roof alpha must match roof.opacity');
  assert.ok(tScreens.positions.length > screens.positions.length, 'showSuspendedRingScreen=true must add center-hung screen');

  // Disabled roof
  const noRoofVenue = JSON.parse(JSON.stringify(baseVenue));
  noRoofVenue.roof.enabled = false;
  r.setVenue(noRoofVenue, 'concert');
  const dSolid = new MeshBuilder(4096);
  const dAlpha = new MeshBuilder(4096);
  const dScreens = new MeshBuilder(4096);
  r.buildStadiumCanopyRim(dSolid, dAlpha, dScreens);
  assert.strictEqual(dSolid.positions.length, 0, 'roof.enabled=false must produce 0 roof vertices');

  // Roof toggles disabled (showTrusses=false, supportColumns=false, showFloodlights=false)
  const bareRoofVenue = JSON.parse(JSON.stringify(baseVenue));
  bareRoofVenue.roof.showTrusses = false;
  bareRoofVenue.roof.supportColumns = false;
  bareRoofVenue.roof.showFloodlights = false;
  r.setVenue(bareRoofVenue, 'concert');
  const bSolid = new MeshBuilder(65536);
  const bAlpha = new MeshBuilder(4096);
  const bScreens = new MeshBuilder(4096);
  r.buildStadiumCanopyRim(bSolid, bAlpha, bScreens);
  assert.ok(bSolid.positions.length > 0 && bSolid.positions.length < solid.positions.length, 'Disabling trusses & columns must reduce solid vertex count');
  assert.strictEqual(bScreens.positions.length, 0, 'showFloodlights=false & showSuspendedRingScreen=false must emit 0 screen vertices');
  console.log('✓ Roof schema (enabled, color, trusses, columns, floodlights, translucent, ring screen, override) verified.');
}

console.log('--- 2. Testing Exterior Facade Schema Support ---');
{
  const r = new Renderer3D(null, null, 800, 600);
  r.setVenue(baseVenue, 'concert');

  const solid = new MeshBuilder(65536);
  const alpha = new MeshBuilder(4096);
  r.buildExteriorFacadeShell(solid, alpha);

  assert.ok(solid.positions.length > 0, 'Enabled facade must generate solid geometry');
  assert.strictEqual(alpha.positions.length, 0, 'opacity=1 facade must not emit alpha geometry');
  assert.ok(hasColorCloseTo(solid, baseVenue.facade.wallColor), 'Facade must use venue.facade.wallColor (#f6eee3)');
  assertNoNaNs(solid, 'Facade solid');

  // Override wall color via tierColorOverrides
  r.tierColorOverrides = { wall: '#1E293B' };
  const solidOverride = new MeshBuilder(65536);
  r.buildExteriorFacadeShell(solidOverride, alpha);
  assert.ok(hasColorCloseTo(solidOverride, '#1E293B'), 'tierColorOverrides.wall must override venue.facade.wallColor');

  // Translucent facade
  const transFacadeVenue = JSON.parse(JSON.stringify(baseVenue));
  transFacadeVenue.facade.opacity = 0.6;
  r.tierColorOverrides = {};
  r.setVenue(transFacadeVenue, 'concert');
  const fSolid = new MeshBuilder(65536);
  const fAlpha = new MeshBuilder(4096);
  r.buildExteriorFacadeShell(fSolid, fAlpha);
  assert.ok(fAlpha.positions.length > 0, 'facade.opacity < 1 must emit wall into alpha builder');
  assert.ok(Math.abs(fAlpha.colors[3] - 0.6) < 0.02, 'facade alpha must match facade.opacity');

  // Disabled facade
  const noFacadeVenue = JSON.parse(JSON.stringify(baseVenue));
  noFacadeVenue.facade.enabled = false;
  r.setVenue(noFacadeVenue, 'concert');
  const dSolid = new MeshBuilder(4096);
  r.buildExteriorFacadeShell(dSolid, alpha);
  assert.strictEqual(dSolid.positions.length, 0, 'facade.enabled=false must produce 0 facade vertices');

  // Facade without pilasters
  const noPilasterVenue = JSON.parse(JSON.stringify(baseVenue));
  noPilasterVenue.facade.showPilasters = false;
  r.setVenue(noPilasterVenue, 'concert');
  const npSolid = new MeshBuilder(65536);
  r.buildExteriorFacadeShell(npSolid, alpha);
  assert.ok(npSolid.positions.length > 0 && npSolid.positions.length < solid.positions.length, 'showPilasters=false must reduce facade vertex count');
  console.log('✓ Facade schema (enabled, wallColor, heightExtensionM, pilasters, opacity, override) verified.');
}

console.log('--- 3. Testing Stand & Infield Default Seat Colors ---');
{
  const r = new Renderer3D(null, null, 800, 600);
  r.setVenue(baseVenue, 'concert');
  const standSolid = new MeshBuilder(1048576);
  const standAlpha = new MeshBuilder(16384);
  const standScreens = new MeshBuilder(16384);
  r.buildStandTiersMesh(standSolid, standAlpha, standScreens);
  assert.ok(hasColorCloseTo(standSolid, '#1e3a8a'), '3D stand tiers must use tier.seatColor (#1e3a8a)');

  // Test per-sector override & user override priority
  const customSecVenue = JSON.parse(JSON.stringify(baseVenue));
  customSecVenue.standTiers[0].sectors[0].seatColor = '#C82834';
  r.setVenue(customSecVenue, 'concert');
  const secSolid = new MeshBuilder(1048576);
  r.buildStandTiersMesh(secSolid, standAlpha, standScreens);
  assert.ok(hasColorCloseTo(secSolid, '#C82834'), '3D sector seatColor must override tier.seatColor');

  // User tierColorOverrides must override sector seatColor (priority: user override > sector seatColor > tier seatColor)
  r.tierColorOverrides = { '1': '#178063' };
  const userOverrideSolid = new MeshBuilder(1048576);
  r.buildStandTiersMesh(userOverrideSolid, standAlpha, standScreens);
  assert.ok(hasColorCloseTo(userOverrideSolid, '#178063'), 'tierColorOverrides[1] must override sector seatColor');
  assert.ok(!hasColorCloseTo(userOverrideSolid, '#C82834'), 'sector seatColor must not beat tierColorOverrides[1]');
  r.tierColorOverrides = {};

  // Test 2D Renderer uses tier.seatColor and infield.defaultSeatColor
  const fillColors = [];
  const mockCtx = {
    save() {}, restore() {}, translate() {}, scale() {}, rotate() {},
    beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, quadraticCurveTo() {},
    arcTo() {}, rect() {}, ellipse() {}, clip() {},
    fill() { fillColors.push(this.fillStyle); },
    stroke() {}, clearRect() {}, setLineDash() {}, fillText() {}, strokeText() {},
    measureText() { return { width: 10 }; },
    fillRect() { fillColors.push(this.fillStyle); },
    strokeRect() {}, arc() {},
    set fillStyle(v) { this._fs = v; },
    get fillStyle() { return this._fs; }
  };
  const r2d = new Renderer2D(null, mockCtx, 800, 600, 1);
  r2d.setVenue(baseVenue, 'concert');
  const expected2DBase = hexToSeat2D('#1e3a8a').base.toLowerCase();
  assert.ok(
    fillColors.some(c => String(c).toLowerCase() === expected2DBase),
    `2D renderer must render stand tiers with hexToSeat2D(tier.seatColor).base (${expected2DBase})`
  );

  // Test infield.defaultSeatColor fallback when module has no color (concert & sports modes)
  const noModColorVenue = JSON.parse(JSON.stringify(baseVenue));
  noModColorVenue.infieldModules.forEach(m => { delete m.color; });
  r.setVenue(noModColorVenue, 'concert');
  const floorSolid = new MeshBuilder(131072);
  r.buildConcertInfieldSeatsMesh(floorSolid, new MeshBuilder(4096));
  assert.ok(hasColorCloseTo(floorSolid, '#1e3a8a'), 'Infield seats without mod.color must fall back to infield.defaultSeatColor');

  noModColorVenue.infieldModules.push({
    id: 'sports-sideline-test',
    name: 'Sideline Test',
    type: 'flat',
    x: 0,
    y: -14,
    width: 10,
    depth: 4,
    rotationDeg: 0,
    rows: 4,
    seatSpacing: 0.55,
    rowPitch: 0.9,
    baseElevation: 0,
    slopeDeg: 0,
    autoGeneratedForStage: false
  });
  r.setVenue(noModColorVenue, 'sports');
  const sportsModSolid = new MeshBuilder(65536);
  r.buildInfieldModulesMesh(sportsModSolid, new MeshBuilder(4096));
  assert.ok(hasColorCloseTo(sportsModSolid, '#1e3a8a'), 'Sports sideline modules without mod.color must fall back to infield.defaultSeatColor');

  // Test Page buildColorPickerState reflects schema defaults and user overrides
  let capturedPageDef = null;
  const indexPath = path.join(ROOT, 'miniprogram/pages/index/index.js');
  const indexSrc = fs.readFileSync(indexPath, 'utf8');
  const indexDir = path.dirname(indexPath);
  const pageRequire = (id) => {
    if (id.startsWith('.')) {
      let target = path.resolve(indexDir, id);
      if (!fs.existsSync(target) && fs.existsSync(target + '.js')) target += '.js';
      return loadCommonJs(target);
    }
    return require(id);
  };
  const prevWx = global.wx;
  const prevPage = global.Page;
  global.wx = { getStorageSync: () => null, setStorageSync: () => {} };
  global.Page = (def) => { capturedPageDef = def; };
  try {
    new Function('module', 'exports', 'require', indexSrc)({ exports: {} }, {}, pageRequire);
  } finally {
    global.wx = prevWx;
    global.Page = prevPage;
  }
  assert.ok(capturedPageDef && typeof capturedPageDef.buildColorPickerState === 'function', 'index.js must define buildColorPickerState');
  const pageCtx = { getSavedVenueColors: () => ({}) };
  const pickerState = capturedPageDef.buildColorPickerState.call(pageCtx, baseVenue, 'roof', {}, 'default');
  const targetHex = (k) => (pickerState.colorTargets.find(t => t.key === k) || {}).hex;
  assert.strictEqual(targetHex('1'), '#1e3a8a', 'Color picker 1F target must default to tier.seatColor');
  assert.strictEqual(targetHex('2'), '#1e3a8a', 'Color picker 2F VIP target must default to tier.seatColor');
  assert.strictEqual(targetHex('floor'), '#1e3a8a', 'Color picker floor target must default to infield.defaultSeatColor');
  assert.strictEqual(targetHex('roof'), '#334155', 'Color picker roof target must default to roof.color');
  assert.strictEqual(targetHex('wall'), '#f6eee3', 'Color picker wall target must default to facade.wallColor');

  const overridePicker = capturedPageDef.buildColorPickerState.call(pageCtx, baseVenue, 'roof', { roof: '#0F172A', wall: '#CBD5E1' }, 'custom');
  assert.strictEqual((overridePicker.colorTargets.find(t => t.key === 'roof') || {}).hex, '#0F172A', 'Color picker roof override must take precedence');
  assert.strictEqual((overridePicker.colorTargets.find(t => t.key === 'wall') || {}).hex, '#CBD5E1', 'Color picker wall override must take precedence');

  console.log('✓ Stand tier seatColor, sector seatColor & infield defaultSeatColor verified in 2D & 3D.');
}

console.log('\n========================================');
console.log('ALL ROOF, FACADE & SEAT COLOR TESTS PASSED!');
console.log('========================================');

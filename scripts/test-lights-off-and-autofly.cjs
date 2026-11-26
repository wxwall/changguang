/**
 * Automated Test Suite for:
 * 1. Auto-fly to selected seat 2s after venue switch (index.js)
 * 2. Lights-off scene ('lights-off') turning off stadium lights while keeping stage lights lit
 *
 * Run: node scripts/test-lights-off-and-autofly.cjs
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const moduleCache = new Map();
function loadCommonJs(absPath) {
  const abs = absPath.endsWith('.js') ? absPath : `${absPath}.js`;
  if (moduleCache.has(abs)) return moduleCache.get(abs).exports;
  const src = fs.readFileSync(abs, 'utf8');
  const mod = { exports: {} };
  moduleCache.set(abs, mod);
  const req = (spec) => {
    if (spec.startsWith('.')) {
      const resolved = path.resolve(path.dirname(abs), spec);
      return loadCommonJs(resolved);
    }
    return require(spec);
  };
  new Function('module', 'exports', 'require', '__dirname', '__filename', src)(mod, mod.exports, req, path.dirname(abs), abs);
  return mod.exports;
}

const { Renderer3D } = loadCommonJs(path.join(ROOT, 'miniprogram/utils/renderer-3d.js'));
const { getAllVenues } = loadCommonJs(path.join(ROOT, 'miniprogram/data/venues.js'));
const { SceneManager, LightsOffScene } = loadCommonJs(path.join(ROOT, 'miniprogram/utils/scenes/index.js'));

const venues = getAllVenues();
const sampleVenue = venues[0];

function createMockGL() {
  const uniforms = {};
  let nextLoc = 1;
  const locNames = new Map();
  return {
    VERTEX_SHADER: 1,
    FRAGMENT_SHADER: 2,
    ARRAY_BUFFER: 3,
    STATIC_DRAW: 4,
    DYNAMIC_DRAW: 5,
    DEPTH_TEST: 6,
    LEQUAL: 7,
    TRIANGLES: 8,
    FLOAT: 9,
    BLEND: 10,
    SRC_ALPHA: 11,
    ONE_MINUS_SRC_ALPHA: 12,
    ONE: 13,
    COLOR_BUFFER_BIT: 14,
    DEPTH_BUFFER_BIT: 15,
    _uniforms: uniforms,
    _clearColor: null,
    createShader: () => ({}),
    shaderSource: () => {},
    compileShader: () => {},
    createProgram: () => ({}),
    attachShader: () => {},
    linkProgram: () => {},
    useProgram: () => {},
    getAttribLocation: () => 0,
    getUniformLocation: (_prog, name) => {
      const id = nextLoc++;
      locNames.set(id, name);
      return id;
    },
    enable: () => {},
    disable: () => {},
    depthFunc: () => {},
    depthMask: () => {},
    blendFunc: () => {},
    viewport: () => {},
    clearColor: (r, g, b, a) => { uniforms._clearColor = [r, g, b, a]; },
    clear: () => {},
    createBuffer: () => ({}),
    deleteBuffer: () => {},
    bindBuffer: () => {},
    bufferData: () => {},
    bufferSubData: () => {},
    enableVertexAttribArray: () => {},
    vertexAttribPointer: () => {},
    drawArrays: () => {},
    uniform1f: (loc, v) => { uniforms[locNames.get(loc)] = v; },
    uniform3f: (loc, x, y, z) => { uniforms[locNames.get(loc)] = [x, y, z]; },
    uniformMatrix4fv: () => {}
  };
}

console.log('--- 1. Testing LightsOffScene Registration & Properties ---');
{
  const mgr = new SceneManager();
  const available = mgr.getAvailableScenes();
  assert.ok(available.some(s => s.id === 'lights-off'), 'SceneManager must register lights-off');
  assert.strictEqual(mgr.setCurrentScene('lights-off'), true);
  assert.ok(mgr.getCurrentScene() instanceof LightsOffScene);
  const clear = mgr.getClearColor();
  assert.ok(clear[0] < 0.05 && clear[1] < 0.05 && clear[2] < 0.05, 'Clear color must be deep blackout');
  console.log('✓ LightsOffScene registration and blackout clear color verified.');
}

console.log('--- 2. Testing Renderer3D Lights-Off Mode (Concert vs Sports) ---');
{
  const gl = createMockGL();
  const r3d = new Renderer3D(null, gl, 375, 260);
  r3d.setVenue(sampleVenue, 'concert');

  const normalScreenCount = r3d.screenBuffers ? r3d.screenBuffers.count : 0;
  const normalBeamCount = r3d.beamBuffers ? r3d.beamBuffers.count : 0;
  assert.ok(normalScreenCount > 0, 'Normal concert mode should have luminous screens');
  assert.ok(normalBeamCount > 0, 'Normal concert mode should have stage beams');

  // Switch to lights-off in concert mode
  assert.strictEqual(r3d.setScene('lights-off'), true);
  assert.strictEqual(r3d.isLightsOffScene(), true);

  const offConcertScreenCount = r3d.screenBuffers ? r3d.screenBuffers.count : 0;
  const offConcertBeamCount = r3d.beamBuffers ? r3d.beamBuffers.count : 0;
  assert.ok(offConcertScreenCount > 0, 'Lights-off concert mode must keep stage screens/strips lit');
  assert.ok(offConcertScreenCount < normalScreenCount, 'Lights-off concert mode must turn off stadium screens/cove/floodlights');
  assert.strictEqual(offConcertBeamCount, normalBeamCount, 'Lights-off concert mode must preserve all stage spotlight beams');

  r3d.renderFrame();
  assert.strictEqual(gl._uniforms.uLightsOff, 1.0, 'uLightsOff uniform must be 1.0 in lights-off scene');
  assert.strictEqual(gl._uniforms.uStageGlow, 1.0, 'uStageGlow uniform must be 1.0 in concert lights-off');
  assert.ok(Array.isArray(gl._uniforms.uStagePos), 'uStagePos uniform must be set');

  // Switch to sports mode in lights-off scene (no stage -> 0 luminous screens)
  r3d.setViewMode('sports');
  const offSportsScreenCount = r3d.screenBuffers ? r3d.screenBuffers.count : 0;
  assert.strictEqual(offSportsScreenCount, 0, 'Lights-off sports mode must turn off all stadium lights/screens (0 unlit vertices)');
  r3d.renderFrame();
  assert.strictEqual(gl._uniforms.uLightsOff, 1.0);
  assert.strictEqual(gl._uniforms.uStageGlow, 0.0, 'uStageGlow must be 0.0 in sports mode');

  // Switch back to floating-island
  r3d.setViewMode('concert');
  r3d.setScene('floating-island');
  r3d.renderFrame();
  assert.strictEqual(gl._uniforms.uLightsOff, 0.0, 'uLightsOff must return to 0.0 in floating-island');
  console.log('✓ Renderer3D lights-off shader uniforms & mesh filtering verified.');
}

console.log('--- 3. Testing Page index.js Auto-Fly (2s) & 3-Scene Toggle ---');
(async () => {
  let capturedPageDef = null;
  global.Page = (def) => { capturedPageDef = def; };
  global.wx = {
    getStorageSync: () => null,
    setStorageSync: () => {},
    showLoading: () => {},
    hideLoading: () => {},
    showToast: () => {},
    getSystemInfoSync: () => ({ pixelRatio: 2 })
  };

  // Load index.js with mocked Page & wx
  loadCommonJs(path.join(ROOT, 'miniprogram/pages/index/index.js'));
  assert.ok(capturedPageDef, 'Page() should be registered');

  // Create synthetic page instance
  const page = Object.assign({}, capturedPageDef);
  page.data = JSON.parse(JSON.stringify(capturedPageDef.data));
  page.setData = function (patch, cb) {
    Object.assign(this.data, patch);
    if (typeof cb === 'function') cb();
  };

  const venueA = Object.assign({}, sampleVenue, { id: 'venue-a', _id: 'doc-a', shortLabel: 'A馆' });
  const venueB = Object.assign({}, sampleVenue, { id: 'venue-b', _id: 'doc-b', shortLabel: 'B馆' });
  page._venues = [venueA, venueB];
  page._currentVenue = venueA;

  let flyToSeatCalls = 0;
  let currentSceneId = 'floating-island';
  page.renderer3d = {
    tierColorOverrides: {},
    setVenue: () => {},
    setSelection: () => {},
    setBirdEyeView: () => {},
    flyToSeat: () => { flyToSeatCalls++; },
    getSceneId: () => currentSceneId,
    setScene: (id) => {
      if (['floating-island', 'default', 'lights-off'].includes(id)) {
        currentSceneId = id;
        return true;
      }
      return false;
    }
  };

  // Test 3-scene toggle cycle
  page.onToggleScene();
  assert.strictEqual(page.data.activeSceneId, 'default');
  page.onToggleScene();
  assert.strictEqual(page.data.activeSceneId, 'lights-off');
  page.onToggleScene();
  assert.strictEqual(page.data.activeSceneId, 'floating-island');
  console.log('✓ 3-scene toggle cycle (floating-island -> default -> lights-off -> floating-island) verified.');

  // Intercept setTimeout to verify 2000ms delay without waiting 2 real seconds
  const realSetTimeout = global.setTimeout;
  const realClearTimeout = global.clearTimeout;
  const scheduled = [];
  let nextTimerId = 100;
  global.setTimeout = (fn, ms) => {
    const id = nextTimerId++;
    scheduled.push({ id, fn, ms, cleared: false });
    return id;
  };
  global.clearTimeout = (id) => {
    const item = scheduled.find(t => t.id === id);
    if (item) item.cleared = true;
  };

  try {
    // Switch to venueB
    const switchPromise = page.loadAndSwitchVenue('venue-b', 'doc-b', 'B馆');
    // Flush the 16ms frame-yield timer
    await Promise.resolve();
    const yieldTimer = scheduled.find(t => t.ms === 16 && !t.cleared);
    assert.ok(yieldTimer, '16ms yield timer should be scheduled');
    yieldTimer.fn();
    await switchPromise;

    assert.strictEqual(page.data.cameraMode, 'bird', 'Immediately after venue switch, cameraMode should be bird');
    assert.strictEqual(flyToSeatCalls, 0, 'flyToSeat must not fire immediately');

    const autoFlyTimer = scheduled.find(t => t.ms === 2000 && !t.cleared);
    assert.ok(autoFlyTimer, '2000ms auto-fly timer must be scheduled after venue switch');

    // Simulate 2000ms elapsing
    autoFlyTimer.fn();
    assert.strictEqual(page.data.cameraMode, 'seat', 'After 2000ms, cameraMode must transition to seat');
    assert.strictEqual(flyToSeatCalls, 1, 'After 2000ms, renderer3d.flyToSeat must be called once');

    // Test rapid re-switch cancels previous timer
    const switchA = page.loadAndSwitchVenue('venue-a', 'doc-a', 'A馆');
    await Promise.resolve();
    scheduled.filter(t => t.ms === 16 && !t.cleared).forEach(t => t.fn());
    await switchA;

    const timerA = scheduled.filter(t => t.ms === 2000 && !t.cleared).pop();
    assert.ok(timerA, 'Timer for venue A should be scheduled');

    // Manually enter seat mode before 2s -> should cancel timerA
    page.onFlyToSelectedSeat();
    assert.strictEqual(timerA.cleared, true, 'Manual onFlyToSelectedSeat must cancel pending auto-fly timer');

    console.log('✓ 2000ms auto-fly after venue switch & timer cancellation verified.');
  } finally {
    global.setTimeout = realSetTimeout;
    global.clearTimeout = realClearTimeout;
  }

  console.log('\n========================================');
  console.log('ALL LIGHTS-OFF & AUTO-FLY TESTS PASSED!');
  console.log('========================================');
})();

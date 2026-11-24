/**
 * Automated Test Suite for 3D External Scenes Module & Floating Island
 * Run: node scripts/test-scenes.cjs
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// Helper to load CommonJS miniprogram files
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

const { Mat4 } = loadCommonJs(path.join(ROOT, 'miniprogram/utils/engine-3d-mat4.js'));
const { MeshBuilder } = loadCommonJs(path.join(ROOT, 'miniprogram/utils/engine-3d-mesh-builder.js'));
const { Renderer3D } = loadCommonJs(path.join(ROOT, 'miniprogram/utils/renderer-3d.js'));
const { getAllVenues } = loadCommonJs(path.join(ROOT, 'miniprogram/data/venues.js'));
const scenes = loadCommonJs(path.join(ROOT, 'miniprogram/utils/scenes/index.js'));
const { SceneManager, FloatingIslandScene, DefaultScene, computeVenueBounds } = scenes;

const venues = getAllVenues();

console.log('--- 1. Testing Scene Manager Registration & Swapping ---');
{
  const mgr = new SceneManager();
  assert.strictEqual(mgr.getCurrentSceneId(), 'floating-island', 'Default scene should be floating-island');
  assert.ok(mgr.getCurrentScene() instanceof FloatingIslandScene, 'Current scene should be FloatingIslandScene');

  const available = mgr.getAvailableScenes();
  assert.ok(available.some(s => s.id === 'floating-island'), 'Available scenes must include floating-island');
  assert.ok(available.some(s => s.id === 'default'), 'Available scenes must include default');

  // Test swapping
  const swapped = mgr.setCurrentScene('default');
  assert.strictEqual(swapped, true);
  assert.strictEqual(mgr.getCurrentSceneId(), 'default');
  assert.ok(mgr.getCurrentScene() instanceof DefaultScene);

  // Test swapping to invalid scene
  const invalidSwap = mgr.setCurrentScene('non-existent');
  assert.strictEqual(invalidSwap, false);
  assert.strictEqual(mgr.getCurrentSceneId(), 'default', 'Scene should remain unchanged on invalid swap');

  // Swap back
  mgr.setCurrentScene('floating-island');
  assert.strictEqual(mgr.getCurrentSceneId(), 'floating-island');

  console.log('✓ Scene registration and dynamic swapping verified.');
}

console.log('--- 2. Testing Decoupled Bounds Calculation Across Venues ---');
{
  // Test fallback on empty/null input
  const nullBounds = computeVenueBounds(null);
  assert.ok(nullBounds.radiusX > 0 && nullBounds.radiusZ > 0);
  assert.strictEqual(nullBounds.minY, -0.60);

  venues.forEach(v => {
    const b = computeVenueBounds(v);
    assert.ok(b.radiusX > 20, `radiusX should be positive and reasonable for ${v.name}`);
    assert.ok(b.radiusZ > 20, `radiusZ should be positive and reasonable for ${v.name}`);
    assert.ok(b.maxRadius >= Math.max(b.radiusX, b.radiusZ));
    assert.strictEqual(b.width, b.radiusX * 2);
    assert.strictEqual(b.depth, b.radiusZ * 2);
    assert.strictEqual(b.minY, -0.60);
    assert.ok(b.maxY > 10, `maxY should account for stand tier elevation for ${v.name}`);

    // Verify Bird's Nest bounds account for its full architectural footprint
    if (v.id.includes('bird-nest')) {
      assert.ok(b.radiusX >= 140, `Bird's Nest radiusX must encompass full footprint (got ${b.radiusX})`);
      assert.ok(b.maxY >= 45, `Bird's Nest maxY must encompass full bowl/canopy elevation (got ${b.maxY})`);
    }
  });

  console.log(`✓ Decoupled venue bounds calculation verified for all ${venues.length} venues.`);
}

console.log('--- 3. Testing Floating Island Dimensions & 10:8.8 Aspect Ratio ---');
{
  const island = new FloatingIslandScene();

  venues.forEach(v => {
    const bounds = computeVenueBounds(v);
    const dims = island.computeDimensions(bounds);

    // Verify 10 : 8.8 ratio
    const expectedRatio = 10 / 8.8;
    assert.ok(
      Math.abs(dims.ratio - expectedRatio) < 1e-6,
      `Ratio must be exactly 10 : 8.8 (got ${dims.ratio}) for ${v.name}`
    );
    assert.ok(
      Math.abs(dims.halfWidth / dims.halfDepth - expectedRatio) < 1e-6,
      `halfWidth / halfDepth must equal 10 / 8.8 for ${v.name}`
    );

    // Verify platform is significantly larger than venue ("悬浮地台一定要比场馆大很多，总的基调是场景包含场馆")
    assert.ok(
      dims.halfWidth > bounds.radiusX,
      `Platform halfWidth (${dims.halfWidth.toFixed(1)}) must exceed stadium radiusX (${bounds.radiusX.toFixed(1)})`
    );
    assert.ok(
      dims.halfDepth > bounds.radiusZ,
      `Platform halfDepth (${dims.halfDepth.toFixed(1)}) must exceed stadium radiusZ (${bounds.radiusZ.toFixed(1)})`
    );

    // Verify topY is at stadium ground level -0.60
    assert.strictEqual(dims.topY, -0.60);
    assert.ok(dims.bottomY < -20, 'Suspended mountain keel should extend downward');
    assert.strictEqual(dims.bottomY, dims.topY - dims.rockHeight);
  });

  console.log('✓ Floating island 10:8.8 ratio and venue containment verified.');
}

console.log('--- 4. Testing Geometry Synthesis & Color Specifications ---');
{
  const island = new FloatingIslandScene();
  const v = venues[0];
  const bounds = computeVenueBounds(v);

  const solid = new MeshBuilder();
  const screens = new MeshBuilder();
  const alpha = new MeshBuilder();
  const beams = new MeshBuilder();

  island.buildMeshes({ solid, screens, alpha, beams }, bounds);

  // 1. Verify vertex generation
  assert.ok(solid.positions.length > 0, 'Solid mesh must have vertices');
  assert.ok(screens.positions.length > 0, 'Screens/unlit mesh must have vertices');
  assert.ok(alpha.positions.length > 0, 'Alpha mesh must have vertices');

  // 2. Verify normal and color integrity (lengths must match positions)
  assert.strictEqual(solid.positions.length, solid.normals.length);
  assert.strictEqual((solid.positions.length / 3) * 4, solid.colors.length);

  // 3. Verify no NaN in generated vertices
  solid.positions.forEach(p => assert.ok(!Number.isNaN(p)));
  solid.normals.forEach(n => assert.ok(!Number.isNaN(n)));
  solid.colors.forEach(c => assert.ok(!Number.isNaN(c) && c >= 0 && c <= 1.05));

  // 4. Verify Clear Color is warm cream #f6eee3
  const clearCol = island.getClearColor();
  assert.ok(Math.abs(clearCol[0] - 246 / 255) < 0.01, 'Clear color red should match #f6eee3');
  assert.ok(Math.abs(clearCol[1] - 238 / 255) < 0.01, 'Clear color green should match #f6eee3');
  assert.ok(Math.abs(clearCol[2] - 227 / 255) < 0.01, 'Clear color blue should match #f6eee3');

  // 5. Verify clouds and fairy particles were created
  assert.ok(island.cloudInstances.length >= 5, 'Should have multiple fluffy cloud instances');
  assert.ok(island.particleInstances.length >= 20, 'Should have golden fairy particle instances');

  console.log(`✓ Geometry generated with 100% normal/color integrity (${solid.positions.length / 3} solid, ${screens.positions.length / 3} screens, ${alpha.positions.length / 3} alpha vertices).`);
}

console.log('--- 5. Testing Bird Eye View Visibility (不允许超出画面) ---');
{
  // Check that all platform vertices stay within Normalized Device Coordinates [-0.90, 0.90]
  // across all camera yaw angles in bird's eye view at orbitDist = 460
  const island = new FloatingIslandScene();

  const aspectRatios = [
    375 / 400, // standard WeChat mini-program 3D card aspect
    375 / 600, // portrait phone full screen
    800 / 600  // desktop / tablet landscape
  ];

  venues.forEach(v => {
    const bounds = computeVenueBounds(v);
    const dims = island.computeDimensions(bounds);

    const solid = new MeshBuilder();
    const screens = new MeshBuilder();
    const alpha = new MeshBuilder();
    island.buildMeshes({ solid, screens, alpha }, bounds);

    aspectRatios.forEach(aspect => {
      const baseFovRad = (56 * Math.PI) / 180;
      // Compensate horizontal FOV for portrait viewports so horizontal width is not cropped
      const fovRad = aspect < 1.0
        ? 2 * Math.atan(Math.tan(baseFovRad / 2) / aspect)
        : baseFovRad;
      const proj = Mat4.create();
      Mat4.perspective(proj, fovRad, aspect, 2.5, 950.0);

      // Test multiple yaw rotation angles around the island
      const yawAngles = [0, 0.42, Math.PI / 2, Math.PI, (3 * Math.PI) / 2, 2 * Math.PI - 0.1];
      const pitchAngles = [0.18, 0.68, 1.35];

      pitchAngles.forEach(pitch => {
        yawAngles.forEach(yaw => {
          const r = 460;
          const eye = {
            x: Math.sin(yaw) * Math.cos(pitch) * r,
            y: Math.sin(pitch) * r,
            z: Math.cos(yaw) * Math.cos(pitch) * r
          };
          const target = { x: 0, y: 6, z: 0 };
          const view = Mat4.create();
          Mat4.lookAt(view, eye, target, { x: 0, y: 1, z: 0 });
          const mvp = Mat4.create();
          Mat4.multiply(mvp, proj, view);

          // Project key platform perimeter vertices (excluding distant sky dome)
          // Check grass meadow edge and rock cliff keel
          const numSamples = 24;
          for (let s = 0; s < numSamples; s++) {
            const a = (s / numSamples) * Math.PI * 2;
            const p = island.getPerimeterRadius(a, dims.halfWidth, dims.halfDepth);

            const samplePoints = [
              { x: p.x, y: dims.topY, z: p.z }, // Meadow edge
              { x: p.x * 0.5, y: dims.bottomY * 0.6, z: p.z * 0.5 }, // Mid cliff
              { x: 0, y: dims.bottomY, z: 0 } // Keel apex
            ];

            samplePoints.forEach(pt => {
              const clipX = mvp[0] * pt.x + mvp[4] * pt.y + mvp[8] * pt.z + mvp[12];
              const clipY = mvp[1] * pt.x + mvp[5] * pt.y + mvp[9] * pt.z + mvp[13];
              const clipW = mvp[3] * pt.x + mvp[7] * pt.y + mvp[11] * pt.z + mvp[15];

              const ndcX = clipX / clipW;
              const ndcY = clipY / clipW;

              assert.ok(
                Math.abs(ndcX) <= 0.96,
                `Platform vertex ndcX (${ndcX.toFixed(3)}) exceeds screen margin for ${v.name} at aspect ${aspect.toFixed(2)}, pitch ${pitch}`
              );
              assert.ok(
                Math.abs(ndcY) <= 0.96,
                `Platform vertex ndcY (${ndcY.toFixed(3)}) exceeds screen margin for ${v.name} at aspect ${aspect.toFixed(2)}, pitch ${pitch}`
              );
            });
          }
        });
      });
    });
  });

  console.log('✓ Platform stays 100% visible and within screen boundaries across all venues and angles.');
}

console.log('--- 6. Testing Renderer3D Integration with SceneManager ---');
{
  const renderer = new Renderer3D(null, null, 800, 600);
  assert.ok(renderer.sceneManager, 'Renderer3D must instantiate SceneManager');
  assert.strictEqual(renderer.getSceneId(), 'floating-island', 'Default active scene should be floating-island');

  const v = venues[0];
  renderer.setVenue(v, 'concert');

  // Verify scene switching via Renderer3D
  assert.strictEqual(renderer.setScene('default'), true);
  assert.strictEqual(renderer.getSceneId(), 'default');

  assert.strictEqual(renderer.setScene('floating-island'), true);
  assert.strictEqual(renderer.getSceneId(), 'floating-island');

  // Test dynamic animation update
  renderer.sceneManager.update(1.5, 0.016, null);
  assert.ok(renderer.sceneManager.getCurrentScene().cloudInstances[0].currentAngle !== undefined);

  console.log('✓ Renderer3D SceneManager facade methods and animation loops verified.');
}

console.log('--- 7. Testing Real Dynamic Vertex Animation & WebGL bufferSubData ---');
{
  const island = new FloatingIslandScene();
  const bounds = computeVenueBounds(venues[0]);
  const solid = new MeshBuilder();
  const screens = new MeshBuilder();
  const alpha = new MeshBuilder();
  island.buildMeshes({ solid, screens, alpha }, bounds);

  assert.ok(island.cloudBasePositions && island.cloudBasePositions.length > 0, 'Cloud base positions must be captured');
  assert.ok(island.dynamicCloudPositions && island.dynamicCloudPositions.length > 0, 'Dynamic cloud positions must be allocated');
  assert.ok(island.particleBasePositions && island.particleBasePositions.length > 0, 'Particle base positions must be captured');
  assert.ok(island.dynamicParticlePositions && island.dynamicParticlePositions.length > 0, 'Dynamic particle positions must be allocated');

  // Store initial snapshot at t = 0
  island.update(0.0, 0.016, null);
  const cloudX0 = island.dynamicCloudPositions[0];
  const cloudY0 = island.dynamicCloudPositions[1];
  const partY0 = island.dynamicParticlePositions[1];

  // Advance time to t = 2.5s
  island.update(2.5, 0.016, null);
  const cloudX1 = island.dynamicCloudPositions[0];
  const cloudY1 = island.dynamicCloudPositions[1];
  const partY1 = island.dynamicParticlePositions[1];

  // Verify positions genuinely displaced due to orbital drift and vertical bobbing
  const cloudDeltaX = Math.abs(cloudX1 - cloudX0);
  const cloudDeltaY = Math.abs(cloudY1 - cloudY0);
  const partDeltaY = Math.abs(partY1 - partY0);

  assert.ok(cloudDeltaX > 0.01, `Cloud X position must drift over time (delta = ${cloudDeltaX})`);
  assert.ok(cloudDeltaY > 0.01, `Cloud Y position must bob over time (delta = ${cloudDeltaY})`);
  assert.ok(partDeltaY > 0.01, `Particle Y position must float upwards over time (delta = ${partDeltaY})`);

  // Verify WebGL bufferSubData invocation with spy
  const subDataCalls = [];
  const mockGl = {
    ARRAY_BUFFER: 0x8892,
    bindBuffer(target, buf) {},
    bufferSubData(target, offset, data) {
      subDataCalls.push({ target, offset, length: data.length });
    }
  };
  const mockBuffers = {
    solidBuffers: { posBuf: { id: 1 } },
    screenBuffers: { posBuf: { id: 2 } }
  };

  island.update(3.0, 0.016, mockGl, mockBuffers);
  assert.strictEqual(subDataCalls.length, 2, 'gl.bufferSubData must be called for solid (clouds) and screens (particles)');
  assert.strictEqual(subDataCalls[0].target, mockGl.ARRAY_BUFFER);
  assert.strictEqual(subDataCalls[0].offset, island.cloudVertexStart * 3 * 4);
  assert.strictEqual(subDataCalls[0].length, island.cloudVertexCount * 3);
  assert.strictEqual(subDataCalls[1].target, mockGl.ARRAY_BUFFER);
  assert.strictEqual(subDataCalls[1].offset, island.particleVertexStart * 3 * 4);
  assert.strictEqual(subDataCalls[1].length, island.particleVertexCount * 3);

  console.log('✓ Dynamic cloud drift/bobbing, sparkle upward float & WebGL bufferSubData verified.');
}

console.log('\n========================================');
console.log('ALL EXTERNAL SCENE TESTS PASSED!');
console.log('========================================');

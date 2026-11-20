#!/usr/bin/env node
// 校验场馆数据：舞台、内场模块、生成的内场区块都必须落在内场矩形内。
// 用法：npm run check:venues
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// 小程序代码是 CommonJS，但根 package.json 声明了 "type": "module"，
// 这里用 Function 包装按 CommonJS 执行，并支持模块间的相对路径 require。
const moduleCache = new Map();
function loadCommonJs(absPath) {
  const abs = absPath.endsWith('.js') ? absPath : `${absPath}.js`;
  if (moduleCache.has(abs)) return moduleCache.get(abs).exports;
  const src = fs.readFileSync(abs, 'utf8');
  const mod = { exports: {} };
  moduleCache.set(abs, mod);
  const req = (spec) => (spec.startsWith('.')
    ? loadCommonJs(path.resolve(path.dirname(abs), spec))
    : require(spec));
  new Function('module', 'exports', 'require', src)(mod, mod.exports, req);
  return mod.exports;
}

const { getAllVenues } = loadCommonJs(path.join(ROOT, 'miniprogram/data/venues.js'));
const VENUES = getAllVenues();
const geo = loadCommonJs(path.join(ROOT, 'miniprogram/utils/schema-geometry.js'));
const { Renderer3D } = loadCommonJs(path.join(ROOT, 'miniprogram/utils/renderer-3d.js'));

const failures = [];

// 周界检查：按极径与内场边界比较（适配圆角矩形与椭圆）
function radialOutsideDistance(venue, x, z) {
  const inf = venue.infield;
  const radius = Math.hypot(x, z);
  const angleDeg = ((Math.atan2(x, -z) * geo.RAD2DEG) + 360) % 360;
  const boundary = geo.getRayRoundedRectDistance(angleDeg, inf.length, inf.width, inf.cornerRadius, inf.shape);
  return Math.max(0, radius - boundary - 0.5);
}

// 数据自带的内场模块按外接矩形检查（导出端可能按矩形摆放，允许少量贴边）
function rectOutsideDistance(venue, x, z) {
  const hx = (venue.infield.width || 0) / 2;
  const hz = (venue.infield.length || 0) / 2;
  return Math.hypot(Math.max(Math.abs(x) - hx, 0), Math.max(Math.abs(z) - hz, 0));
}

function corners(cx, cz, width, depth, rotDeg) {
  const hw = (width || 0) / 2;
  const hd = (depth || 0) / 2;
  return [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([lx, lz], i) => {
    const p = geo.rotateXZ(lx, lz, rotDeg || 0);
    return { x: cx + p.x, z: cz + p.z, label: `角点${i + 1}` };
  });
}

function expectInside(venue, label, x, z, distFn) {
  const d = distFn(venue, x, z);
  if (d > 0.01) {
    failures.push(`[${venue.id}] ${label} 越出内场 ${d.toFixed(2)}m (x=${x.toFixed(1)}, z=${z.toFixed(1)})`);
  }
}

function checkFootprint(venue, label, points, distFn) {
  points.forEach((p) => expectInside(venue, `${label} ${p.label}`, p.x, p.z, distFn));
}

VENUES.map(geo.normalizeVenueCoordinates).forEach((venue) => {
  if (!venue.infield) return;

  const stage = venue.infield.stageConfig;
  if (stage) {
    const st = geo.getStageTransform(venue);
    expectInside(venue, '舞台中心', st.centerX, st.centerZ, radialOutsideDistance);
    checkFootprint(
      venue,
      '舞台',
      corners(st.centerX, st.centerZ, stage.width || 30, stage.depth || 20, st.rotFromSouthDeg),
      radialOutsideDistance
    );
  }

  (venue.infieldModules || []).forEach((mod) => {
    checkFootprint(
      venue,
      `内场模块 ${mod.id}`,
      corners(mod.x || 0, mod.y || 0, mod.width || 20, mod.depth || 5, mod.rotationDeg),
      rectOutsideDistance
    );
  });

  geo.generateConcertInfieldBlocks(venue).forEach((blk) => {
    checkFootprint(
      venue,
      `内场区块 ${blk.id}`,
      corners(blk.x, blk.z, blk.width, blk.depth, blk.rotDeg),
      radialOutsideDistance
    );
  });

  // 鸟巢罩棚必须随角度起伏（马鞍形），防止场馆特判因 id 变化静默失效
  const isBirdNest = venue.code === 'BJ-NST-2008-01' || String(venue.id || '').indexOf('bird-nest') >= 0;
  if (isBirdNest) {
    const ys = [];
    const recorder = {
      addQuad: (p1, p2, p3, p4) => [p1, p2, p3, p4].forEach((p) => ys.push(p.y)),
      addBox: () => {},
      addBeam3D: () => {},
      addTriangle: () => {},
      addSeat3D: () => {},
      addVertexColoredQuad: () => {},
      addVertexColoredTriangle: () => {}
    };
    const canopyRenderer = Object.create(Renderer3D.prototype);
    canopyRenderer.venue = venue;
    canopyRenderer.buildStadiumCanopyRim(recorder);
    const span = ys.length ? Math.max(...ys) - Math.min(...ys) : 0;
    if (span < 4) {
      failures.push(`[${venue.id}] 鸟巢罩棚缺少马鞍形起伏 (标高跨度 ${span.toFixed(2)}m)`);
    }
  }
});

if (failures.length) {
  failures.forEach((f) => console.error(`FAIL ${f}`));
  console.error(`\n${failures.length} 项检查失败`);
  process.exit(1);
}

console.log(`OK  ${VENUES.length} 个场馆：舞台/内场区块边界正确，鸟巢罩棚马鞍形正常`);

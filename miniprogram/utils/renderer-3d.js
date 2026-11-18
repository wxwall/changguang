/**
 * STADIACAD 3D WebGL Immersive Stadium & Concert Stage Engine
 * Pure Native WebGL1 implementation for WeChat Mini Program `<canvas type="webgl">`
 *
 * Strictly renders every STADIACAD 2.0.0 schema detail:
 * - Exact rounded-rectangle & concentric-circle morph perimeter
 * - Row-by-row stepped concrete risers & treads (rows, rowPitch, riserHeight, slopeDeg)
 * - Row-by-row 3D stadium seats filling every sector (seatSpacing, radialAisleWidth)
 * - Carved 3D Vomitory tunnels (startRow, rowSpan, width, position, enabled)
 * - Full Guardrails & Handrails (frontRailHeight, rearWallHeight, material, aisleHandrailEnabled)
 * - VIP Skybox suites (vipBoxRooms partitions, warm lounge canopies, VIP seating)
 * - InfieldModules & Concert Infield Floor Seating Blocks with 3D seats
 * - Concert Stage (main LED, angled side IMAX screens, trusses, catwalk, FOH tower, steady volumetric beams)
 * - Grounded architectural exterior shell & plaza (zero under-bowl clipping, zero Z-fighting)
 */

const {
  DEG2RAD,
  getRayRoundedRectDistance,
  computeTierRadialBounds,
  generateConcertInfieldBlocks
} = require('./schema-geometry');

const Mat4 = {
  create() {
    return new Float32Array([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1
    ]);
  },
  perspective(out, fovyRad, aspect, near, far) {
    const f = 1.0 / Math.tan(fovyRad / 2);
    const nf = 1 / (near - far);
    out[0] = f / aspect; out[1] = 0; out[2] = 0; out[3] = 0;
    out[4] = 0; out[5] = f; out[6] = 0; out[7] = 0;
    out[8] = 0; out[9] = 0; out[10] = (far + near) * nf; out[11] = -1;
    out[12] = 0; out[13] = 0; out[14] = (2 * far * near) * nf; out[15] = 0;
    return out;
  },
  lookAt(out, eye, center, up) {
    let zx = eye.x - center.x;
    let zy = eye.y - center.y;
    let zz = eye.z - center.z;
    let len = Math.hypot(zx, zy, zz);
    if (len < 1e-6) { zx = 0; zy = 0; zz = 1; } else { zx /= len; zy /= len; zz /= len; }

    let xx = up.y * zz - up.z * zy;
    let xy = up.z * zx - up.x * zz;
    let xz = up.x * zy - up.y * zx;
    len = Math.hypot(xx, xy, xz);
    if (len < 1e-6) { xx = 1; xy = 0; xz = 0; } else { xx /= len; xy /= len; xz /= len; }

    const yx = zy * xz - zz * xy;
    const yy = zz * xx - zx * xz;
    const yz = zx * xy - zy * xx;

    out[0] = xx; out[1] = yx; out[2] = zx; out[3] = 0;
    out[4] = xy; out[5] = yy; out[6] = zy; out[7] = 0;
    out[8] = xz; out[9] = yz; out[10] = zz; out[11] = 0;
    out[12] = -(xx * eye.x + xy * eye.y + xz * eye.z);
    out[13] = -(yx * eye.x + yy * eye.y + yz * eye.z);
    out[14] = -(zx * eye.x + zy * eye.y + zz * eye.z);
    out[15] = 1;
    return out;
  },
  multiply(out, a, b) {
    const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
    const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
    const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
    const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];

    let b0 = b[0], b1 = b[1], b2 = b[2], b3 = b[3];
    out[0] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
    out[1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
    out[2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
    out[3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;

    b0 = b[4]; b1 = b[5]; b2 = b[6]; b3 = b[7];
    out[4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
    out[5] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
    out[6] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
    out[7] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;

    b0 = b[8]; b1 = b[9]; b2 = b[10]; b3 = b[11];
    out[8] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
    out[9] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
    out[10] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
    out[11] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;

    b0 = b[12]; b1 = b[13]; b2 = b[14]; b3 = b[15];
    out[12] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
    out[13] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
    out[14] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
    out[15] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
    return out;
  }
};

const VERTEX_SHADER = `
  attribute vec3 aPosition;
  attribute vec3 aNormal;
  attribute vec4 aColor;
  uniform mat4 uMVP;
  varying vec3 vNormal;
  varying vec4 vColor;
  varying vec3 vWorldPos;

  void main() {
    vNormal = aNormal;
    vColor = aColor;
    vWorldPos = aPosition;
    gl_Position = uMVP * vec4(aPosition, 1.0);
  }
`;

const FRAGMENT_SHADER = `
  precision mediump float;
  varying vec3 vNormal;
  varying vec4 vColor;
  varying vec3 vWorldPos;
  uniform float uTime;
  uniform float uIsUnlit;

  void main() {
    if (uIsUnlit > 0.5) {
      // Steady, gentle atmospheric glow without distracting strobing
      float gentle = 0.95 + 0.05 * sin(uTime * 0.8 + vWorldPos.x * 0.05);
      gl_FragColor = vec4(vColor.rgb * gentle, vColor.a);
      return;
    }
    vec3 norm = normalize(vNormal);
    vec3 lightDir1 = normalize(vec3(0.32, 0.88, 0.36));
    vec3 lightDir2 = normalize(vec3(-0.45, 0.52, -0.58));
    float diff1 = max(dot(norm, lightDir1), 0.0);
    float diff2 = max(dot(norm, lightDir2), 0.0) * 0.32;
    float ambient = 0.44;
    float lighting = min(1.18, ambient + diff1 * 0.54 + diff2);

    gl_FragColor = vec4(vColor.rgb * lighting, vColor.a);
  }
`;

class MeshBuilder {
  constructor() {
    this.positions = [];
    this.normals = [];
    this.colors = [];
  }

  addTriangle(p1, p2, p3, color, customNormal) {
    let nx = 0, ny = 1, nz = 0;
    if (customNormal) {
      nx = customNormal.x; ny = customNormal.y; nz = customNormal.z;
    } else {
      const ux = p2.x - p1.x, uy = p2.y - p1.y, uz = p2.z - p1.z;
      const vx = p3.x - p1.x, vy = p3.y - p1.y, vz = p3.z - p1.z;
      nx = uy * vz - uz * vy;
      ny = uz * vx - ux * vz;
      nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;
    }

    const r = color[0], g = color[1], b = color[2], a = color[3] !== undefined ? color[3] : 1.0;
    this.positions.push(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z, p3.x, p3.y, p3.z);
    this.normals.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
    this.colors.push(r, g, b, a, r, g, b, a, r, g, b, a);
  }

  addQuad(p1, p2, p3, p4, color, customNormal) {
    this.addTriangle(p1, p2, p3, color, customNormal);
    this.addTriangle(p1, p3, p4, color, customNormal);
  }

  addBox(cx, cy, cz, w, h, d, color, rotYRad) {
    const hw = w / 2, hh = h / 2, hd = d / 2;
    const cosY = Math.cos(rotYRad || 0);
    const sinY = Math.sin(rotYRad || 0);

    const xform = (lx, ly, lz) => ({
      x: cx + lx * cosY + lz * sinY,
      y: cy + ly,
      z: cz - lx * sinY + lz * cosY
    });

    const v000 = xform(-hw, -hh, -hd);
    const v100 = xform(hw, -hh, -hd);
    const v101 = xform(hw, -hh, hd);
    const v001 = xform(-hw, -hh, hd);
    const v010 = xform(-hw, hh, -hd);
    const v110 = xform(hw, hh, -hd);
    const v111 = xform(hw, hh, hd);
    const v011 = xform(-hw, hh, hd);

    this.addQuad(v010, v011, v111, v110, color, { x: 0, y: 1, z: 0 });
    this.addQuad(v000, v100, v101, v001, color, { x: 0, y: -1, z: 0 });
    this.addQuad(v001, v101, v111, v011, color);
    this.addQuad(v100, v000, v010, v110, color);
    this.addQuad(v000, v001, v011, v010, color);
    this.addQuad(v101, v100, v110, v111, color);
  }

  /**
   * Adds a crisp 3D stadium bucket seat oriented facing (fx, fz).
   * Seat pan + angled backrest (4 triangles total for high density & speed).
   */
  addSeat3D(cx, cy, cz, seatWidth, seatDepth, fx, fz, panColor, backColor) {
    const rx = -fz; // right-hand tangent vector
    const rz = fx;
    const hw = seatWidth * 0.44;
    const hd = seatDepth * 0.42;
    const panY = cy + 0.36;
    const backTopY = cy + 0.84;

    // Seat pan quad
    const pFL = { x: cx - rx * hw + fx * hd, y: panY, z: cz - rz * hw + fz * hd };
    const pFR = { x: cx + rx * hw + fx * hd, y: panY, z: cz + rz * hw + fz * hd };
    const pBR = { x: cx + rx * hw - fx * hd * 0.7, y: panY, z: cz + rz * hw - fz * hd * 0.7 };
    const pBL = { x: cx - rx * hw - fx * hd * 0.7, y: panY, z: cz - rz * hw - fz * hd * 0.7 };
    this.addQuad(pBL, pFL, pFR, pBR, panColor, { x: 0, y: 1, z: 0 });

    // Angled backrest quad
    const bTL = { x: cx - rx * hw - fx * hd * 0.95, y: backTopY, z: cz - rz * hw - fz * hd * 0.95 };
    const bTR = { x: cx + rx * hw - fx * hd * 0.95, y: backTopY, z: cz + rz * hw - fz * hd * 0.95 };
    this.addQuad(pBL, pBR, bTR, bTL, backColor, { x: fx * 0.9, y: 0.35, z: fz * 0.9 });
  }
}

class Renderer3D {
  constructor(canvas, gl, width, height) {
    this.canvas = canvas;
    this.gl = gl;
    this.width = width;
    this.height = height;

    this.venue = null;
    this.viewMode = 'concert';
    this.selectedSectorId = null;
    this.selectedModuleId = null;
    this.selectedFloorBlockId = null;

    this.cameraMode = 'bird';
    this.zoomLevel = 1.0;
    this.baseFovDeg = 56;

    this.camEye = { x: 0, y: 165, z: 215 };
    this.camTarget = { x: 0, y: 0, z: 0 };
    this.targetEye = { x: 0, y: 165, z: 215 };
    this.targetLook = { x: 0, y: 0, z: 0 };

    this.orbitYaw = 0.42;
    this.orbitPitch = 0.68;
    this.orbitDist = 260;
    this.seatYawOffset = 0;
    this.seatPitchOffset = 0;

    this.projMat = Mat4.create();
    this.viewMat = Mat4.create();
    this.mvpMat = Mat4.create();

    this.solidBuffers = null;
    this.alphaBuffers = null;
    this.beamBuffers = null;

    this.startTime = Date.now();
    this.initGL();
  }

  initGL() {
    const gl = this.gl;
    const vs = this.compileShader(gl.VERTEX_SHADER, VERTEX_SHADER);
    const fs = this.compileShader(gl.FRAGMENT_SHADER, FRAGMENT_SHADER);

    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    gl.useProgram(prog);

    this.program = prog;
    this.attribPos = gl.getAttribLocation(prog, 'aPosition');
    this.attribNorm = gl.getAttribLocation(prog, 'aNormal');
    this.attribCol = gl.getAttribLocation(prog, 'aColor');
    this.uniMVP = gl.getUniformLocation(prog, 'uMVP');
    this.uniTime = gl.getUniformLocation(prog, 'uTime');
    this.uniIsUnlit = gl.getUniformLocation(prog, 'uIsUnlit');

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
  }

  compileShader(type, source) {
    const gl = this.gl;
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    return shader;
  }

  resize(width, height) {
    this.width = width;
    this.height = height;
    if (this.gl) {
      this.gl.viewport(0, 0, width, height);
    }
  }

  setVenue(venue, viewMode) {
    this.venue = venue;
    if (viewMode) this.viewMode = viewMode;
    const summary = venue.engineeringSummary || {};
    this.orbitDist = Math.max(summary.outermostFootprintLengthM || 240, 160) * 0.88;
    this.setBirdEyeView();
    this.rebuildSceneMeshes();
  }

  setViewMode(viewMode) {
    this.viewMode = viewMode;
    this.rebuildSceneMeshes();
  }

  setSelection(sectorId, moduleId, floorBlockId) {
    const changed = this.selectedSectorId !== sectorId ||
                    this.selectedModuleId !== moduleId ||
                    this.selectedFloorBlockId !== floorBlockId;
    this.selectedSectorId = sectorId || null;
    this.selectedModuleId = moduleId || null;
    this.selectedFloorBlockId = floorBlockId || null;
    if (changed && this.venue) {
      this.rebuildSceneMeshes();
    }
  }

  setZoom(zoom) {
    this.zoomLevel = zoom;
  }

  setBirdEyeView() {
    this.cameraMode = 'bird';
    this.seatYawOffset = 0;
    this.seatPitchOffset = 0;
    this.zoomLevel = 1.0;
    this.updateBirdCameraTarget();
  }

  updateBirdCameraTarget() {
    const r = this.orbitDist;
    const cosP = Math.cos(this.orbitPitch);
    const sinP = Math.sin(this.orbitPitch);
    this.targetEye = {
      x: Math.sin(this.orbitYaw) * cosP * r,
      y: Math.max(22, sinP * r),
      z: Math.cos(this.orbitYaw) * cosP * r
    };
    this.targetLook = { x: 0, y: 6, z: 0 };
  }

  flyToSeat(sightlineData) {
    if (!sightlineData) return;
    this.cameraMode = 'seat';
    this.seatYawOffset = 0;
    this.seatPitchOffset = 0;
    this.baseSeatEye = { ...sightlineData.eye };
    this.baseSeatTarget = { ...sightlineData.target };
    this.updateSeatCameraTarget();
  }

  updateSeatCameraTarget() {
    if (!this.baseSeatEye || !this.baseSeatTarget) return;
    this.targetEye = {
      x: this.baseSeatEye.x,
      y: Math.max(1.2, this.baseSeatEye.y),
      z: this.baseSeatEye.z
    };

    const dx = this.baseSeatTarget.x - this.targetEye.x;
    const dy = this.baseSeatTarget.y - this.targetEye.y;
    const dz = this.baseSeatTarget.z - this.targetEye.z;
    const horizDist = Math.hypot(dx, dz) || 1;
    const baseYaw = Math.atan2(dx, dz);
    const basePitch = Math.atan2(dy, horizDist);

    const finalYaw = baseYaw + this.seatYawOffset;
    const finalPitch = Math.max(-0.58, Math.min(0.58, basePitch + this.seatPitchOffset));
    const dist = Math.hypot(dx, dy, dz) || 50;

    this.targetLook = {
      x: this.targetEye.x + Math.sin(finalYaw) * Math.cos(finalPitch) * dist,
      y: this.targetEye.y + Math.sin(finalPitch) * dist,
      z: this.targetEye.z + Math.cos(finalYaw) * Math.cos(finalPitch) * dist
    };
  }

  handleTouchDrag(dxPx, dyPx) {
    if (this.cameraMode === 'bird') {
      this.orbitYaw -= dxPx * 0.007;
      // Clamp orbitPitch strictly between 17 deg and 79 deg so camera never dips under stadium
      this.orbitPitch = Math.max(0.30, Math.min(1.38, this.orbitPitch + dyPx * 0.006));
      this.updateBirdCameraTarget();
    } else {
      const sensitivity = 0.0035 / Math.sqrt(this.zoomLevel || 1);
      this.seatYawOffset -= dxPx * sensitivity;
      this.seatPitchOffset = Math.max(-0.55, Math.min(0.55, this.seatPitchOffset - dyPx * sensitivity));
      this.updateSeatCameraTarget();
    }
  }

  handlePinchZoom(scaleDelta) {
    if (this.cameraMode === 'bird') {
      this.orbitDist = Math.max(85, Math.min(460, this.orbitDist / scaleDelta));
      this.updateBirdCameraTarget();
    } else {
      this.zoomLevel = Math.max(0.5, Math.min(5.5, this.zoomLevel * scaleDelta));
    }
  }

  disposeBufferGroup(bufGroup) {
    if (!bufGroup || !this.gl) return;
    const gl = this.gl;
    if (bufGroup.posBuf) gl.deleteBuffer(bufGroup.posBuf);
    if (bufGroup.normBuf) gl.deleteBuffer(bufGroup.normBuf);
    if (bufGroup.colBuf) gl.deleteBuffer(bufGroup.colBuf);
  }

  rebuildSceneMeshes() {
    if (!this.venue || !this.gl) return;

    this.disposeBufferGroup(this.solidBuffers);
    this.disposeBufferGroup(this.alphaBuffers);
    this.disposeBufferGroup(this.beamBuffers);

    const solid = new MeshBuilder();
    const alpha = new MeshBuilder();
    const beams = new MeshBuilder();

    // 1. Exterior Ground Plaza & Stadium Perimeter Cladding (prevents seeing under bowl)
    this.buildGroundAndShell(solid);

    // 2. Infield Floor, Running Track / Court / Grass Pitch
    this.buildInfieldMesh(solid);

    // 3. Schema Infield Modules (e.g. sideline/VIP flat benches with 3D seats)
    this.buildInfieldModulesMesh(solid);

    // 4. Stand Tiers: Stepped concrete rows, row-by-row 3D seats, radial stairs + handrails,
    //    carved vomitory tunnels, VIP skybox rooms, front/rear guardrails
    this.buildStandTiersMesh(solid, alpha);

    // 5. Architectural Thick Roof Canopy Ring (zero Z-fighting!)
    this.buildStadiumCanopyRim(solid);

    // 6. Concert Stage + Concert Infield Floor Seating Blocks OR Sports Goals/Hoops
    if (this.viewMode === 'concert') {
      this.buildConcertInfieldSeatsMesh(solid);
      this.buildConcertStageMesh(solid, beams);
    } else {
      this.buildSportsEquipmentMesh(solid);
    }

    this.solidBuffers = this.uploadMesh(solid);
    this.alphaBuffers = this.uploadMesh(alpha);
    this.beamBuffers = this.uploadMesh(beams);
  }

  buildGroundAndShell(solid) {
    // Large architectural plaza apron at y = -0.60 so camera never sees an empty void
    const plazaR = 360;
    const plazaCol = [0.04, 0.055, 0.095, 1.0];
    solid.addQuad(
      { x: -plazaR, y: -0.60, z: -plazaR },
      { x: -plazaR, y: -0.60, z: plazaR },
      { x: plazaR, y: -0.60, z: plazaR },
      { x: plazaR, y: -0.60, z: -plazaR },
      plazaCol,
      { x: 0, y: 1, z: 0 }
    );

    // Solid exterior facade shell connecting outer tier down to ground plaza
    const tiers = this.venue.standTiers || [];
    const lastTierIdx = tiers.length - 1;
    if (lastTierIdx < 0) return;

    const lastTier = tiers[lastTierIdx];
    const lastSlope = lastTier.defaultSlopeDeg || 24;
    const lastRows = lastTier.defaultRows || 22;
    const lastPitch = lastTier.defaultRowPitch || 0.85;
    const topWallY = (lastTier.baseElevation || 14) + lastRows * (lastPitch * Math.tan(lastSlope * DEG2RAD));

    const segs = 64;
    const shellCol = [0.11, 0.14, 0.21, 1.0];
    const finCol = [0.17, 0.22, 0.32, 1.0];

    for (let i = 0; i < segs; i++) {
      const deg1 = (i / segs) * 360;
      const deg2 = ((i + 1) / segs) * 360;
      const b1 = computeTierRadialBounds(this.venue, lastTierIdx, deg1);
      const b2 = computeTierRadialBounds(this.venue, lastTierIdx, deg2);
      const sin1 = Math.sin(deg1 * DEG2RAD), cos1 = -Math.cos(deg1 * DEG2RAD);
      const sin2 = Math.sin(deg2 * DEG2RAD), cos2 = -Math.cos(deg2 * DEG2RAD);

      const r1 = b1.outerRadius + 1.5;
      const r2 = b2.outerRadius + 1.5;

      const p1_b = { x: sin1 * r1, y: -0.60, z: cos1 * r1 };
      const p2_b = { x: sin2 * r2, y: -0.60, z: cos2 * r2 };
      const p2_t = { x: sin2 * r2, y: topWallY, z: cos2 * r2 };
      const p1_t = { x: sin1 * r1, y: topWallY, z: cos1 * r1 };

      solid.addQuad(p1_b, p1_t, p2_t, p2_b, i % 2 === 0 ? shellCol : finCol);
    }
  }

  buildInfieldMesh(solid) {
    const infield = this.venue.infield;
    if (!infield) return;

    const segs = 64;
    let trackColor = [0.05, 0.25, 0.19, 1.0];
    if (infield.surfaceType === 'synthetic-track') {
      trackColor = [0.54, 0.18, 0.09, 1.0];
    } else if (infield.surfaceType === 'hardwood-court') {
      trackColor = [0.12, 0.16, 0.24, 1.0];
    }

    // Track/apron surface at y = 0.00 (cleanly separated from plaza at -0.60)
    for (let i = 0; i < segs; i++) {
      const deg1 = (i / segs) * 360;
      const deg2 = ((i + 1) / segs) * 360;
      const r1 = getRayRoundedRectDistance(deg1, infield.length, infield.width, infield.cornerRadius);
      const r2 = getRayRoundedRectDistance(deg2, infield.length, infield.width, infield.cornerRadius);

      const p1 = { x: Math.sin(deg1 * DEG2RAD) * r1, y: 0.0, z: -Math.cos(deg1 * DEG2RAD) * r1 };
      const p2 = { x: Math.sin(deg2 * DEG2RAD) * r2, y: 0.0, z: -Math.cos(deg2 * DEG2RAD) * r2 };
      solid.addTriangle({ x: 0, y: 0.0, z: 0 }, p1, p2, trackColor, { x: 0, y: 1, z: 0 });
    }

    // Running track lane lines for Olympic track-field
    if (infield.sportPreset === 'track-field') {
      const laneCol = [0.88, 0.90, 0.94, 1.0];
      for (let lane = 1; lane <= 4; lane++) {
        const shrink = lane * 2.5;
        for (let i = 0; i < segs; i++) {
          const deg1 = (i / segs) * 360;
          const deg2 = ((i + 1) / segs) * 360;
          const r1 = getRayRoundedRectDistance(deg1, infield.length - shrink * 2, infield.width - shrink * 2, Math.max(4, infield.cornerRadius - shrink));
          const r2 = getRayRoundedRectDistance(deg2, infield.length - shrink * 2, infield.width - shrink * 2, Math.max(4, infield.cornerRadius - shrink));
          const sin1 = Math.sin(deg1 * DEG2RAD), cos1 = -Math.cos(deg1 * DEG2RAD);
          const sin2 = Math.sin(deg2 * DEG2RAD), cos2 = -Math.cos(deg2 * DEG2RAD);
          solid.addQuad(
            { x: sin1 * r1, y: 0.04, z: cos1 * r1 },
            { x: sin1 * (r1 + 0.16), y: 0.04, z: cos1 * (r1 + 0.16) },
            { x: sin2 * (r2 + 0.16), y: 0.04, z: cos2 * (r2 + 0.16) },
            { x: sin2 * r2, y: 0.04, z: cos2 * r2 },
            laneCol,
            { x: 0, y: 1, z: 0 }
          );
        }
      }
    }

    const pw = infield.pitchWidth || 68;
    const pl = infield.pitchLength || 105;
    const hw = pw / 2;
    const hl = pl / 2;

    if (infield.surfaceType === 'hardwood-court') {
      // Hardwood basketball court at y = 0.08
      solid.addQuad(
        { x: -hw, y: 0.08, z: -hl },
        { x: -hw, y: 0.08, z: hl },
        { x: hw, y: 0.08, z: hl },
        { x: hw, y: 0.08, z: -hl },
        [0.78, 0.46, 0.17, 1.0],
        { x: 0, y: 1, z: 0 }
      );
      // Key paint at y = 0.12
      solid.addQuad(
        { x: -2.45, y: 0.12, z: -hl },
        { x: -2.45, y: 0.12, z: -hl + 5.8 },
        { x: 2.45, y: 0.12, z: -hl + 5.8 },
        { x: 2.45, y: 0.12, z: -hl },
        [0.14, 0.38, 0.84, 1.0],
        { x: 0, y: 1, z: 0 }
      );
      solid.addQuad(
        { x: -2.45, y: 0.12, z: hl - 5.8 },
        { x: -2.45, y: 0.12, z: hl },
        { x: 2.45, y: 0.12, z: hl },
        { x: 2.45, y: 0.12, z: hl - 5.8 },
        [0.14, 0.38, 0.84, 1.0],
        { x: 0, y: 1, z: 0 }
      );
    } else {
      // Mowed grass stripes at y = 0.08
      const stripes = 12;
      const stripeLen = pl / stripes;
      for (let i = 0; i < stripes; i++) {
        const z1 = -hl + i * stripeLen;
        const z2 = z1 + stripeLen;
        const col = i % 2 === 0 ? [0.05, 0.45, 0.31, 1.0] : [0.07, 0.53, 0.36, 1.0];
        solid.addQuad(
          { x: -hw, y: 0.08, z: z1 },
          { x: -hw, y: 0.08, z: z2 },
          { x: hw, y: 0.08, z: z2 },
          { x: hw, y: 0.08, z: z1 },
          col,
          { x: 0, y: 1, z: 0 }
        );
      }

      // Crisp white pitch lines at y = 0.14 (well separated from 0.08 grass)
      const lw = 0.35;
      const lineCol = [0.92, 0.96, 1.0, 1.0];
      solid.addQuad({ x: -hw, y: 0.14, z: -lw / 2 }, { x: -hw, y: 0.14, z: lw / 2 }, { x: hw, y: 0.14, z: lw / 2 }, { x: hw, y: 0.14, z: -lw / 2 }, lineCol, { x: 0, y: 1, z: 0 });
      solid.addQuad({ x: -hw, y: 0.14, z: -hl }, { x: -hw, y: 0.14, z: -hl + lw }, { x: hw, y: 0.14, z: -hl + lw }, { x: hw, y: 0.14, z: -hl }, lineCol, { x: 0, y: 1, z: 0 });
      solid.addQuad({ x: -hw, y: 0.14, z: hl - lw }, { x: -hw, y: 0.14, z: hl }, { x: hw, y: 0.14, z: hl }, { x: hw, y: 0.14, z: hl - lw }, lineCol, { x: 0, y: 1, z: 0 });
      solid.addQuad({ x: -hw, y: 0.14, z: -hl }, { x: -hw + lw, y: 0.14, z: -hl }, { x: -hw + lw, y: 0.14, z: hl }, { x: -hw, y: 0.14, z: hl }, lineCol, { x: 0, y: 1, z: 0 });
      solid.addQuad({ x: hw - lw, y: 0.14, z: -hl }, { x: hw, y: 0.14, z: -hl }, { x: hw, y: 0.14, z: hl }, { x: hw - lw, y: 0.14, z: hl }, lineCol, { x: 0, y: 1, z: 0 });
    }
  }

  buildInfieldModulesMesh(solid) {
    const modules = this.venue.infieldModules || [];
    modules.forEach((mod) => {
      const isSelected = mod.id === this.selectedModuleId;
      const baseCol = isSelected ? [0.96, 0.25, 0.37, 1.0] : [0.06, 0.58, 0.42, 1.0];
      const seatPanCol = isSelected ? [0.98, 0.42, 0.52, 1.0] : [0.10, 0.78, 0.56, 1.0];
      const seatBackCol = isSelected ? [0.85, 0.14, 0.28, 1.0] : [0.04, 0.52, 0.36, 1.0];

      const rotRad = (mod.rotationDeg || 0) * DEG2RAD;
      const cosR = Math.cos(rotRad);
      const sinR = Math.sin(rotRad);
      const cx = mod.x || 0;
      const cz = mod.y || 0;
      const w = mod.width || 24;
      const d = mod.depth || 5;
      const baseElev = mod.baseElevation || 0;

      // Platform deck
      solid.addBox(cx, baseElev + 0.15, cz, w, 0.3, d, [0.16, 0.20, 0.28, 1.0], rotRad);

      // Populate rows of 3D seats inside the module
      const rows = mod.rows || 4;
      const seatSpacing = mod.seatSpacing || 0.6;
      const aisleW = mod.aisleWidth || 1.4;
      const usableW = Math.max(2, w - aisleW);
      const seatsPerRow = Math.max(4, Math.floor(usableW / seatSpacing));

      // Facing inward toward pitch center (0, 0)
      const fx = cx > 0 ? -1 : (cx < 0 ? 1 : 0);
      const fz = cz > 0 ? -1 : (cz < 0 ? 1 : 0);
      const fLen = Math.hypot(fx, fz) || 1;

      for (let r = 0; r < rows; r++) {
        const localZ = -d / 2 + (r + 0.5) * (d / rows);
        const rowY = baseElev + 0.3 + r * Math.sin((mod.slopeDeg || 0) * DEG2RAD) * (mod.rowPitch || 0.95);
        for (let s = 0; s < seatsPerRow; s++) {
          const localX = -usableW / 2 + (s + 0.5) * (usableW / seatsPerRow);
          const wx = cx + localX * cosR + localZ * sinR;
          const wz = cz - localX * sinR + localZ * cosR;
          solid.addSeat3D(wx, rowY, wz, seatSpacing * 0.9, 0.48, fx / fLen, fz / fLen, seatPanCol, seatBackCol);
        }
      }

      // Perimeter safety barrier
      solid.addBox(cx, baseElev + 0.55, cz, w + 0.2, 0.8, 0.12, baseCol, rotRad);
    });
  }

  buildConcertInfieldSeatsMesh(solid) {
    const blocks = generateConcertInfieldBlocks(this.venue);
    blocks.forEach((blk) => {
      const isSelected = blk.id === this.selectedFloorBlockId;
      const panCol = isSelected ? [0.98, 0.38, 0.50, 1.0] : [0.22, 0.55, 0.96, 1.0];
      const backCol = isSelected ? [0.85, 0.14, 0.28, 1.0] : [0.12, 0.36, 0.78, 1.0];

      // Subtle floor mat base
      solid.addQuad(
        { x: blk.x - blk.width / 2, y: 0.18, z: blk.z - blk.depth / 2 },
        { x: blk.x - blk.width / 2, y: 0.18, z: blk.z + blk.depth / 2 },
        { x: blk.x + blk.width / 2, y: 0.18, z: blk.z + blk.depth / 2 },
        { x: blk.x + blk.width / 2, y: 0.18, z: blk.z - blk.depth / 2 },
        [0.10, 0.14, 0.22, 1.0],
        { x: 0, y: 1, z: 0 }
      );

      // Populate individual 3D seats row by row
      const rows = blk.rows || 8;
      const seatSpacing = blk.seatSpacing || 0.52;
      const stride = (blk.width / seatSpacing) * rows > 400 ? 2 : 1;
      const seatCount = Math.max(4, Math.floor((blk.width - 0.6) / (seatSpacing * stride)));

      for (let r = 0; r < rows; r++) {
        const rz = blk.z - blk.depth / 2 + (r + 0.5) * (blk.depth / rows);
        for (let s = 0; s < seatCount; s++) {
          const sx = blk.x - (blk.width - 0.6) / 2 + (s + 0.5) * ((blk.width - 0.6) / seatCount);
          solid.addSeat3D(
            sx,
            0.18,
            rz,
            seatSpacing * stride * 0.9,
            0.46,
            0,
            blk.facingZ,
            panCol,
            backCol
          );
        }
      }

      // Perimeter crowd barricade
      const railCol = [0.55, 0.62, 0.72, 1.0];
      solid.addBox(blk.x, 0.65, blk.z - blk.depth / 2, blk.width, 0.9, 0.1, railCol, 0);
      solid.addBox(blk.x, 0.65, blk.z + blk.depth / 2, blk.width, 0.9, 0.1, railCol, 0);
    });
  }

  buildStandTiersMesh(solid, alpha) {
    const tiers = this.venue.standTiers || [];
    const showGuardrails = !(this.venue.gridSystem && this.venue.gridSystem.showGuardrails === false);
    const showVomitories = !(this.venue.gridSystem && this.venue.gridSystem.showVomitories === false);

    // Estimate total seat density to tune far-sector seat stride cleanly while keeping EVERY row filled
    const totalEstCap = (this.venue.engineeringSummary && this.venue.engineeringSummary.totalCapacity) || 50000;
    const globalSeatStride = totalEstCap <= 35000 ? 1 : (totalEstCap <= 95000 ? 3 : 4);

    const tierSeatColors = [
      { pan: [0.20, 0.45, 0.90, 1.0], back: [0.12, 0.30, 0.68, 1.0] }, // 1F Blue
      { pan: [0.08, 0.68, 0.50, 1.0], back: [0.04, 0.46, 0.34, 1.0] }, // 2F Emerald
      { pan: [0.92, 0.62, 0.14, 1.0], back: [0.72, 0.42, 0.08, 1.0] }, // 3F Amber VIP
      { pan: [0.56, 0.34, 0.92, 1.0], back: [0.38, 0.20, 0.72, 1.0] }  // 4F Violet
    ];
    const concreteStepCol = [0.22, 0.26, 0.34, 1.0];
    const concreteRiserCol = [0.15, 0.18, 0.24, 1.0];
    const stairStepCol = [0.32, 0.36, 0.44, 1.0];
    const handrailCol = [0.68, 0.74, 0.84, 1.0];

    tiers.forEach((tier, tierIndex) => {
      const seatColPair = tierSeatColors[(tier.level - 1) % tierSeatColors.length];
      const sectors = tier.sectors || [];
      const activeSectors = sectors.filter(s => !s.isDeleted && s.fillType !== 'empty-void');
      const selectedIdxInTier = activeSectors.findIndex(s => s.id === this.selectedSectorId);

      sectors.forEach((sec) => {
        if (sec.isDeleted || sec.fillType === 'empty-void') return;

        const activeIdx = activeSectors.indexOf(sec);
        const isSelected = sec.id === this.selectedSectorId;
        const isNearSelected = isSelected || (selectedIdxInTier !== -1 && Math.abs(activeIdx - selectedIdxInTier) <= 1);
        const isVip = sec.fillType === 'vip-box';

        const panCol = isSelected
          ? [0.98, 0.32, 0.46, 1.0]
          : (isVip ? [0.95, 0.70, 0.18, 1.0] : seatColPair.pan);
        const backCol = isSelected
          ? [0.84, 0.14, 0.28, 1.0]
          : (isVip ? [0.74, 0.46, 0.08, 1.0] : seatColPair.back);

        const sDeg = sec.startAngleDeg;
        const eDeg = sec.endAngleDeg;
        const midDeg = (sDeg + eDeg) / 2;
        const angularSpan = eDeg - sDeg;
        if (angularSpan <= 0.5) return;

        const totalRows = sec.rows || tier.defaultRows || 22;
        const rowPitch = sec.rowPitch || tier.defaultRowPitch || 0.85;
        const slopeDeg = sec.slopeDeg || tier.defaultSlopeDeg || 20;
        const riserH = sec.riserHeight || (rowPitch * Math.tan(slopeDeg * DEG2RAD));
        const seatSpacing = sec.seatSpacing || tier.defaultSeatSpacing || 0.5;
        const baseElev = tier.baseElevation || 1.0;
        const topElev = baseElev + totalRows * riserH;
        const radialAisleWidth = tier.radialAisleWidth || 1.6;

        // 1. Build Stepped Concrete Bowl Base + Radial Stair Aisles
        const angSteps = Math.max(3, Math.ceil(angularSpan / 6.0));
        const concreteBands = Math.min(totalRows, isNearSelected ? totalRows : 16);

        for (let a = 0; a < angSteps; a++) {
          const deg1 = sDeg + (a / angSteps) * angularSpan;
          const deg2 = sDeg + ((a + 1) / angSteps) * angularSpan;
          const rad1 = deg1 * DEG2RAD;
          const rad2 = deg2 * DEG2RAD;
          const sin1 = Math.sin(rad1), cos1 = -Math.cos(rad1);
          const sin2 = Math.sin(rad2), cos2 = -Math.cos(rad2);

          const b1 = computeTierRadialBounds(this.venue, tierIndex, deg1, sec.customRadialDepth);
          const b2 = computeTierRadialBounds(this.venue, tierIndex, deg2, sec.customRadialDepth);

          for (let rb = 0; rb < concreteBands; rb++) {
            const f0 = rb / concreteBands;
            const f1 = (rb + 1) / concreteBands;
            const r1_in = b1.innerRadius + (b1.outerRadius - b1.innerRadius) * f0;
            const r1_out = b1.innerRadius + (b1.outerRadius - b1.innerRadius) * f1;
            const r2_in = b2.innerRadius + (b2.outerRadius - b2.innerRadius) * f0;
            const r2_out = b2.innerRadius + (b2.outerRadius - b2.innerRadius) * f1;

            const y0 = baseElev + (topElev - baseElev) * f0;
            const y1 = baseElev + (topElev - baseElev) * f1;

            // Concrete Riser
            solid.addQuad(
              { x: sin1 * r1_in, y: y0, z: cos1 * r1_in },
              { x: sin1 * r1_in, y: y1, z: cos1 * r1_in },
              { x: sin2 * r2_in, y: y1, z: cos2 * r2_in },
              { x: sin2 * r2_in, y: y0, z: cos2 * r2_in },
              concreteRiserCol
            );
            // Concrete Tread
            solid.addQuad(
              { x: sin1 * r1_in, y: y1, z: cos1 * r1_in },
              { x: sin1 * r1_out, y: y1, z: cos1 * r1_out },
              { x: sin2 * r2_out, y: y1, z: cos2 * r2_out },
              { x: sin2 * r2_in, y: y1, z: cos2 * r2_in },
              isSelected ? [0.28, 0.20, 0.25, 1.0] : concreteStepCol,
              { x: 0, y: 1, z: 0 }
            );
          }

          // Front Parapet Wall & Guardrail
          const guard = sec.guardrail || tier.defaultGuardrail || {};
          const f1_bot = { x: sin1 * b1.innerRadius, y: Math.max(0, baseElev - 1.3), z: cos1 * b1.innerRadius };
          const f2_bot = { x: sin2 * b2.innerRadius, y: Math.max(0, baseElev - 1.3), z: cos2 * b2.innerRadius };
          const f2_top = { x: sin2 * b2.innerRadius, y: baseElev, z: cos2 * b2.innerRadius };
          const f1_top = { x: sin1 * b1.innerRadius, y: baseElev, z: cos1 * b1.innerRadius };
          solid.addQuad(f1_bot, f1_top, f2_top, f2_bot, [0.16, 0.20, 0.28, 1.0]);

          if (showGuardrails && guard.frontRailEnabled !== false) {
            const frontH = guard.frontRailHeight || 1.1;
            const g1_top = { x: sin1 * b1.innerRadius, y: baseElev + frontH, z: cos1 * b1.innerRadius };
            const g2_top = { x: sin2 * b2.innerRadius, y: baseElev + frontH, z: cos2 * b2.innerRadius };

            // Top metallic handrail bar
            const barMidX = (g1_top.x + g2_top.x) / 2;
            const barMidZ = (g1_top.z + g2_top.z) / 2;
            const barLen = Math.hypot(g2_top.x - g1_top.x, g2_top.z - g1_top.z);
            const barRot = Math.atan2(g2_top.x - g1_top.x, g2_top.z - g1_top.z);
            solid.addBox(barMidX, baseElev + frontH, barMidZ, 0.08, 0.08, barLen, handrailCol, barRot);

            // Vertical stanchion post
            solid.addBox(g1_top.x, baseElev + frontH / 2, g1_top.z, 0.07, frontH, 0.07, handrailCol, 0);

            if (guard.material === 'tempered-glass') {
              alpha.addQuad(f1_top, g1_top, g2_top, f2_top, [0.55, 0.85, 0.98, 0.34]);
            } else if (guard.material === 'concrete-parapet') {
              solid.addQuad(f1_top, g1_top, g2_top, f2_top, [0.22, 0.26, 0.33, 1.0]);
            } else {
              // Steel balustrade mid rail + vertical pickets
              solid.addBox(barMidX, baseElev + frontH * 0.55, barMidZ, 0.06, 0.05, barLen, handrailCol, barRot);
              const pickets = 3;
              for (let p = 1; p < pickets; p++) {
                const pt = p / pickets;
                solid.addBox(
                  f1_top.x + (f2_top.x - f1_top.x) * pt,
                  baseElev + frontH / 2,
                  f1_top.z + (f2_top.z - f1_top.z) * pt,
                  0.04, frontH, 0.04, handrailCol, 0
                );
              }
            }
          }

          // Rear Concourse Wall
          if (guard.rearWallEnabled !== false) {
            const rearH = guard.rearWallHeight || 1.5;
            const rw1_b = { x: sin1 * b1.outerRadius, y: topElev, z: cos1 * b1.outerRadius };
            const rw2_b = { x: sin2 * b2.outerRadius, y: topElev, z: cos2 * b2.outerRadius };
            const rw2_t = { x: sin2 * b2.outerRadius, y: topElev + rearH, z: cos2 * b2.outerRadius };
            const rw1_t = { x: sin1 * b1.outerRadius, y: topElev + rearH, z: cos1 * b1.outerRadius };
            solid.addQuad(rw1_b, rw1_t, rw2_t, rw2_b, [0.14, 0.18, 0.26, 1.0]);
          }
        }

        // 2. Radial Stair Aisle & Central Aisle Handrail along startAngleDeg
        const guard = sec.guardrail || tier.defaultGuardrail || {};
        if (showGuardrails && guard.aisleHandrailEnabled !== false) {
          const bEdge = computeTierRadialBounds(this.venue, tierIndex, sDeg, sec.customRadialDepth);
          const radEdge = sDeg * DEG2RAD;
          const sinE = Math.sin(radEdge), cosE = -Math.cos(radEdge);
          const tanX = Math.cos(radEdge), tanZ = Math.sin(radEdge);

          // Highlighted concrete stair strip
          const hwAisle = radialAisleWidth * 0.4;
          solid.addQuad(
            { x: sinE * bEdge.innerRadius - tanX * hwAisle, y: baseElev + 0.06, z: cosE * bEdge.innerRadius - tanZ * hwAisle },
            { x: sinE * bEdge.outerRadius - tanX * hwAisle, y: topElev + 0.06, z: cosE * bEdge.outerRadius - tanZ * hwAisle },
            { x: sinE * bEdge.outerRadius + tanX * hwAisle, y: topElev + 0.06, z: cosE * bEdge.outerRadius + tanZ * hwAisle },
            { x: sinE * bEdge.innerRadius + tanX * hwAisle, y: baseElev + 0.06, z: cosE * bEdge.innerRadius + tanZ * hwAisle },
            stairStepCol,
            { x: 0, y: 1, z: 0 }
          );

          // Aisle handrail posts + sloped central rail
          const postCount = 4;
          for (let p = 0; p < postCount; p++) {
            const pf = p / (postCount - 1);
            const pr = bEdge.innerRadius + (bEdge.outerRadius - bEdge.innerRadius) * pf;
            const py = baseElev + (topElev - baseElev) * pf;
            solid.addBox(sinE * pr, py + 0.48, cosE * pr, 0.08, 0.96, 0.08, handrailCol, 0);
          }
          // Sloped rail bar
          const pStart = { x: sinE * bEdge.innerRadius, y: baseElev + 0.96, z: cosE * bEdge.innerRadius };
          const pEnd = { x: sinE * bEdge.outerRadius, y: topElev + 0.96, z: cosE * bEdge.outerRadius };
          const railSteps = 3;
          for (let rs = 0; rs < railSteps; rs++) {
            const fA = rs / railSteps, fB = (rs + 1) / railSteps;
            const xA = pStart.x + (pEnd.x - pStart.x) * fA;
            const yA = pStart.y + (pEnd.y - pStart.y) * fA;
            const zA = pStart.z + (pEnd.z - pStart.z) * fA;
            const xB = pStart.x + (pEnd.x - pStart.x) * fB;
            const yB = pStart.y + (pEnd.y - pStart.y) * fB;
            const zB = pStart.z + (pEnd.z - pStart.z) * fB;
            solid.addQuad(
              { x: xA - tanX * 0.05, y: yA, z: zA - tanZ * 0.05 },
              { x: xB - tanX * 0.05, y: yB, z: zB - tanZ * 0.05 },
              { x: xB + tanX * 0.05, y: yB, z: zB + tanZ * 0.05 },
              { x: xA + tanX * 0.05, y: yA, z: zA + tanZ * 0.05 },
              handrailCol
            );
          }
        }

        // 3. Vomitory Tunnel Portal Cutout & 3D Portal Frame
        const vom = sec.vomitory;
        const hasVom = showVomitories && vom && vom.position !== 'none' && vom.enabled !== false;
        let vomStartRow = -1, vomEndRow = -1, vomCenterDeg = midDeg, vomHalfAngleDeg = 0;

        if (hasVom) {
          vomStartRow = Math.max(1, vom.startRow || 5);
          vomEndRow = Math.min(totalRows, vomStartRow + (vom.rowSpan || 5));
          const bMid = computeTierRadialBounds(this.venue, tierIndex, midDeg, sec.customRadialDepth);
          const midR = (bMid.innerRadius + bMid.outerRadius) / 2;
          const vomWidth = vom.width || 3.2;
          vomHalfAngleDeg = ((vomWidth / 2) / Math.max(15, midR)) * (180 / Math.PI);

          const vRowF0 = (vomStartRow - 1) / Math.max(1, totalRows);
          const vRowF1 = vomEndRow / Math.max(1, totalRows);
          const vrIn = bMid.innerRadius + (bMid.outerRadius - bMid.innerRadius) * vRowF0;
          const vrOut = bMid.innerRadius + (bMid.outerRadius - bMid.innerRadius) * vRowF1;
          const vyIn = baseElev + (topElev - baseElev) * vRowF0;
          const vyOut = baseElev + (topElev - baseElev) * vRowF1;

          const vSin = Math.sin(midDeg * DEG2RAD), vCos = -Math.cos(midDeg * DEG2RAD);
          const vx = vSin * ((vrIn + vrOut) / 2);
          const vz = vCos * ((vrIn + vrOut) / 2);
          const rotVom = -midDeg * DEG2RAD;

          // Dark recessed tunnel interior box + concrete portal header + green EXIT glow strip
          solid.addBox(vx, vyIn + 1.1, vz, vomWidth, 2.2, Math.max(2.5, vrOut - vrIn), [0.03, 0.04, 0.07, 1.0], rotVom);
          solid.addBox(vSin * vrIn, vyIn + 2.35, vCos * vrIn, vomWidth + 0.6, 0.45, 0.6, [0.25, 0.30, 0.38, 1.0], rotVom);
          solid.addBox(vSin * vrIn, vyIn + 2.0, vCos * vrIn, vomWidth * 0.45, 0.25, 0.7, [0.08, 0.88, 0.48, 1.0], rotVom);
        }

        // 4. VIP Skybox Suites Partitions & Overhead Lounge Canopy
        if (isVip && sec.vipBoxRooms > 0) {
          const rooms = sec.vipBoxRooms;
          const bMidTop = computeTierRadialBounds(this.venue, tierIndex, midDeg, sec.customRadialDepth);
          for (let rm = 0; rm <= rooms; rm++) {
            const rDeg = sDeg + (rm / rooms) * angularSpan;
            const bR = computeTierRadialBounds(this.venue, tierIndex, rDeg, sec.customRadialDepth);
            const rSin = Math.sin(rDeg * DEG2RAD), rCos = -Math.cos(rDeg * DEG2RAD);
            const midR = (bR.innerRadius + bR.outerRadius) / 2;
            const depthR = bR.outerRadius - bR.innerRadius;
            solid.addBox(
              rSin * midR,
              (baseElev + topElev) / 2 + 1.4,
              rCos * midR,
              0.22,
              2.8,
              depthR,
              [0.32, 0.26, 0.18, 1.0],
              -rDeg * DEG2RAD
            );
          }
          // Warm glowing VIP suite ceiling canopy
          const b1 = computeTierRadialBounds(this.venue, tierIndex, sDeg, sec.customRadialDepth);
          const b2 = computeTierRadialBounds(this.venue, tierIndex, eDeg, sec.customRadialDepth);
          const sin1 = Math.sin(sDeg * DEG2RAD), cos1 = -Math.cos(sDeg * DEG2RAD);
          const sin2 = Math.sin(eDeg * DEG2RAD), cos2 = -Math.cos(eDeg * DEG2RAD);
          const canopyY = topElev + 2.7;
          solid.addQuad(
            { x: sin1 * (b1.innerRadius + 0.5), y: canopyY, z: cos1 * (b1.innerRadius + 0.5) },
            { x: sin1 * b1.outerRadius, y: canopyY, z: cos1 * b1.outerRadius },
            { x: sin2 * b2.outerRadius, y: canopyY, z: cos2 * b2.outerRadius },
            { x: sin2 * (b2.innerRadius + 0.5), y: canopyY, z: cos2 * (b2.innerRadius + 0.5) },
            [0.45, 0.34, 0.18, 1.0],
            { x: 0, y: -1, z: 0 }
          );
        }

        // 5. Fill EVERY SINGLE ROW with 3D Seats!
        const stride = (isNearSelected || isVip) ? 1 : globalSeatStride;
        const bMid = computeTierRadialBounds(this.venue, tierIndex, midDeg, sec.customRadialDepth);

        for (let r = 1; r <= totalRows; r++) {
          const rowFrac = totalRows > 1 ? (r - 0.5) / totalRows : 0.5;
          const rowElev = baseElev + (r - 1) * riserH;
          const approxR = bMid.innerRadius + (bMid.outerRadius - bMid.innerRadius) * rowFrac;

          // Angular margin reserved for radial stair aisles
          const aisleMarginDeg = ((radialAisleWidth * 0.55) / Math.max(12, approxR)) * (180 / Math.PI);
          const usableStartDeg = sDeg + aisleMarginDeg;
          const usableEndDeg = eDeg - aisleMarginDeg;
          if (usableEndDeg <= usableStartDeg) continue;

          const usableArcMeters = ((usableEndDeg - usableStartDeg) * DEG2RAD) * approxR;
          const stepUnitW = seatSpacing * stride;
          const seatsInRow = Math.max(2, Math.floor(usableArcMeters / stepUnitW));

          for (let si = 0; si < seatsInRow; si++) {
            const sFrac = (si + 0.5) / seatsInRow;
            const seatDeg = usableStartDeg + sFrac * (usableEndDeg - usableStartDeg);

            // Skip seats inside carved Vomitory opening
            if (hasVom && r >= vomStartRow && r <= vomEndRow && Math.abs(seatDeg - vomCenterDeg) < vomHalfAngleDeg) {
              continue;
            }

            const bSeat = computeTierRadialBounds(this.venue, tierIndex, seatDeg, sec.customRadialDepth);
            const seatR = bSeat.innerRadius + (bSeat.outerRadius - bSeat.innerRadius) * rowFrac;
            const sRad = seatDeg * DEG2RAD;
            const sx = Math.sin(sRad) * seatR;
            const sz = -Math.cos(sRad) * seatR;

            // Face inward toward stadium center (-sx, -sz)
            const fx = -Math.sin(sRad);
            const fz = Math.cos(sRad);

            solid.addSeat3D(
              sx,
              rowElev,
              sz,
              stepUnitW * 0.88,
              Math.min(0.48, rowPitch * 0.56),
              fx,
              fz,
              panCol,
              backCol
            );
          }
        }
      });
    });
  }

  buildStadiumCanopyRim(solid) {
    const summary = this.venue.engineeringSummary || {};
    const maxElev = (summary.maxBowlElevationM || 30) + 3.5;
    const tiers = this.venue.standTiers || [];
    const lastTierIdx = tiers.length - 1;
    if (lastTierIdx < 0) return;

    const segs = 64;
    const topCol = [0.24, 0.29, 0.38, 1.0];
    const soffitCol = [0.13, 0.17, 0.25, 1.0];
    const fasciaCol = [0.32, 0.38, 0.48, 1.0];
    const lightStripCol = [0.85, 0.92, 1.0, 1.0];
    const thickness = 1.6; // Real 3D thickness prevents ANY Z-fighting!

    for (let i = 0; i < segs; i++) {
      const deg1 = (i / segs) * 360;
      const deg2 = ((i + 1) / segs) * 360;
      if (this.venue.id === 'std-beijing-bird-nest' && (deg1 < 12 || deg1 > 348)) {
        continue;
      }

      const b1 = computeTierRadialBounds(this.venue, lastTierIdx, deg1);
      const b2 = computeTierRadialBounds(this.venue, lastTierIdx, deg2);

      const sin1 = Math.sin(deg1 * DEG2RAD), cos1 = -Math.cos(deg1 * DEG2RAD);
      const sin2 = Math.sin(deg2 * DEG2RAD), cos2 = -Math.cos(deg2 * DEG2RAD);

      const rIn1 = b1.outerRadius - 14;
      const rOut1 = b1.outerRadius + 5;
      const rIn2 = b2.outerRadius - 14;
      const rOut2 = b2.outerRadius + 5;

      let saddle1 = 0, saddle2 = 0;
      if (this.venue.id === 'std-beijing-bird-nest') {
        saddle1 = Math.sin(deg1 * DEG2RAD) * Math.sin(deg1 * DEG2RAD) * 8.5;
        saddle2 = Math.sin(deg2 * DEG2RAD) * Math.sin(deg2 * DEG2RAD) * 8.5;
      }

      const yBot1 = maxElev + saddle1;
      const yBot2 = maxElev + saddle2;
      const yTop1 = yBot1 + thickness;
      const yTop2 = yBot2 + thickness;

      // Top canopy surface
      solid.addQuad(
        { x: sin1 * rIn1, y: yTop1 + 0.8, z: cos1 * rIn1 },
        { x: sin1 * rOut1, y: yTop1, z: cos1 * rOut1 },
        { x: sin2 * rOut2, y: yTop2, z: cos2 * rOut2 },
        { x: sin2 * rIn2, y: yTop2 + 0.8, z: cos2 * rIn2 },
        topCol,
        { x: 0, y: 1, z: 0 }
      );

      // Bottom soffit surface (separated by 1.6m!)
      solid.addQuad(
        { x: sin1 * rOut1, y: yBot1, z: cos1 * rOut1 },
        { x: sin1 * rIn1, y: yBot1 + 0.8, z: cos1 * rIn1 },
        { x: sin2 * rIn2, y: yBot2 + 0.8, z: cos2 * rIn2 },
        { x: sin2 * rOut2, y: yBot2, z: cos2 * rOut2 },
        soffitCol,
        { x: 0, y: -1, z: 0 }
      );

      // Inner tension-ring fascia + steady stadium floodlight blocks (every 4th segment)
      solid.addQuad(
        { x: sin1 * rIn1, y: yBot1 + 0.8, z: cos1 * rIn1 },
        { x: sin1 * rIn1, y: yTop1 + 0.8, z: cos1 * rIn1 },
        { x: sin2 * rIn2, y: yTop2 + 0.8, z: cos2 * rIn2 },
        { x: sin2 * rIn2, y: yBot2 + 0.8, z: cos2 * rIn2 },
        fasciaCol
      );

      if (i % 4 === 0) {
        const midDeg = (deg1 + deg2) / 2;
        const mSin = Math.sin(midDeg * DEG2RAD), mCos = -Math.cos(midDeg * DEG2RAD);
        const mR = (rIn1 + rIn2) / 2;
        solid.addBox(mSin * mR, (yBot1 + yBot2) / 2 + 0.5, mCos * mR, 2.4, 0.7, 0.8, lightStripCol, -midDeg * DEG2RAD);
      }
    }
  }

  buildConcertStageMesh(solid, beams) {
    const infield = this.venue.infield;
    const stage = infield && infield.stageConfig;
    if (!stage) return;

    const sw = stage.width || 36;
    const sd = stage.depth || 22;
    const sh = stage.height || 2.0;
    const backH = stage.backdropHeight || 14;
    const cw = stage.catwalkWidth || 3.5;
    const halfW = (infield.width || 60) / 2 - 4;
    const halfL = (infield.length || 100) / 2 - 4;

    if (stage.type === 'center-stage') {
      solid.addBox(0, sh / 2, 0, sw, sh, sd, [0.12, 0.14, 0.20, 1.0], 0);
      solid.addQuad(
        { x: -sw / 2 + 0.6, y: sh + 0.12, z: -sd / 2 + 0.6 },
        { x: -sw / 2 + 0.6, y: sh + 0.12, z: sd / 2 - 0.6 },
        { x: sw / 2 - 0.6, y: sh + 0.12, z: sd / 2 - 0.6 },
        { x: sw / 2 - 0.6, y: sh + 0.12, z: -sd / 2 + 0.6 },
        [0.88, 0.16, 0.46, 1.0],
        { x: 0, y: 1, z: 0 }
      );

      const clZ = Math.min(stage.catwalkLength || 10, Math.max(3, halfL - sd / 2 - 1));
      const clX = Math.min(stage.catwalkLength || 10, Math.max(2, halfW - sw / 2 - 1));
      solid.addBox(0, sh / 2, -sd / 2 - clZ / 2, cw, sh, clZ, [0.85, 0.15, 0.38, 1.0], 0);
      solid.addBox(0, sh / 2, sd / 2 + clZ / 2, cw, sh, clZ, [0.85, 0.15, 0.38, 1.0], 0);
      if (clX > 1.5) {
        solid.addBox(-sw / 2 - clX / 2, sh / 2, 0, clX, sh, cw, [0.85, 0.15, 0.38, 1.0], 0);
        solid.addBox(sw / 2 + clX / 2, sh / 2, 0, clX, sh, cw, [0.85, 0.15, 0.38, 1.0], 0);
      }

      const rigY = sh + backH * 0.88;
      solid.addBox(0, rigY, 0, sw * 0.68, backH * 0.62, sd * 0.68, [0.08, 0.65, 0.95, 1.0], 0);

      const beamColors = [
        [0.95, 0.28, 0.56, 0.18],
        [0.24, 0.72, 0.98, 0.18],
        [0.65, 0.32, 0.95, 0.18]
      ];
      for (let i = 0; i < 8; i++) {
        const ang = (i / 8) * Math.PI * 2;
        const bx = Math.cos(ang) * (sw * 0.32);
        const bz = Math.sin(ang) * (sd * 0.32);
        const tx = Math.cos(ang) * (sw * 1.2);
        const tz = Math.sin(ang) * (sd * 1.2);
        beams.addTriangle(
          { x: bx, y: rigY + 1.5, z: bz },
          { x: tx - Math.sin(ang) * 2.5, y: sh + 0.2, z: tz + Math.cos(ang) * 2.5 },
          { x: tx + Math.sin(ang) * 2.5, y: sh + 0.2, z: tz - Math.cos(ang) * 2.5 },
          beamColors[i % beamColors.length]
        );
      }
      return;
    }

    // End-Stage or Festival-Stage
    const stageZ = -Math.min((infield.pitchLength || 100) * 0.36, halfL - sd / 2 - 2);
    const cl = stage.catwalkLength || 18;

    solid.addBox(0, sh / 2, stageZ, sw, sh, sd, [0.14, 0.16, 0.24, 1.0], 0);
    solid.addQuad(
      { x: -sw / 2 + 1, y: sh + 0.12, z: stageZ - sd / 2 + 1 },
      { x: -sw / 2 + 1, y: sh + 0.12, z: stageZ + sd / 2 - 1 },
      { x: sw / 2 - 1, y: sh + 0.12, z: stageZ + sd / 2 - 1 },
      { x: sw / 2 - 1, y: sh + 0.12, z: stageZ - sd / 2 + 1 },
      [0.86, 0.16, 0.45, 1.0],
      { x: 0, y: 1, z: 0 }
    );

    const catZ = stageZ + sd / 2 + cl / 2;
    solid.addBox(0, sh / 2, catZ, cw, sh, cl, [0.85, 0.15, 0.42, 1.0], 0);
    solid.addBox(0, sh / 2, stageZ + sd / 2 + cl + 2.5, cw * 2.1, sh, 5, [0.95, 0.24, 0.48, 1.0], 0);

    // Main LED Screen + Side Angled IMAX Wing Screens
    const screenZ = stageZ - sd / 2 + 1.5;
    solid.addBox(0, sh + backH / 2, screenZ, sw * 0.92, backH, 1.2, [0.06, 0.58, 0.92, 1.0], 0);

    const wingW = sw * 0.36;
    const wingH = backH * 0.86;
    solid.addBox(-sw * 0.66, sh + wingH / 2, screenZ + 4, wingW, wingH, 1.0, [0.55, 0.24, 0.92, 1.0], 0.35);
    solid.addBox(sw * 0.66, sh + wingH / 2, screenZ + 4, wingW, wingH, 1.0, [0.55, 0.24, 0.92, 1.0], -0.35);

    // Overhead Truss Rig & Towers
    const trussH = sh + backH + 1.5;
    solid.addBox(0, trussH, stageZ, sw * 1.04, 1.6, sd * 0.88, [0.35, 0.42, 0.52, 1.0], 0);
    solid.addBox(-sw * 0.48, (sh + backH) / 2, stageZ - sd * 0.4, 1.1, sh + backH, 1.1, [0.3, 0.36, 0.45, 1.0], 0);
    solid.addBox(sw * 0.48, (sh + backH) / 2, stageZ - sd * 0.4, 1.1, sh + backH, 1.1, [0.3, 0.36, 0.45, 1.0], 0);
    solid.addBox(-sw * 0.48, (sh + backH) / 2, stageZ + sd * 0.4, 1.1, sh + backH, 1.1, [0.3, 0.36, 0.45, 1.0], 0);
    solid.addBox(sw * 0.48, (sh + backH) / 2, stageZ + sd * 0.4, 1.1, sh + backH, 1.1, [0.3, 0.36, 0.45, 1.0], 0);

    // FOH Sound/Light Tower
    if (stage.fohEnabled) {
      const fohZ = stageZ + sd / 2 + (stage.fohDistance || 38);
      const fw = stage.fohWidth || 8;
      const fd = stage.fohDepth || 5;
      solid.addBox(0, 1.8, fohZ, fw, 3.6, fd, [0.08, 0.38, 0.65, 1.0], 0);
    }

    // Soft Volumetric Stage Light Beams (non-flashing)
    const numBeams = 8;
    const beamCols = [
      [0.98, 0.22, 0.52, 0.16],
      [0.18, 0.78, 0.98, 0.16],
      [0.68, 0.28, 0.98, 0.16]
    ];
    for (let i = 0; i < numBeams; i++) {
      const frac = (i / (numBeams - 1)) - 0.5;
      const bx = frac * sw * 0.85;
      const origin = { x: bx, y: trussH - 0.5, z: stageZ + 2 };
      const targetZ = stageZ + sd + 12 + (i % 2) * 10;
      const spreadX = bx * 1.45;
      beams.addTriangle(
        origin,
        { x: spreadX - 3.8, y: 0.25, z: targetZ },
        { x: spreadX + 3.8, y: 0.25, z: targetZ },
        beamCols[i % beamCols.length]
      );
    }
  }

  buildSportsEquipmentMesh(solid) {
    const infield = this.venue.infield;
    if (!infield) return;
    const hl = (infield.pitchLength || 105) / 2;
    const whiteCol = [0.95, 0.97, 1.0, 1.0];

    if (infield.surfaceType === 'hardwood-court') {
      // Basketball stanchions & backboards
      solid.addBox(0, 1.8, -hl - 0.8, 0.4, 3.6, 0.4, [0.15, 0.20, 0.30, 1.0], 0);
      solid.addBox(0, 3.3, -hl + 0.4, 1.8, 1.05, 0.1, whiteCol, 0);
      solid.addBox(0, 1.8, hl + 0.8, 0.4, 3.6, 0.4, [0.15, 0.20, 0.30, 1.0], 0);
      solid.addBox(0, 3.3, hl - 0.4, 1.8, 1.05, 0.1, whiteCol, 0);
    } else {
      // Football goals
      solid.addBox(0, 1.22, -hl, 7.32, 2.44, 0.3, whiteCol, 0);
      solid.addBox(0, 1.22, hl, 7.32, 2.44, 0.3, whiteCol, 0);
    }
  }

  uploadMesh(meshBuilder) {
    const gl = this.gl;
    const count = meshBuilder.positions.length / 3;
    if (count === 0) return { count: 0 };

    const posBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(meshBuilder.positions), gl.STATIC_DRAW);

    const normBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, normBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(meshBuilder.normals), gl.STATIC_DRAW);

    const colBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, colBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(meshBuilder.colors), gl.STATIC_DRAW);

    return { posBuf, normBuf, colBuf, count };
  }

  drawBufferGroup(bufGroup, isUnlit) {
    if (!bufGroup || bufGroup.count === 0) return;
    const gl = this.gl;

    gl.uniform1f(this.uniIsUnlit, isUnlit ? 1.0 : 0.0);

    gl.bindBuffer(gl.ARRAY_BUFFER, bufGroup.posBuf);
    gl.enableVertexAttribArray(this.attribPos);
    gl.vertexAttribPointer(this.attribPos, 3, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, bufGroup.normBuf);
    gl.enableVertexAttribArray(this.attribNorm);
    gl.vertexAttribPointer(this.attribNorm, 3, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, bufGroup.colBuf);
    gl.enableVertexAttribArray(this.attribCol);
    gl.vertexAttribPointer(this.attribCol, 4, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.TRIANGLES, 0, bufGroup.count);
  }

  renderFrame() {
    const gl = this.gl;
    if (!gl || !this.program) return;

    const lerp = 0.14;
    this.camEye.x += (this.targetEye.x - this.camEye.x) * lerp;
    this.camEye.y += (this.targetEye.y - this.camEye.y) * lerp;
    this.camEye.z += (this.targetEye.z - this.camEye.z) * lerp;

    // Hard floor guard so camera NEVER dips underneath the stadium during transitions
    const minEyeY = this.cameraMode === 'bird' ? 14.0 : 1.1;
    if (this.camEye.y < minEyeY) this.camEye.y = minEyeY;

    this.camTarget.x += (this.targetLook.x - this.camTarget.x) * lerp;
    this.camTarget.y += (this.targetLook.y - this.camTarget.y) * lerp;
    this.camTarget.z += (this.targetLook.z - this.camTarget.z) * lerp;

    const effectiveFovDeg = Math.max(12, Math.min(90, this.baseFovDeg / Math.pow(this.zoomLevel || 1, 0.85)));
    const aspect = (this.width || 375) / Math.max(1, this.height || 400);

    const nearPlane = this.cameraMode === 'bird' ? 2.5 : 0.8;
    Mat4.perspective(this.projMat, effectiveFovDeg * DEG2RAD, aspect, nearPlane, 950.0);
    Mat4.lookAt(this.viewMat, this.camEye, this.camTarget, { x: 0, y: 1, z: 0 });
    Mat4.multiply(this.mvpMat, this.projMat, this.viewMat);

    gl.viewport(0, 0, this.width, this.height);
    gl.clearColor(0.03, 0.045, 0.09, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.useProgram(this.program);
    gl.uniformMatrix4fv(this.uniMVP, false, this.mvpMat);
    const elapsedSec = (Date.now() - this.startTime) * 0.001;
    gl.uniform1f(this.uniTime, elapsedSec);

    // 1. Opaque stadium, seats, vomitories, trusses & stage
    gl.disable(gl.BLEND);
    gl.depthMask(true);
    this.drawBufferGroup(this.solidBuffers, false);

    // 2. Tempered glass guardrails
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    this.drawBufferGroup(this.alphaBuffers, false);

    // 3. Soft concert stage spotlight beams
    if (this.viewMode === 'concert') {
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      this.drawBufferGroup(this.beamBuffers, true);
    }

    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }
}

module.exports = {
  Renderer3D
};

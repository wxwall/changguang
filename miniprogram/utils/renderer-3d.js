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
  rotateXZ,
  evalTierPoint,
  getInfieldCornerTransitionAngles,
  getRowInwardNormal,
  getRayRoundedRectDistance,
  computeRunningTrackSpec,
  getStageTransform,
  computeVomitoryAngularBounds,
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
      gl_FragColor = vColor;
      return;
    }
    vec3 norm = normalize(vNormal);
    // Pure matte non-reflective shading: soft hemisphere + gentle wrapped diffuse, zero specular glare
    float hemi = 0.5 + 0.5 * norm.y;
    float wrap = max(0.0, (dot(norm, normalize(vec3(0.24, 0.94, 0.24))) + 0.65) / 1.65);
    float lighting = 0.68 + 0.18 * hemi + 0.12 * wrap;

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
    const hw = seatWidth * 0.475;
    const hd = seatDepth * 0.46;
    const panY = cy + 0.28;
    const backTopY = cy + 0.74;

    // Matte seat pan quad
    const pFL = { x: cx - rx * hw + fx * hd, y: panY, z: cz - rz * hw + fz * hd };
    const pFR = { x: cx + rx * hw + fx * hd, y: panY, z: cz + rz * hw + fz * hd };
    const pBR = { x: cx + rx * hw - fx * hd * 0.75, y: panY, z: cz + rz * hw - fz * hd * 0.75 };
    const pBL = { x: cx - rx * hw - fx * hd * 0.75, y: panY, z: cz - rz * hw - fz * hd * 0.75 };
    this.addQuad(pBL, pFL, pFR, pBR, panColor, { x: 0, y: 1, z: 0 });

    // Matte angled backrest quad with soft upward-biased normal (prevents directional glare/banding)
    const bTL = { x: cx - rx * hw - fx * hd * 0.92, y: backTopY, z: cz - rz * hw - fz * hd * 0.92 };
    const bTR = { x: cx + rx * hw - fx * hd * 0.92, y: backTopY, z: cz + rz * hw - fz * hd * 0.92 };
    this.addQuad(pBL, pBR, bTR, bTL, backColor, { x: fx * 0.48, y: 0.86, z: fz * 0.48 });
  }

  /**
   * Adds a crisp 3D volumetric bar/handrail between two 3D endpoints p1 and p2.
   * Visible from every viewing angle (unlike flat single-sided quads).
   */
  addBeam3D(p1, p2, thickness, height, color) {
    const dx = p2.x - p1.x;
    const dz = p2.z - p1.z;
    const hLen = Math.hypot(dx, dz);
    let tx = 1;
    let tz = 0;
    if (hLen > 1e-5) {
      tx = -dz / hLen;
      tz = dx / hLen;
    }
    const hw = thickness * 0.5;
    const hh = height * 0.5;

    const a0 = { x: p1.x - tx * hw, y: p1.y - hh, z: p1.z - tz * hw };
    const a1 = { x: p1.x + tx * hw, y: p1.y - hh, z: p1.z + tz * hw };
    const a2 = { x: p1.x + tx * hw, y: p1.y + hh, z: p1.z + tz * hw };
    const a3 = { x: p1.x - tx * hw, y: p1.y + hh, z: p1.z - tz * hw };

    const b0 = { x: p2.x - tx * hw, y: p2.y - hh, z: p2.z - tz * hw };
    const b1 = { x: p2.x + tx * hw, y: p2.y - hh, z: p2.z + tz * hw };
    const b2 = { x: p2.x + tx * hw, y: p2.y + hh, z: p2.z + tz * hw };
    const b3 = { x: p2.x - tx * hw, y: p2.y + hh, z: p2.z - tz * hw };

    // Top, Bottom, Left, Right faces + end caps
    this.addQuad(a3, b3, b2, a2, color, { x: 0, y: 1, z: 0 });
    this.addQuad(a1, b1, b0, a0, color, { x: 0, y: -1, z: 0 });
    this.addQuad(a0, b0, b3, a3, color);
    this.addQuad(a2, b2, b1, a1, color);
    this.addQuad(a0, a3, a2, a1, color);
    this.addQuad(b1, b2, b3, b0, color);
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

  setVenue(venue, viewMode, selection) {
    this.venue = venue;
    if (viewMode) this.viewMode = viewMode;
    if (selection) {
      this.selectedSectorId = selection.sectorId || null;
      this.selectedModuleId = selection.moduleId || null;
      this.selectedFloorBlockId = selection.floorBlockId || null;
    }
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
      // Reversed 3D drag controls (both horizontal & vertical) per user preference
      this.orbitYaw += dxPx * 0.007;
      // Clamp orbitPitch strictly between 17 deg and 79 deg so camera never dips under stadium
      this.orbitPitch = Math.max(0.30, Math.min(1.38, this.orbitPitch - dyPx * 0.006));
      this.updateBirdCameraTarget();
    } else {
      const sensitivity = 0.0035 / Math.sqrt(this.zoomLevel || 1);
      this.seatYawOffset += dxPx * sensitivity;
      this.seatPitchOffset = Math.max(-0.55, Math.min(0.55, this.seatPitchOffset + dyPx * sensitivity));
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

    // 3. Schema Infield Modules (sports sideline seating only — prevents clash with rotated concert stage)
    if (this.viewMode === 'sports') {
      this.buildInfieldModulesMesh(solid);
    }

    // 4. Stand Tiers: Stepped concrete rows, row-by-row 3D seats, radial stairs + handrails,
    //    carved vomitory tunnels, VIP skybox rooms, front guardrails
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
    const isMorphedLast = lastTier.morphMode === 'concentric-circle' && (lastTier.concentricMorph || 0) > 0.1;

    const ringAngles = this.buildFullRingAngles(180);
    const shellCol = [0.10, 0.13, 0.19, 1.0];

    for (let i = 0; i < ringAngles.length - 1; i++) {
      const deg1 = ringAngles[i];
      const deg2 = ringAngles[i + 1];
      const pt1 = evalTierPoint(this.venue, lastTierIdx, deg1, 1);
      const pt2 = evalTierPoint(this.venue, lastTierIdx, deg2, 1);

      const pad = 1.5;
      const rLen1 = Math.hypot(pt1.outX, pt1.outZ) || 1;
      const rLen2 = Math.hypot(pt2.outX, pt2.outZ) || 1;
      const x1 = pt1.outX + (isMorphedLast ? (pt1.outX / rLen1) * pad : pt1.nx * pad);
      const z1 = pt1.outZ + (isMorphedLast ? (pt1.outZ / rLen1) * pad : pt1.nz * pad);
      const x2 = pt2.outX + (isMorphedLast ? (pt2.outX / rLen2) * pad : pt2.nx * pad);
      const z2 = pt2.outZ + (isMorphedLast ? (pt2.outZ / rLen2) * pad : pt2.nz * pad);

      const p1_b = { x: x1, y: -0.60, z: z1 };
      const p2_b = { x: x2, y: -0.60, z: z2 };
      const p2_t = { x: x2, y: topWallY, z: z2 };
      const p1_t = { x: x1, y: topWallY, z: z1 };

      solid.addQuad(p1_b, p1_t, p2_t, p2_b, shellCol);
    }
  }

  buildFullRingAngles(segs) {
    const cornerAngles = getInfieldCornerTransitionAngles(this.venue);
    const raw = [];
    for (let i = 0; i <= segs; i++) {
      raw.push((i / segs) * 360);
    }
    cornerAngles.forEach((ca) => {
      if (ca > 0.1 && ca < 359.9) raw.push(ca);
    });
    raw.sort((a, b) => a - b);
    const out = [];
    raw.forEach((d) => {
      if (out.length === 0 || d - out[out.length - 1] > 0.05) {
        out.push(d);
      }
    });
    if (out[out.length - 1] < 359.99) out.push(360);
    return out;
  }

  buildSectorAngleList(sDeg, eDeg, cornerAngles, extraAngles, isMorphed, tierIndex) {
    const stops = [sDeg];
    cornerAngles.forEach((ca) => {
      if (ca > sDeg + 0.06 && ca < eDeg - 0.06) stops.push(ca);
      if (ca + 360 > sDeg + 0.06 && ca + 360 < eDeg - 0.06) stops.push(ca + 360);
    });
    if (extraAngles) {
      extraAngles.forEach((ea) => {
        if (ea > sDeg + 0.04 && ea < eDeg - 0.04) stops.push(ea);
      });
    }
    stops.push(eDeg);
    stops.sort((a, b) => a - b);

    const uniqueStops = [];
    stops.forEach((d) => {
      if (uniqueStops.length === 0 || d - uniqueStops[uniqueStops.length - 1] > 0.03) {
        uniqueStops.push(d);
      }
    });
    if (uniqueStops[uniqueStops.length - 1] < eDeg - 0.01) uniqueStops.push(eDeg);
    else uniqueStops[uniqueStops.length - 1] = eDeg;

    const out = [uniqueStops[0]];
    const tIdx = tierIndex || 0;
    for (let i = 0; i < uniqueStops.length - 1; i++) {
      const a = uniqueStops[i];
      const b = uniqueStops[i + 1];
      const subSpan = b - a;
      let isCurved = !!isMorphed;
      if (!isCurved && this.venue) {
        const pMid = evalTierPoint(this.venue, tIdx, (a + b) / 2, 0.5);
        // Straight infield edges have exact axis-aligned normals (±1, 0) or (0, ±1)
        const onStraight = (Math.abs(pMid.nx) > 0.999 && Math.abs(pMid.nz) < 1e-3) ||
                           (Math.abs(pMid.nz) > 0.999 && Math.abs(pMid.nx) < 1e-3);
        isCurved = !onStraight;
      }
      const stepSize = isCurved ? 1.5 : 8.0;
      const nSub = Math.max(isCurved ? 2 : 1, Math.ceil(subSpan / stepSize));
      for (let k = 1; k <= nSub; k++) {
        out.push(a + subSpan * (k / nSub));
      }
    }
    return out;
  }

  buildInfieldMesh(solid) {
    const infield = this.venue.infield;
    if (!infield) return;

    const ringAngles = this.buildFullRingAngles(144);
    const isTrack = infield.sportPreset === 'track-field' || infield.surfaceType === 'synthetic-track';
    let baseColor = [0.05, 0.25, 0.19, 1.0];
    if (infield.surfaceType === 'hardwood-court') {
      baseColor = [0.12, 0.16, 0.24, 1.0];
    } else if (isTrack) {
      baseColor = [0.05, 0.27, 0.20, 1.0];
    }

    // Outer infield base surface at y = 0.00 (cleanly separated from plaza at -0.60)
    for (let i = 0; i < ringAngles.length - 1; i++) {
      const deg1 = ringAngles[i];
      const deg2 = ringAngles[i + 1];
      const r1 = getRayRoundedRectDistance(deg1, infield.length, infield.width, infield.cornerRadius);
      const r2 = getRayRoundedRectDistance(deg2, infield.length, infield.width, infield.cornerRadius);

      const p1 = { x: Math.sin(deg1 * DEG2RAD) * r1, y: 0.0, z: -Math.cos(deg1 * DEG2RAD) * r1 };
      const p2 = { x: Math.sin(deg2 * DEG2RAD) * r2, y: 0.0, z: -Math.cos(deg2 * DEG2RAD) * r2 };
      solid.addTriangle({ x: 0, y: 0.0, z: 0 }, p1, p2, baseColor, { x: 0, y: 1, z: 0 });
    }

    // Strict parameter-computed running track belt + green inner apron + lane markings
    if (isTrack) {
      const spec = computeRunningTrackSpec(infield);
      const trackBrickCol = [0.58, 0.19, 0.10, 1.0];
      const innerApronCol = [0.04, 0.34, 0.23, 1.0];
      const laneCol = [0.92, 0.94, 0.98, 1.0];

      for (let i = 0; i < ringAngles.length - 1; i++) {
        const deg1 = ringAngles[i];
        const deg2 = ringAngles[i + 1];
        const sin1 = Math.sin(deg1 * DEG2RAD), cos1 = -Math.cos(deg1 * DEG2RAD);
        const sin2 = Math.sin(deg2 * DEG2RAD), cos2 = -Math.cos(deg2 * DEG2RAD);

        const rOut1 = getRayRoundedRectDistance(deg1, spec.outerTrackLength, spec.outerTrackWidth, spec.outerTrackCornerRadius);
        const rOut2 = getRayRoundedRectDistance(deg2, spec.outerTrackLength, spec.outerTrackWidth, spec.outerTrackCornerRadius);
        const rIn1 = getRayRoundedRectDistance(deg1, spec.innerApronLength, spec.innerApronWidth, spec.innerApronCornerRadius);
        const rIn2 = getRayRoundedRectDistance(deg2, spec.innerApronLength, spec.innerApronWidth, spec.innerApronCornerRadius);

        // Track surface ring quad at y = 0.018
        solid.addQuad(
          { x: sin1 * rIn1, y: 0.018, z: cos1 * rIn1 },
          { x: sin1 * rOut1, y: 0.018, z: cos1 * rOut1 },
          { x: sin2 * rOut2, y: 0.018, z: cos2 * rOut2 },
          { x: sin2 * rIn2, y: 0.018, z: cos2 * rIn2 },
          trackBrickCol,
          { x: 0, y: 1, z: 0 }
        );

        // Inner green D-zone & apron surface at y = 0.036
        solid.addTriangle(
          { x: 0, y: 0.036, z: 0 },
          { x: sin1 * rIn1, y: 0.036, z: cos1 * rIn1 },
          { x: sin2 * rIn2, y: 0.036, z: cos2 * rIn2 },
          innerApronCol,
          { x: 0, y: 1, z: 0 }
        );
      }

      // Exact schema-computed lane lines (lanes + 1 boundaries spaced by laneWidth)
      for (let lane = 0; lane <= spec.lanes; lane++) {
        const shrink = lane * spec.laneWidth;
        const lenL = spec.outerTrackLength - shrink * 2;
        const widL = spec.outerTrackWidth - shrink * 2;
        const radL = Math.max(2, spec.outerTrackCornerRadius - shrink);
        const halfLineW = (lane === 0 || lane === spec.lanes) ? 0.10 : 0.07;

        for (let i = 0; i < ringAngles.length - 1; i++) {
          const deg1 = ringAngles[i];
          const deg2 = ringAngles[i + 1];
          const sin1 = Math.sin(deg1 * DEG2RAD), cos1 = -Math.cos(deg1 * DEG2RAD);
          const sin2 = Math.sin(deg2 * DEG2RAD), cos2 = -Math.cos(deg2 * DEG2RAD);
          const r1 = getRayRoundedRectDistance(deg1, lenL, widL, radL);
          const r2 = getRayRoundedRectDistance(deg2, lenL, widL, radL);
          solid.addQuad(
            { x: sin1 * (r1 - halfLineW), y: 0.055, z: cos1 * (r1 - halfLineW) },
            { x: sin1 * (r1 + halfLineW), y: 0.055, z: cos1 * (r1 + halfLineW) },
            { x: sin2 * (r2 + halfLineW), y: 0.055, z: cos2 * (r2 + halfLineW) },
            { x: sin2 * (r2 - halfLineW), y: 0.055, z: cos2 * (r2 - halfLineW) },
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
    const pitchOri = infield.pitchOrientationDeg || 0;
    const addPitchQuad = (lx1, lz1, lx2, lz2, lx3, lz3, lx4, lz4, y, col) => {
      const p1 = rotateXZ(lx1, lz1, pitchOri);
      const p2 = rotateXZ(lx2, lz2, pitchOri);
      const p3 = rotateXZ(lx3, lz3, pitchOri);
      const p4 = rotateXZ(lx4, lz4, pitchOri);
      solid.addQuad(
        { x: p1.x, y, z: p1.z },
        { x: p2.x, y, z: p2.z },
        { x: p3.x, y, z: p3.z },
        { x: p4.x, y, z: p4.z },
        col,
        { x: 0, y: 1, z: 0 }
      );
    };

    if (infield.surfaceType === 'hardwood-court') {
      // Hardwood basketball court at y = 0.08
      addPitchQuad(-hw, -hl, -hw, hl, hw, hl, hw, -hl, 0.08, [0.78, 0.46, 0.17, 1.0]);
      // Key paint at y = 0.12
      addPitchQuad(-2.45, -hl, -2.45, -hl + 5.8, 2.45, -hl + 5.8, 2.45, -hl, 0.12, [0.14, 0.38, 0.84, 1.0]);
      addPitchQuad(-2.45, hl - 5.8, -2.45, hl, 2.45, hl, 2.45, hl - 5.8, 0.12, [0.14, 0.38, 0.84, 1.0]);
    } else {
      // Mowed grass stripes at y = 0.08
      const stripes = 12;
      const stripeLen = pl / stripes;
      for (let i = 0; i < stripes; i++) {
        const z1 = -hl + i * stripeLen;
        const z2 = z1 + stripeLen;
        const col = i % 2 === 0 ? [0.05, 0.45, 0.31, 1.0] : [0.07, 0.53, 0.36, 1.0];
        addPitchQuad(-hw, z1, -hw, z2, hw, z2, hw, z1, 0.08, col);
      }

      // Crisp white pitch lines at y = 0.14
      const lw = 0.35;
      const lineCol = [0.92, 0.96, 1.0, 1.0];
      addPitchQuad(-hw, -lw / 2, -hw, lw / 2, hw, lw / 2, hw, -lw / 2, 0.14, lineCol);
      addPitchQuad(-hw, -hl, -hw, -hl + lw, hw, -hl + lw, hw, -hl, 0.14, lineCol);
      addPitchQuad(-hw, hl - lw, -hw, hl, hw, hl, hw, hl - lw, 0.14, lineCol);
      addPitchQuad(-hw, -hl, -hw + lw, -hl, -hw + lw, hl, -hw, hl, 0.14, lineCol);
      addPitchQuad(hw - lw, -hl, hw, -hl, hw, hl, hw - lw, hl, 0.14, lineCol);
    }
  }

  buildInfieldModulesMesh(solid) {
    const modules = this.venue.infieldModules || [];
    modules.forEach((mod) => {
      // Neutral metallic rail & consistent seat colors (no pink 3D border)
      const seatPanCol = [0.10, 0.78, 0.56, 1.0];
      const seatBackCol = [0.04, 0.52, 0.36, 1.0];
      const railCol = [0.84, 0.88, 0.94, 1.0];

      const rotRad = (mod.rotationDeg || 0) * DEG2RAD;
      const cosR = Math.cos(rotRad);
      const sinR = Math.sin(rotRad);
      const cx = mod.x || 0;
      const cz = mod.y || 0;
      const w = mod.width || 24;
      const d = mod.depth || 5;
      const baseElev = mod.baseElevation || 0;

      // Platform deck
      solid.addBox(cx, baseElev + 0.15, cz, w, 0.3, d, [0.20, 0.25, 0.34, 1.0], rotRad);

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

      // Open perimeter safety rail bar
      solid.addBox(cx, baseElev + 0.95, cz, w + 0.2, 0.08, 0.08, railCol, rotRad);
    });
  }

  buildConcertInfieldSeatsMesh(solid) {
    const blocks = generateConcertInfieldBlocks(this.venue);
    blocks.forEach((blk) => {
      // Matte fabric seat & subtle dark-slate floor mat
      const panCol = [0.18, 0.42, 0.76, 1.0];
      const backCol = [0.14, 0.34, 0.64, 1.0];
      const railCol = [0.58, 0.64, 0.72, 1.0];
      const rotDeg = blk.rotDeg || 0;
      const rotYRad = -rotDeg * DEG2RAD;
      const hw = blk.width / 2;
      const hd = blk.depth / 2;

      const matPt = (lx, lz) => {
        const rp = rotateXZ(lx, lz, rotDeg);
        return { x: blk.x + rp.x, y: 0.14, z: blk.z + rp.z };
      };

      // Subtle rotated floor mat base
      solid.addQuad(
        matPt(-hw, -hd),
        matPt(-hw, hd),
        matPt(hw, hd),
        matPt(hw, -hd),
        [0.08, 0.11, 0.17, 1.0],
        { x: 0, y: 1, z: 0 }
      );

      // Populate individual 3D seats row by row facing the stage
      const rows = blk.rows || 8;
      const seatSpacing = blk.seatSpacing || 0.52;
      const stride = (blk.width / seatSpacing) * rows > 400 ? 2 : 1;
      const seatCount = Math.max(4, Math.floor((blk.width - 0.6) / (seatSpacing * stride)));

      for (let r = 0; r < rows; r++) {
        const localZ = -hd + (r + 0.5) * (blk.depth / rows);
        for (let s = 0; s < seatCount; s++) {
          const localX = -(blk.width - 0.6) / 2 + (s + 0.5) * ((blk.width - 0.6) / seatCount);
          const wp = rotateXZ(localX, localZ, rotDeg);
          solid.addSeat3D(
            blk.x + wp.x,
            0.14,
            blk.z + wp.z,
            seatSpacing * stride * 0.94,
            0.50,
            blk.facingX || 0,
            blk.facingZ !== undefined ? blk.facingZ : -1,
            panCol,
            backCol
          );
        }
      }

      // Clean perimeter open safety rails
      const barY = 0.85;
      const frontP = rotateXZ(0, -hd, rotDeg);
      const backP = rotateXZ(0, hd, rotDeg);
      solid.addBox(blk.x + frontP.x, barY, blk.z + frontP.z, blk.width, 0.08, 0.10, railCol, rotYRad);
      solid.addBox(blk.x + backP.x, barY, blk.z + backP.z, blk.width, 0.08, 0.10, railCol, rotYRad);
    });
  }

  buildStandTiersMesh(solid, alpha) {
    const tiers = this.venue.standTiers || [];
    const showGuardrails = !(this.venue.gridSystem && this.venue.gridSystem.showGuardrails === false);
    const showVomitories = !(this.venue.gridSystem && this.venue.gridSystem.showVomitories === false);
    const cornerAngles = getInfieldCornerTransitionAngles(this.venue);

    const totalEstCap = (this.venue.engineeringSummary && this.venue.engineeringSummary.totalCapacity) || 50000;
    const globalSeatStride = totalEstCap <= 35000 ? 1 : (totalEstCap <= 95000 ? 3 : 4);

    const tierSeatColors = [
      { pan: [0.17, 0.37, 0.72, 1.0], back: [0.14, 0.31, 0.62, 1.0] }, // 1F Matte Navy-Blue
      { pan: [0.09, 0.50, 0.39, 1.0], back: [0.07, 0.42, 0.32, 1.0] }, // 2F Matte Emerald
      { pan: [0.68, 0.48, 0.16, 1.0], back: [0.56, 0.39, 0.12, 1.0] }, // 3F Matte Amber VIP
      { pan: [0.40, 0.27, 0.68, 1.0], back: [0.33, 0.22, 0.58, 1.0] }  // 4F Matte Violet
    ];
    const concreteStepCol = [0.15, 0.18, 0.24, 1.0];
    const concreteRiserCol = [0.13, 0.16, 0.21, 1.0];
    const vipFloorCol = [0.22, 0.19, 0.16, 1.0];
    const stairStepCol = [0.24, 0.28, 0.35, 1.0];
    const handrailCol = [0.68, 0.73, 0.80, 1.0];

    // Precompute front-connected vomitory angular windows per tier using strict vom.width solver
    const frontVomWindowsByTier = tiers.map((tier, tierIndex) => {
      const windows = [];
      if (!showVomitories) return windows;
      (tier.sectors || []).forEach((sec) => {
        if (sec.isDeleted || sec.fillType === 'empty-void' || sec.fillType === 'vip-box') return;
        const vom = sec.vomitory;
        if (!vom || vom.position === 'none' || vom.enabled === false) return;
        const rawStartRow = (vom.startRow !== undefined && vom.startRow !== null) ? Number(vom.startRow) : 5;
        if (rawStartRow > 1) return;
        const sDeg = sec.startAngleDeg;
        const eDeg = sec.endAngleDeg;
        if (eDeg - sDeg <= 0.5) return;
        const totalRows = sec.rows || tier.defaultRows || 22;
        const vomInfo = computeVomitoryAngularBounds(this.venue, tierIndex, sDeg, eDeg, vom, totalRows, sec.customRadialDepth);
        windows.push({ start: vomInfo.vomStartDeg, end: vomInfo.vomEndDeg });
      });
      return windows;
    });

    let prevTierMorphed = false;
    tiers.forEach((tier, tierIndex) => {
      const seatColPair = tierSeatColors[(tier.level - 1) % tierSeatColors.length];
      const sectors = tier.sectors || [];
      const activeSectors = sectors.filter(s => !s.isDeleted && s.fillType !== 'empty-void');
      const selectedIdxInTier = activeSectors.findIndex(s => s.id === this.selectedSectorId);
      const upperTierFrontVoms = frontVomWindowsByTier[tierIndex + 1] || [];
      const tierSelfMorphed = tier.morphMode === 'concentric-circle' && (tier.concentricMorph || 0) > 0.05;
      const tierHasMorph = tierSelfMorphed || prevTierMorphed;

      sectors.forEach((sec) => {
        if (sec.isDeleted || sec.fillType === 'empty-void') return;

        const activeIdx = activeSectors.indexOf(sec);
        const isSelected = sec.id === this.selectedSectorId;
        const isNearSelected = isSelected || (selectedIdxInTier !== -1 && Math.abs(activeIdx - selectedIdxInTier) <= 1);
        const isVip = sec.fillType === 'vip-box';

        // Keep 3D matte seat & concrete colors unchanged when selected
        const panCol = isVip ? [0.72, 0.52, 0.18, 1.0] : seatColPair.pan;
        const backCol = isVip ? [0.58, 0.41, 0.14, 1.0] : seatColPair.back;

        const sDeg = sec.startAngleDeg;
        const eDeg = sec.endAngleDeg;
        const angularSpan = eDeg - sDeg;
        if (angularSpan <= 0.5) return;

        const totalRows = sec.rows || tier.defaultRows || 22;
        const rowPitch = sec.rowPitch || tier.defaultRowPitch || 0.85;
        const slopeDeg = isVip ? 0 : (sec.slopeDeg || tier.defaultSlopeDeg || 20);
        const riserH = isVip ? 0 : (sec.riserHeight || (rowPitch * Math.tan(slopeDeg * DEG2RAD)));
        const seatSpacing = sec.seatSpacing || tier.defaultSeatSpacing || 0.5;
        const baseElev = tier.baseElevation || 1.0;
        const topElev = isVip ? baseElev : (baseElev + Math.max(0, totalRows - 1) * riserH);
        const radialAisleWidth = tier.radialAisleWidth || 1.6;

        // Parse Vomitory parameters with strict chord-width solver
        const vom = sec.vomitory;
        const hasVom = !isVip && showVomitories && vom && vom.position !== 'none' && vom.enabled !== false;
        let vomStartRow = -1, vomEndRow = -1, vomStartDeg = sDeg, vomEndDeg = sDeg;
        let isFrontConnected = false;

        if (hasVom) {
          const vomInfo = computeVomitoryAngularBounds(this.venue, tierIndex, sDeg, eDeg, vom, totalRows, sec.customRadialDepth);
          vomStartRow = vomInfo.vomStartRow;
          vomEndRow = vomInfo.vomEndRow;
          vomStartDeg = vomInfo.vomStartDeg;
          vomEndDeg = vomInfo.vomEndDeg;
          isFrontConnected = vomInfo.isFrontConnected;
        }

        // Extra angle splits for vomitories & upper-tier front bridges + infield corner transitions
        const extraStops = [];
        if (hasVom && vomStartDeg > sDeg + 0.1 && vomEndDeg < eDeg - 0.1) {
          extraStops.push(vomStartDeg, vomEndDeg);
        }
        upperTierFrontVoms.forEach((w) => {
          if (w.start > sDeg + 0.08 && w.start < eDeg - 0.08) extraStops.push(w.start);
          if (w.end > sDeg + 0.08 && w.end < eDeg - 0.08) extraStops.push(w.end);
        });
        const rawAngles = this.buildSectorAngleList(sDeg, eDeg, cornerAngles, extraStops, tierHasMorph, tierIndex);

        const guard = sec.guardrail || tier.defaultGuardrail || {};
        const secRailCol = isVip ? [0.92, 0.78, 0.44, 1.0] : handrailCol;

        // 1. Build Concrete Structure (Flat Platform for VIP Boxes; 90°-Perpendicular Stepped Bowl for Standard)
        for (let a = 0; a < rawAngles.length - 1; a++) {
          const deg1 = rawAngles[a];
          const deg2 = rawAngles[a + 1];
          if (deg2 - deg1 < 0.04) continue;

          const pt1 = evalTierPoint(this.venue, tierIndex, deg1, 0, sec.customRadialDepth);
          const pt2 = evalTierPoint(this.venue, tierIndex, deg2, 0, sec.customRadialDepth);
          const midStripDeg = (deg1 + deg2) / 2;
          const isVomStrip = hasVom && midStripDeg > vomStartDeg && midStripDeg < vomEndDeg;
          const isUpperBridgeStrip = upperTierFrontVoms.some(w => midStripDeg > w.start && midStripDeg < w.end);

          if (isVip) {
            // Flat VIP skybox platform deck at baseElev (NO stepped risers!)
            const deckBot = Math.max(0, baseElev - 0.55);
            solid.addQuad(
              { x: pt1.inX, y: baseElev, z: pt1.inZ },
              { x: pt1.outX, y: baseElev, z: pt1.outZ },
              { x: pt2.outX, y: baseElev, z: pt2.outZ },
              { x: pt2.inX, y: baseElev, z: pt2.inZ },
              vipFloorCol,
              { x: 0, y: 1, z: 0 }
            );
            // Underside soffit & front fascia lip
            solid.addQuad(
              { x: pt1.outX, y: deckBot, z: pt1.outZ },
              { x: pt1.inX, y: deckBot, z: pt1.inZ },
              { x: pt2.inX, y: deckBot, z: pt2.inZ },
              { x: pt2.outX, y: deckBot, z: pt2.outZ },
              concreteRiserCol,
              { x: 0, y: -1, z: 0 }
            );
            solid.addQuad(
              { x: pt1.inX, y: deckBot, z: pt1.inZ },
              { x: pt1.inX, y: baseElev, z: pt1.inZ },
              { x: pt2.inX, y: baseElev, z: pt2.inZ },
              { x: pt2.inX, y: deckBot, z: pt2.inZ },
              concreteStepCol
            );
          } else {
            // Exact row-by-row concrete treads & risers matching seat elevations 1:1
            for (let rb = 0; rb < totalRows; rb++) {
              const rowNum = rb + 1;
              if (isVomStrip && vomEndRow >= vomStartRow && rowNum >= vomStartRow && rowNum <= vomEndRow) {
                continue; // Leave recessed opening for Vomitory cutout!
              }
              const f0 = rb / totalRows;
              const f1 = (rb + 1) / totalRows;
              const x1_in = pt1.inX + (pt1.outX - pt1.inX) * f0;
              const z1_in = pt1.inZ + (pt1.outZ - pt1.inZ) * f0;
              const x1_out = pt1.inX + (pt1.outX - pt1.inX) * f1;
              const z1_out = pt1.inZ + (pt1.outZ - pt1.inZ) * f1;

              const x2_in = pt2.inX + (pt2.outX - pt2.inX) * f0;
              const z2_in = pt2.inZ + (pt2.outZ - pt2.inZ) * f0;
              const x2_out = pt2.inX + (pt2.outX - pt2.inX) * f1;
              const z2_out = pt2.inZ + (pt2.outZ - pt2.inZ) * f1;

              const treadY = baseElev + rb * riserH;
              const riserBot = rb === 0
                ? (tier.level === 1 ? 0 : Math.max(0, baseElev - 1.1))
                : (baseElev + (rb - 1) * riserH);

              if (!(rb === 0 && isVomStrip && isFrontConnected)) {
                solid.addQuad(
                  { x: x1_in, y: riserBot, z: z1_in },
                  { x: x1_in, y: treadY, z: z1_in },
                  { x: x2_in, y: treadY, z: z2_in },
                  { x: x2_in, y: riserBot, z: z2_in },
                  rb === 0 && tier.level === 1 ? [0.28, 0.33, 0.42, 1.0] : concreteRiserCol
                );
              }

              solid.addQuad(
                { x: x1_in, y: treadY, z: z1_in },
                { x: x1_out, y: treadY, z: z1_out },
                { x: x2_out, y: treadY, z: z2_out },
                { x: x2_in, y: treadY, z: z2_in },
                concreteStepCol,
                { x: 0, y: 1, z: 0 }
              );
            }
          }

          // Front Guardrail (OMITTED across front-connected Row-0/Row-1 vomitories!)
          if (showGuardrails && guard.frontRailEnabled !== false && !(isVomStrip && isFrontConnected)) {
            const frontH = guard.frontRailHeight || 1.1;
            const f1_bot = { x: pt1.inX, y: baseElev, z: pt1.inZ };
            const f2_bot = { x: pt2.inX, y: baseElev, z: pt2.inZ };
            const g1_top = { x: pt1.inX, y: baseElev + frontH, z: pt1.inZ };
            const g2_top = { x: pt2.inX, y: baseElev + frontH, z: pt2.inZ };

            // Volumetric 3D top handrail + vertical stanchion post
            solid.addBeam3D(g1_top, g2_top, 0.11, 0.11, secRailCol);
            if (a === 0 || a % 2 === 0) {
              solid.addBox(f1_bot.x, baseElev + frontH / 2, f1_bot.z, 0.09, frontH, 0.09, secRailCol, 0);
            }

            if (tier.level === 1) {
              // 1F between infield and stand: open metallic rails ONLY (zero dark glass/slab)
              solid.addBeam3D(
                { x: pt1.inX, y: baseElev + frontH * 0.56, z: pt1.inZ },
                { x: pt2.inX, y: baseElev + frontH * 0.56, z: pt2.inZ },
                0.08, 0.08, secRailCol
              );
              solid.addBeam3D(
                { x: pt1.inX, y: baseElev + frontH * 0.24, z: pt1.inZ },
                { x: pt2.inX, y: baseElev + frontH * 0.24, z: pt2.inZ },
                0.06, 0.06, secRailCol
              );
              const segLen = Math.hypot(f2_bot.x - f1_bot.x, f2_bot.z - f1_bot.z);
              const pickets = Math.max(1, Math.min(4, Math.floor(segLen / 1.1)));
              for (let p = 1; p <= pickets; p++) {
                const pt = p / (pickets + 1);
                solid.addBox(
                  f1_bot.x + (f2_bot.x - f1_bot.x) * pt,
                  baseElev + frontH / 2,
                  f1_bot.z + (f2_bot.z - f1_bot.z) * pt,
                  0.05, frontH, 0.05, secRailCol, 0
                );
              }
            } else if (guard.material === 'tempered-glass') {
              // Tempered glass panel with bright bottom clamp shoe + top rail
              alpha.addQuad(f1_bot, g1_top, g2_top, f2_bot, [0.50, 0.84, 1.0, 0.36]);
              solid.addBeam3D(
                { x: pt1.inX, y: baseElev + 0.07, z: pt1.inZ },
                { x: pt2.inX, y: baseElev + 0.07, z: pt2.inZ },
                0.09, 0.12, secRailCol
              );
            } else if (guard.material === 'concrete-parapet') {
              solid.addQuad(f1_bot, g1_top, g2_top, f2_bot, [0.42, 0.48, 0.58, 1.0]);
            } else {
              solid.addBeam3D(
                { x: pt1.inX, y: baseElev + frontH * 0.56, z: pt1.inZ },
                { x: pt2.inX, y: baseElev + frontH * 0.56, z: pt2.inZ },
                0.08, 0.08, secRailCol
              );
              const segLen = Math.hypot(f2_bot.x - f1_bot.x, f2_bot.z - f1_bot.z);
              const pickets = Math.max(1, Math.min(4, Math.floor(segLen / 1.1)));
              for (let p = 1; p <= pickets; p++) {
                const pt = p / (pickets + 1);
                solid.addBox(
                  f1_bot.x + (f2_bot.x - f1_bot.x) * pt,
                  baseElev + frontH / 2,
                  f1_bot.z + (f2_bot.z - f1_bot.z) * pt,
                  0.05, frontH, 0.05, secRailCol, 0
                );
              }
            }
          }

          // VIP Skybox back enclosure ONLY (ordinary stands have NO dark outer rear wall)
          const skipRearForPassThrough = (isVomStrip && vomEndRow >= totalRows) || isUpperBridgeStrip;
          if (isVip && guard.rearWallEnabled !== false && !skipRearForPassThrough) {
            const rearH = Math.max(2.6, guard.rearWallHeight || 2.8);
            const rw1_b = { x: pt1.outX, y: topElev, z: pt1.outZ };
            const rw2_b = { x: pt2.outX, y: topElev, z: pt2.outZ };
            const rw2_t = { x: pt2.outX, y: topElev + rearH, z: pt2.outZ };
            const rw1_t = { x: pt1.outX, y: topElev + rearH, z: pt1.outZ };
            solid.addQuad(rw1_b, rw1_t, rw2_t, rw2_b, [0.24, 0.21, 0.19, 1.0]);
          }
        }

        // 2. Radial Stair Aisle & Volumetric Inter-Stand Handrail strictly along 90° perpendicular cut
        if (!isVip && showGuardrails && guard.aisleHandrailEnabled !== false) {
          const ptEdge = evalTierPoint(this.venue, tierIndex, sDeg, 0, sec.customRadialDepth);
          const dxE = ptEdge.outX - ptEdge.inX;
          const dzE = ptEdge.outZ - ptEdge.inZ;
          const lenE = Math.hypot(dxE, dzE) || 1;
          const tanX = -dzE / lenE;
          const tanZ = dxE / lenE;

          const hwAisle = radialAisleWidth * 0.42;
          // Stepped stair treads per row (y = treadY + 0.025) so aisle NEVER Z-fights through step noses
          for (let rb = 0; rb < totalRows; rb++) {
            const f0 = rb / totalRows;
            const f1 = (rb + 1) / totalRows;
            const sY = isVip ? (baseElev + 0.025) : (baseElev + rb * riserH + 0.025);
            const sx0 = ptEdge.inX + dxE * f0;
            const sz0 = ptEdge.inZ + dzE * f0;
            const sx1 = ptEdge.inX + dxE * f1;
            const sz1 = ptEdge.inZ + dzE * f1;
            solid.addQuad(
              { x: sx0 - tanX * hwAisle, y: sY, z: sz0 - tanZ * hwAisle },
              { x: sx1 - tanX * hwAisle, y: sY, z: sz1 - tanZ * hwAisle },
              { x: sx1 + tanX * hwAisle, y: sY, z: sz1 + tanZ * hwAisle },
              { x: sx0 + tanX * hwAisle, y: sY, z: sz0 + tanZ * hwAisle },
              stairStepCol,
              { x: 0, y: 1, z: 0 }
            );
          }

          const postCount = Math.max(4, Math.ceil(lenE / 4.0));
          for (let p = 0; p < postCount; p++) {
            const pf = p / (postCount - 1);
            const px = ptEdge.inX + dxE * pf;
            const pz = ptEdge.inZ + dzE * pf;
            const py = baseElev + (topElev - baseElev) * pf;
            solid.addBox(px, py + 0.50, pz, 0.09, 1.0, 0.09, handrailCol, 0);
          }
          // Volumetric continuous sloped top & mid handrails along the inter-stand aisle
          solid.addBeam3D(
            { x: ptEdge.inX, y: baseElev + 1.00, z: ptEdge.inZ },
            { x: ptEdge.outX, y: topElev + 1.00, z: ptEdge.outZ },
            0.10, 0.10, handrailCol
          );
          solid.addBeam3D(
            { x: ptEdge.inX, y: baseElev + 0.52, z: ptEdge.inZ },
            { x: ptEdge.outX, y: topElev + 0.52, z: ptEdge.outZ },
            0.07, 0.07, handrailCol
          );
        }

        // 3. Recessed 3D Vomitory Tunnel Cutout (with complete 3D railings)
        if (hasVom && vomStartDeg > sDeg + 0.1 && vomEndDeg < eDeg - 0.1) {
          this.buildVomitoryRecess(
            solid,
            sec,
            tierIndex,
            vomStartDeg,
            vomEndDeg,
            vomStartRow,
            vomEndRow,
            totalRows,
            baseElev,
            riserH,
            handrailCol,
            isFrontConnected
          );
        }

        // 4. VIP Skybox Suites Partitions & Overhead Lounge Canopy
        if (isVip && sec.vipBoxRooms > 0) {
          const rooms = sec.vipBoxRooms;
          for (let rm = 0; rm <= rooms; rm++) {
            const rDeg = sDeg + (rm / rooms) * angularSpan;
            const ptR = evalTierPoint(this.venue, tierIndex, rDeg, 0, sec.customRadialDepth);
            const dxR = ptR.outX - ptR.inX;
            const dzR = ptR.outZ - ptR.inZ;
            const depthR = Math.hypot(dxR, dzR);
            const rotR = Math.atan2(dxR, dzR);
            solid.addBox(
              (ptR.inX + ptR.outX) / 2,
              baseElev + 1.4,
              (ptR.inZ + ptR.outZ) / 2,
              0.22,
              2.8,
              depthR,
              [0.34, 0.28, 0.20, 1.0],
              rotR
            );
          }
          const vipAngles = this.buildSectorAngleList(sDeg, eDeg, cornerAngles, null, tierHasMorph, tierIndex);
          const canopyY = baseElev + 2.8;
          for (let va = 0; va < vipAngles.length - 1; va++) {
            const pt1 = evalTierPoint(this.venue, tierIndex, vipAngles[va], 0, sec.customRadialDepth);
            const pt2 = evalTierPoint(this.venue, tierIndex, vipAngles[va + 1], 0, sec.customRadialDepth);
            const d1 = Math.hypot(pt1.outX - pt1.inX, pt1.outZ - pt1.inZ) || 1;
            const d2 = Math.hypot(pt2.outX - pt2.inX, pt2.outZ - pt2.inZ) || 1;
            const lip1 = Math.min(0.4, d1 * 0.15) / d1;
            const lip2 = Math.min(0.4, d2 * 0.15) / d2;
            solid.addQuad(
              { x: pt1.inX + (pt1.outX - pt1.inX) * lip1, y: canopyY, z: pt1.inZ + (pt1.outZ - pt1.inZ) * lip1 },
              { x: pt1.outX, y: canopyY, z: pt1.outZ },
              { x: pt2.outX, y: canopyY, z: pt2.outZ },
              { x: pt2.inX + (pt2.outX - pt2.inX) * lip2, y: canopyY, z: pt2.inZ + (pt2.outZ - pt2.inZ) * lip2 },
              [0.45, 0.34, 0.18, 1.0],
              { x: 0, y: -1, z: 0 }
            );
          }
        }

        // 5. Fill EVERY SINGLE ROW with smooth-arc 3D Seats directly on evalTierPoint!
        const stride = (isNearSelected || isVip) ? 1 : globalSeatStride;
        const rowAngles = this.buildSectorAngleList(sDeg, eDeg, cornerAngles, null, tierHasMorph, tierIndex);
        const margin = radialAisleWidth * 0.55;
        const stepUnitW = seatSpacing * stride;

        for (let r = 1; r <= totalRows; r++) {
          const rowFrac = totalRows > 1 ? (r - 0.5) / totalRows : 0.5;
          const rowElev = isVip ? baseElev : (baseElev + (r - 1) * riserH);

          const rowPts = rowAngles.map((deg) => {
            const p = evalTierPoint(this.venue, tierIndex, deg, rowFrac, sec.customRadialDepth);
            return { deg, x: p.x, z: p.z };
          });
          const cumLen = [0];
          for (let k = 1; k < rowPts.length; k++) {
            cumLen.push(cumLen[k - 1] + Math.hypot(rowPts[k].x - rowPts[k - 1].x, rowPts[k].z - rowPts[k - 1].z));
          }
          const totalArc = cumLen[cumLen.length - 1];
          if (totalArc <= margin * 2 + 0.3) continue;

          const usableArc = totalArc - margin * 2;
          const seatsInRow = Math.max(2, Math.floor(usableArc / stepUnitW));

          let segIdx = 0;
          for (let si = 0; si < seatsInRow; si++) {
            const targetS = margin + ((si + 0.5) / seatsInRow) * usableArc;
            while (segIdx < cumLen.length - 2 && cumLen[segIdx + 1] < targetS) {
              segIdx++;
            }
            const segLen = Math.max(1e-5, cumLen[segIdx + 1] - cumLen[segIdx]);
            const localT = Math.max(0, Math.min(1, (targetS - cumLen[segIdx]) / segLen));
            const pA = rowPts[segIdx];
            const pB = rowPts[segIdx + 1];
            const seatDeg = pA.deg + (pB.deg - pA.deg) * localT;

            // Skip seats inside carved Vomitory opening
            if (hasVom && vomEndRow >= vomStartRow && r >= vomStartRow && r <= vomEndRow && seatDeg >= vomStartDeg && seatDeg <= vomEndDeg) {
              continue;
            }

            // Evaluate exact position on true smooth curve + exact radial inward normal
            const exactPt = evalTierPoint(this.venue, tierIndex, seatDeg, rowFrac, sec.customRadialDepth);
            let fx, fz;
            if (!tierHasMorph && ((Math.abs(exactPt.nx) > 0.999 && Math.abs(exactPt.nz) < 1e-3) || (Math.abs(exactPt.nz) > 0.999 && Math.abs(exactPt.nx) < 1e-3))) {
              fx = -exactPt.nx;
              fz = -exactPt.nz;
            } else {
              const inward = getRowInwardNormal(this.venue, tierIndex, seatDeg, rowFrac, sec.customRadialDepth);
              fx = inward.x;
              fz = inward.z;
            }

            const seatWFactor = stride > 1 ? 0.985 : 0.92;
            const seatDepthM = stride > 1 ? Math.min(0.62, rowPitch * 0.74) : Math.min(0.50, rowPitch * 0.60);
            solid.addSeat3D(
              exactPt.x,
              rowElev,
              exactPt.z,
              stepUnitW * seatWFactor,
              seatDepthM,
              fx,
              fz,
              panCol,
              backCol
            );
          }
        }
      });
      prevTierMorphed = tierSelfMorphed;
    });
  }

  buildVomitoryRecess(solid, sec, tierIndex, vomStartDeg, vomEndDeg, vomStartRow, vomEndRow, totalRows, baseElev, riserH, handrailCol, isFrontConnected) {
    const pitFloorCol = [0.09, 0.11, 0.16, 1.0];
    const pitWallCol = [0.14, 0.17, 0.24, 1.0];
    const bridgeCol = [0.22, 0.27, 0.36, 1.0];
    const portalDarkCol = [0.02, 0.03, 0.05, 1.0];

    const ptL0 = evalTierPoint(this.venue, tierIndex, vomStartDeg, 0, sec.customRadialDepth);
    const ptR0 = evalTierPoint(this.venue, tierIndex, vomEndDeg, 0, sec.customRadialDepth);

    // Handle front-connected Row-0 / Row-1 vomitory: bridge across gap to previous tier / infield + NO front guardrail!
    if (isFrontConnected) {
      let prevL = { x: ptL0.inX, z: ptL0.inZ };
      let prevR = { x: ptR0.inX, z: ptR0.inZ };
      let prevTopY = 0.06;

      if (tierIndex > 0) {
        const prevTier = this.venue.standTiers[tierIndex - 1];
        const midVomDeg = (vomStartDeg + vomEndDeg) / 2;
        const prevSec = (prevTier.sectors || []).find(
          s => !s.isDeleted && s.fillType !== 'empty-void' && midVomDeg >= s.startAngleDeg && midVomDeg <= s.endAngleDeg
        );
        const prevVip = ((prevSec && prevSec.fillType) || prevTier.defaultFillType) === 'vip-box';
        const prevRows = (prevSec && prevSec.rows) || prevTier.defaultRows || 20;
        const prevPitch = (prevSec && prevSec.rowPitch) || prevTier.defaultRowPitch || 0.85;
        const prevSlope = prevVip ? 0 : ((prevSec && prevSec.slopeDeg) || prevTier.defaultSlopeDeg || 20);
        const prevRiser = prevVip ? 0 : ((prevSec && prevSec.riserHeight) || (prevPitch * Math.tan(prevSlope * DEG2RAD)));
        prevTopY = prevVip ? (prevTier.baseElevation || 1.0) : ((prevTier.baseElevation || 1.0) + Math.max(0, prevRows - 1) * prevRiser);

        const pPrevL = evalTierPoint(this.venue, tierIndex - 1, vomStartDeg, 1, prevSec && prevSec.customRadialDepth);
        const pPrevR = evalTierPoint(this.venue, tierIndex - 1, vomEndDeg, 1, prevSec && prevSec.customRadialDepth);
        prevL = { x: pPrevL.outX, z: pPrevL.outZ };
        prevR = { x: pPrevR.outX, z: pPrevR.outZ };

        // Connecting walkway bridge spanning innerOffset gap between previous tier outer rim and this tier front edge
        solid.addQuad(
          { x: prevL.x, y: prevTopY + 0.04, z: prevL.z },
          { x: ptL0.inX, y: baseElev + 0.02, z: ptL0.inZ },
          { x: ptR0.inX, y: baseElev + 0.02, z: ptR0.inZ },
          { x: prevR.x, y: prevTopY + 0.04, z: prevR.z },
          bridgeCol,
          { x: 0, y: 1, z: 0 }
        );
        // Bridge soffit thickness
        solid.addQuad(
          { x: ptL0.inX, y: baseElev - 0.35, z: ptL0.inZ },
          { x: prevL.x, y: prevTopY - 0.35, z: prevL.z },
          { x: prevR.x, y: prevTopY - 0.35, z: prevR.z },
          { x: ptR0.inX, y: baseElev - 0.35, z: ptR0.inZ },
          pitWallCol,
          { x: 0, y: -1, z: 0 }
        );
        // Side safety rails on bridge (continuous 3D sloped top + mid rail + posts; front & back open)
        const addRailRun = (pA, yA, pB, yB) => {
          const span = Math.hypot(pB.x - pA.x, pB.z - pA.z);
          const posts = Math.max(2, Math.ceil(span / 2.8) + 1);
          for (let i = 0; i < posts; i++) {
            const f = i / (posts - 1);
            solid.addBox(
              pA.x + (pB.x - pA.x) * f,
              yA + (yB - yA) * f + 0.50,
              pA.z + (pB.z - pA.z) * f,
              0.09, 1.0, 0.09, handrailCol, 0
            );
          }
          solid.addBeam3D({ x: pA.x, y: yA + 1.00, z: pA.z }, { x: pB.x, y: yB + 1.00, z: pB.z }, 0.10, 0.10, handrailCol);
          solid.addBeam3D({ x: pA.x, y: yA + 0.52, z: pA.z }, { x: pB.x, y: yB + 0.52, z: pB.z }, 0.07, 0.07, handrailCol);
        };
        addRailRun(prevL, prevTopY, { x: ptL0.inX, z: ptL0.inZ }, baseElev);
        addRailRun(prevR, prevTopY, { x: ptR0.inX, z: ptR0.inZ }, baseElev);
      }

      // If rowSpan === 0 (pure row-0 front connector), all rows remain intact and bridge connects directly to Row 1
      if (vomEndRow < 1) {
        return;
      }

      // Rows 1..vomEndRow carved as an unobstructed passage leading straight from infield/previous tier
      const f1 = vomEndRow / totalRows;
      const ptL1 = evalTierPoint(this.venue, tierIndex, vomStartDeg, f1, sec.customRadialDepth);
      const ptR1 = evalTierPoint(this.venue, tierIndex, vomEndDeg, f1, sec.customRadialDepth);
      const yBack = baseElev + (vomEndRow - 1) * riserH;
      const floorFrontY = tierIndex === 0 ? 0.06 : baseElev;
      const floorBackY = tierIndex === 0
        ? 0.06
        : (vomEndRow >= totalRows ? yBack : Math.max(baseElev - 0.4, yBack - 1.5));

      // Open passage floor (zero front curb!)
      solid.addQuad(
        { x: ptL0.inX, y: floorFrontY, z: ptL0.inZ },
        { x: ptL1.x, y: floorBackY, z: ptL1.z },
        { x: ptR1.x, y: floorBackY, z: ptR1.z },
        { x: ptR0.inX, y: floorFrontY, z: ptR0.inZ },
        pitFloorCol,
        { x: 0, y: 1, z: 0 }
      );

      // Left & Right side retaining walls closing the recessed corridor
      solid.addQuad(
        { x: ptL0.inX, y: floorFrontY, z: ptL0.inZ },
        { x: ptL1.x, y: floorBackY, z: ptL1.z },
        { x: ptL1.x, y: yBack, z: ptL1.z },
        { x: ptL0.inX, y: baseElev, z: ptL0.inZ },
        pitWallCol
      );
      solid.addQuad(
        { x: ptR0.inX, y: floorFrontY, z: ptR0.inZ },
        { x: ptR0.inX, y: baseElev, z: ptR0.inZ },
        { x: ptR1.x, y: yBack, z: ptR1.z },
        { x: ptR1.x, y: floorBackY, z: ptR1.z },
        pitWallCol
      );

      // Back tunnel portal (omitted if full-depth corridor vomEndRow >= totalRows)
      if (vomEndRow < totalRows) {
        const portalTopY = Math.min(yBack, floorBackY + 2.2);
        solid.addQuad(
          { x: ptL1.x, y: floorBackY, z: ptL1.z },
          { x: ptL1.x, y: portalTopY, z: ptL1.z },
          { x: ptR1.x, y: portalTopY, z: ptR1.z },
          { x: ptR1.x, y: floorBackY, z: ptR1.z },
          portalDarkCol
        );
        if (yBack > portalTopY + 0.05) {
          solid.addQuad(
            { x: ptL1.x, y: portalTopY, z: ptL1.z },
            { x: ptL1.x, y: yBack, z: ptL1.z },
            { x: ptR1.x, y: yBack, z: ptR1.z },
            { x: ptR1.x, y: portalTopY, z: ptR1.z },
            pitWallCol
          );
        }
        const widthM = Math.hypot(ptR1.x - ptL1.x, ptR1.z - ptL1.z);
        const exitRot = Math.atan2(-(ptR1.z - ptL1.z), ptR1.x - ptL1.x);
        solid.addBox((ptL1.x + ptR1.x) / 2, portalTopY + 0.14, (ptL1.z + ptR1.z) / 2, widthM * 0.65, 0.22, 0.24, [0.10, 0.88, 0.48, 1.0], exitRot);
      }

      // Full continuous left & right corridor rim railings (front remains 100% open!)
      const addCorridorSideRail = (pA, yA, pB, yB) => {
        const span = Math.hypot(pB.x - pA.x, pB.z - pA.z);
        const posts = Math.max(2, Math.ceil(span / 2.5) + 1);
        for (let i = 0; i < posts; i++) {
          const f = i / (posts - 1);
          solid.addBox(
            pA.x + (pB.x - pA.x) * f,
            yA + (yB - yA) * f + 0.50,
            pA.z + (pB.z - pA.z) * f,
            0.09, 1.0, 0.09, handrailCol, 0
          );
        }
        solid.addBeam3D({ x: pA.x, y: yA + 1.00, z: pA.z }, { x: pB.x, y: yB + 1.00, z: pB.z }, 0.10, 0.10, handrailCol);
        solid.addBeam3D({ x: pA.x, y: yA + 0.52, z: pA.z }, { x: pB.x, y: yB + 0.52, z: pB.z }, 0.07, 0.07, handrailCol);
      };
      addCorridorSideRail({ x: ptL0.inX, z: ptL0.inZ }, baseElev, ptL1, yBack);
      addCorridorSideRail({ x: ptR0.inX, z: ptR0.inZ }, baseElev, ptR1, yBack);
      return;
    }

    // Standard mid-stand recessed vomitory cutout (vomStartRow >= 2)
    const f0 = (vomStartRow - 1) / totalRows;
    const f1 = vomEndRow / totalRows;

    const ptL_in = evalTierPoint(this.venue, tierIndex, vomStartDeg, f0, sec.customRadialDepth);
    const ptL_out = evalTierPoint(this.venue, tierIndex, vomStartDeg, f1, sec.customRadialDepth);
    const ptR_in = evalTierPoint(this.venue, tierIndex, vomEndDeg, f0, sec.customRadialDepth);
    const ptR_out = evalTierPoint(this.venue, tierIndex, vomEndDeg, f1, sec.customRadialDepth);

    const yFront = baseElev + (vomStartRow - 1) * riserH;
    const yBack = baseElev + (vomEndRow - 1) * riserH;
    const floorFrontY = Math.max(0.15, yFront - 0.65);
    const floorBackY = Math.max(0.15, yFront - 1.35);

    // Sunken floor quad sloping down into the rear tunnel doorway
    solid.addQuad(
      { x: ptL_in.x, y: floorFrontY, z: ptL_in.z },
      { x: ptL_out.x, y: floorBackY, z: ptL_out.z },
      { x: ptR_out.x, y: floorBackY, z: ptR_out.z },
      { x: ptR_in.x, y: floorFrontY, z: ptR_in.z },
      pitFloorCol,
      { x: 0, y: 1, z: 0 }
    );

    // Front step-down threshold riser connecting step (vomStartRow-1) down to sunken floor
    solid.addQuad(
      { x: ptL_in.x, y: floorFrontY, z: ptL_in.z },
      { x: ptL_in.x, y: yFront, z: ptL_in.z },
      { x: ptR_in.x, y: yFront, z: ptR_in.z },
      { x: ptR_in.x, y: floorFrontY, z: ptR_in.z },
      pitWallCol
    );

    // Left & Right side retaining walls closing the recessed cutout cleanly
    solid.addQuad(
      { x: ptL_in.x, y: floorFrontY, z: ptL_in.z },
      { x: ptL_out.x, y: floorBackY, z: ptL_out.z },
      { x: ptL_out.x, y: yBack, z: ptL_out.z },
      { x: ptL_in.x, y: yFront, z: ptL_in.z },
      pitWallCol
    );
    solid.addQuad(
      { x: ptR_in.x, y: floorFrontY, z: ptR_in.z },
      { x: ptR_in.x, y: yFront, z: ptR_in.z },
      { x: ptR_out.x, y: yBack, z: ptR_out.z },
      { x: ptR_out.x, y: floorBackY, z: ptR_out.z },
      pitWallCol
    );

    // Back dark tunnel entrance recess + concrete portal wall above + green EXIT strip
    const portalTopY = Math.min(yBack, floorBackY + 2.2);
    solid.addQuad(
      { x: ptL_out.x, y: floorBackY, z: ptL_out.z },
      { x: ptL_out.x, y: portalTopY, z: ptL_out.z },
      { x: ptR_out.x, y: portalTopY, z: ptR_out.z },
      { x: ptR_out.x, y: floorBackY, z: ptR_out.z },
      portalDarkCol
    );
    if (yBack > portalTopY + 0.05) {
      solid.addQuad(
        { x: ptL_out.x, y: portalTopY, z: ptL_out.z },
        { x: ptL_out.x, y: yBack, z: ptL_out.z },
        { x: ptR_out.x, y: yBack, z: ptR_out.z },
        { x: ptR_out.x, y: portalTopY, z: ptR_out.z },
        pitWallCol
      );
    }
    const widthM = Math.hypot(ptR_out.x - ptL_out.x, ptR_out.z - ptL_out.z);
    const exitRot = Math.atan2(-(ptR_out.z - ptL_out.z), ptR_out.x - ptL_out.x);
    solid.addBox((ptL_out.x + ptR_out.x) / 2, portalTopY + 0.14, (ptL_out.z + ptR_out.z) / 2, widthM * 0.65, 0.22, 0.24, [0.10, 0.88, 0.48, 1.0], exitRot);

    // Complete 3-sided safety guardrail around recessed mid-stand vomitory pit (Left, Right, and Front rim)
    const addPitRail = (pA, yA, pB, yB) => {
      const span = Math.hypot(pB.x - pA.x, pB.z - pA.z);
      const posts = Math.max(2, Math.ceil(span / 2.2) + 1);
      for (let i = 0; i < posts; i++) {
        const f = i / (posts - 1);
        solid.addBox(
          pA.x + (pB.x - pA.x) * f,
          yA + (yB - yA) * f + 0.50,
          pA.z + (pB.z - pA.z) * f,
          0.09, 1.0, 0.09, handrailCol, 0
        );
      }
      solid.addBeam3D({ x: pA.x, y: yA + 1.00, z: pA.z }, { x: pB.x, y: yB + 1.00, z: pB.z }, 0.10, 0.10, handrailCol);
      solid.addBeam3D({ x: pA.x, y: yA + 0.52, z: pA.z }, { x: pB.x, y: yB + 0.52, z: pB.z }, 0.07, 0.07, handrailCol);
    };
    addPitRail(ptL_in, yFront, ptL_out, yBack);
    addPitRail(ptR_in, yFront, ptR_out, yBack);
    addPitRail(ptL_in, yFront, ptR_in, yFront);
  }

  buildStadiumCanopyRim(solid) {
    const summary = this.venue.engineeringSummary || {};
    const maxElev = (summary.maxBowlElevationM || 30) + 3.5;
    const tiers = this.venue.standTiers || [];
    const lastTierIdx = tiers.length - 1;
    if (lastTierIdx < 0) return;

    const lastTier = tiers[lastTierIdx];
    const isMorphedLast = lastTier.morphMode === 'concentric-circle' && (lastTier.concentricMorph || 0) > 0.1;
    const ringAngles = this.buildFullRingAngles(180);
    const topCol = [0.24, 0.29, 0.38, 1.0];
    const soffitCol = [0.13, 0.17, 0.25, 1.0];
    const fasciaCol = [0.32, 0.38, 0.48, 1.0];
    const lightStripCol = [0.85, 0.92, 1.0, 1.0];
    const thickness = 1.6; // Real 3D thickness prevents ANY Z-fighting!

    for (let i = 0; i < ringAngles.length - 1; i++) {
      const deg1 = ringAngles[i];
      const deg2 = ringAngles[i + 1];
      if (this.venue.id === 'std-beijing-bird-nest' && (deg1 < 12 || deg1 > 348)) {
        continue;
      }

      const pt1 = evalTierPoint(this.venue, lastTierIdx, deg1, 1);
      const pt2 = evalTierPoint(this.venue, lastTierIdx, deg2, 1);

      const rLen1 = Math.hypot(pt1.outX, pt1.outZ) || 1;
      const rLen2 = Math.hypot(pt2.outX, pt2.outZ) || 1;
      const nx1 = isMorphedLast ? (pt1.outX / rLen1) : pt1.nx;
      const nz1 = isMorphedLast ? (pt1.outZ / rLen1) : pt1.nz;
      const nx2 = isMorphedLast ? (pt2.outX / rLen2) : pt2.nx;
      const nz2 = isMorphedLast ? (pt2.outZ / rLen2) : pt2.nz;

      const xIn1 = pt1.outX - nx1 * 14, zIn1 = pt1.outZ - nz1 * 14;
      const xOut1 = pt1.outX + nx1 * 5, zOut1 = pt1.outZ + nz1 * 5;
      const xIn2 = pt2.outX - nx2 * 14, zIn2 = pt2.outZ - nz2 * 14;
      const xOut2 = pt2.outX + nx2 * 5, zOut2 = pt2.outZ + nz2 * 5;

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
        { x: xIn1, y: yTop1 + 0.8, z: zIn1 },
        { x: xOut1, y: yTop1, z: zOut1 },
        { x: xOut2, y: yTop2, z: zOut2 },
        { x: xIn2, y: yTop2 + 0.8, z: zIn2 },
        topCol,
        { x: 0, y: 1, z: 0 }
      );

      // Bottom soffit surface (separated by 1.6m!)
      solid.addQuad(
        { x: xOut1, y: yBot1, z: zOut1 },
        { x: xIn1, y: yBot1 + 0.8, z: zIn1 },
        { x: xIn2, y: yBot2 + 0.8, z: zIn2 },
        { x: xOut2, y: yBot2, z: zOut2 },
        soffitCol,
        { x: 0, y: -1, z: 0 }
      );

      // Inner tension-ring fascia + steady stadium floodlight blocks (every 4th segment)
      solid.addQuad(
        { x: xIn1, y: yBot1 + 0.8, z: zIn1 },
        { x: xIn1, y: yTop1 + 0.8, z: zIn1 },
        { x: xIn2, y: yTop2 + 0.8, z: zIn2 },
        { x: xIn2, y: yBot2 + 0.8, z: zIn2 },
        fasciaCol
      );

      if (i % 4 === 0) {
        const mx = (xIn1 + xIn2) / 2;
        const mz = (zIn1 + zIn2) / 2;
        const rotL = Math.atan2(-(zIn2 - zIn1), xIn2 - xIn1);
        solid.addBox(mx, (yBot1 + yBot2) / 2 + 0.5, mz, 2.4, 0.7, 0.8, lightStripCol, rotL);
      }
    }
  }

  buildConcertStageMesh(solid, beams) {
    const infield = this.venue.infield;
    const stage = infield && infield.stageConfig;
    if (!stage) return;

    const st = getStageTransform(this.venue);
    const rotDeg = st.rotFromSouthDeg || 0;
    const rotRad = -rotDeg * DEG2RAD;

    const addStageBox = (lx, cy, lz, w, h, d, color, localRotYRad) => {
      const wp = rotateXZ(lx, lz, rotDeg);
      solid.addBox(wp.x, cy, wp.z, w, h, d, color, (localRotYRad || 0) + rotRad);
    };
    const rotPt = (lx, y, lz) => {
      const wp = rotateXZ(lx, lz, rotDeg);
      return { x: wp.x, y, z: wp.z };
    };
    const addStageBeam = (lx1, y1, lz1, lx2, y2, lz2, thick, h, col) => {
      solid.addBeam3D(rotPt(lx1, y1, lz1), rotPt(lx2, y2, lz2), thick, h, col);
    };

    // Volumetric dual-crossed spotlight beam cone with soft emitter-to-floor taper
    const addRefinedBeam = (ox, oy, oz, tx, ty, tz, spreadW, col) => {
      const pO = rotPt(ox, oy, oz);
      const pL = rotPt(tx - spreadW, ty, tz);
      const pR = rotPt(tx + spreadW, ty, tz);
      const pF = rotPt(tx, ty, tz + spreadW * 0.85);
      const pB = rotPt(tx, ty, tz - spreadW * 0.85);
      beams.addTriangle(pO, pL, pR, col);
      beams.addTriangle(pO, pB, pF, col);
    };

    // Refined multi-panel LED wall helper with black bezel mullions & glowing visual artwork
    const addDetailedLEDWall = (cx, baseY, cz, totalW, totalH, cols, rows, localRotYRad, accentCol) => {
      const cosR = Math.cos(localRotYRad || 0);
      const sinR = Math.sin(localRotYRad || 0);
      const toLocal = (px, py, pz) => ({
        lx: cx + px * cosR + pz * sinR,
        y: baseY + totalH / 2 + py,
        lz: cz - px * sinR + pz * cosR
      });

      const blackFrame = [0.035, 0.04, 0.052, 1.0];
      const bezelCol = [0.10, 0.11, 0.14, 1.0];
      const oledBase = [0.04, 0.07, 0.15, 1.0];
      const horizonCol = [0.10, 0.48, 0.86, 1.0];
      const glowGold = [0.92, 0.66, 0.24, 1.0];
      const glowAccent = accentCol || [0.42, 0.28, 0.90, 1.0];

      // Black structural LED cabinet housing + top/bottom/side frame trim
      addStageBox(cx, baseY + totalH / 2, cz, totalW + 0.9, totalH + 0.8, 1.15, blackFrame, localRotYRad);
      addStageBox(cx, baseY + totalH + 0.25, cz, totalW + 1.1, 0.35, 1.35, bezelCol, localRotYRad);
      addStageBox(cx, baseY + 0.15, cz, totalW + 1.1, 0.30, 1.35, bezelCol, localRotYRad);

      // Modular LED tiles grid with dark seams
      const padX = 0.24;
      const padY = 0.22;
      const tileW = (totalW - padX * (cols + 1)) / cols;
      const tileH = (totalH - padY * (rows + 1)) / rows;
      const faceZ = 0.62;

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const px = -totalW / 2 + padX + tileW / 2 + c * (tileW + padX);
          const py = -totalH / 2 + padY + tileH / 2 + r * (tileH + padY);
          const distCenter = Math.abs(c - (cols - 1) / 2) / Math.max(1, (cols - 1) / 2);
          let panelCol = oledBase;
          if (r === 1 && distCenter < 0.55) {
            panelCol = glowAccent;
          } else if (r === 0 && distCenter < 0.72) {
            panelCol = horizonCol;
          } else if (r === rows - 1 && distCenter < 0.4) {
            panelCol = glowGold;
          }
          const tp = toLocal(px, py, faceZ);
          addStageBox(tp.lx, tp.y, tp.lz, tileW, tileH, 0.08, panelCol, localRotYRad);
        }
      }

      // Crisp luminous horizontal audio-horizon ribbon & central portal arch highlight
      const rib = toLocal(0, -totalH * 0.08, faceZ + 0.06);
      addStageBox(rib.lx, rib.y, rib.lz, totalW * 0.86, Math.max(0.28, totalH * 0.06), 0.06, [0.28, 0.82, 0.98, 1.0], localRotYRad);
      const coreArch = toLocal(0, totalH * 0.05, faceZ + 0.08);
      addStageBox(coreArch.lx, coreArch.y, coreArch.lz, totalW * 0.28, totalH * 0.44, 0.06, [0.96, 0.76, 0.34, 1.0], localRotYRad);
    };

    const sw = stage.width || 36;
    const sd = stage.depth || 22;
    const sh = stage.height || 2.0;
    const backH = stage.backdropHeight || 14;
    const cw = stage.catwalkWidth || 3.5;

    const stageBlack = [0.045, 0.050, 0.062, 1.0];
    const stageDeckTop = [0.065, 0.072, 0.088, 1.0];
    const stageTrim = [0.15, 0.17, 0.21, 1.0];
    const trussBlack = [0.06, 0.068, 0.082, 1.0];
    const trussBrace = [0.12, 0.135, 0.165, 1.0];
    const speakerCol = [0.035, 0.040, 0.050, 1.0];
    const edgeStripBlue = [0.32, 0.74, 0.98, 1.0];
    const edgeStripAmber = [0.96, 0.72, 0.30, 1.0];

    if (stage.type === 'center-stage') {
      // Matte-black central stage + recessed edge trim
      addStageBox(0, sh / 2, 0, sw, sh, sd, stageBlack, 0);
      addStageBox(0, sh + 0.04, 0, sw - 0.8, 0.08, sd - 0.8, stageDeckTop, 0);
      addStageBox(0, sh + 0.09, -sd / 2 + 0.22, sw, 0.08, 0.18, edgeStripBlue, 0);
      addStageBox(0, sh + 0.09, sd / 2 - 0.22, sw, 0.08, 0.18, edgeStripBlue, 0);

      const clZ = Math.min(stage.catwalkLength || 10, Math.max(3, st.alongHalf - sd / 2 + 1));
      const clX = Math.min(stage.catwalkLength || 10, Math.max(2, st.crossHalf - sw / 2 + 1));
      addStageBox(0, sh / 2, -sd / 2 - clZ / 2, cw, sh, clZ, stageBlack, 0);
      addStageBox(0, sh / 2, sd / 2 + clZ / 2, cw, sh, clZ, stageBlack, 0);
      addStageBox(-cw / 2 + 0.1, sh + 0.05, -sd / 2 - clZ / 2, 0.12, 0.08, clZ, edgeStripAmber, 0);
      addStageBox(cw / 2 - 0.1, sh + 0.05, -sd / 2 - clZ / 2, 0.12, 0.08, clZ, edgeStripAmber, 0);
      addStageBox(-cw / 2 + 0.1, sh + 0.05, sd / 2 + clZ / 2, 0.12, 0.08, clZ, edgeStripAmber, 0);
      addStageBox(cw / 2 - 0.1, sh + 0.05, sd / 2 + clZ / 2, 0.12, 0.08, clZ, edgeStripAmber, 0);
      if (clX > 1.5) {
        addStageBox(-sw / 2 - clX / 2, sh / 2, 0, clX, sh, cw, stageBlack, 0);
        addStageBox(sw / 2 + clX / 2, sh / 2, 0, clX, sh, cw, stageBlack, 0);
      }

      // Overhead matte-black truss rig & 4-sided hanging LED cube
      const rigY = sh + backH * 0.78;
      const cubeW = sw * 0.56;
      const cubeH = backH * 0.52;
      const cubeD = sd * 0.56;
      addStageBox(0, rigY + cubeH + 0.6, 0, sw * 0.84, 0.9, sd * 0.84, trussBlack, 0);
      addStageBox(0, rigY + cubeH / 2, 0, cubeW, cubeH, cubeD, stageBlack, 0);
      addDetailedLEDWall(0, rigY, cubeD / 2, cubeW * 0.92, cubeH * 0.9, 4, 2, 0, [0.36, 0.58, 0.98, 1.0]);
      addDetailedLEDWall(0, rigY, -cubeD / 2, cubeW * 0.92, cubeH * 0.9, 4, 2, Math.PI, [0.36, 0.58, 0.98, 1.0]);

      const beamColors = [
        [0.35, 0.78, 1.0, 0.12],
        [1.0, 0.76, 0.36, 0.12],
        [0.62, 0.42, 0.98, 0.12]
      ];
      for (let i = 0; i < 12; i++) {
        const ang = (i / 12) * Math.PI * 2;
        const bx = Math.cos(ang) * (sw * 0.36);
        const bz = Math.sin(ang) * (sd * 0.36);
        const tx = Math.cos(ang) * (sw * 0.95);
        const tz = Math.sin(ang) * (sd * 0.95);
        addStageBox(
          rotPt(bx, 0, bz).x ? bx : bx,
          rigY + cubeH + 0.1,
          bz,
          0.55, 0.55, 0.55, trussBrace, 0
        );
        addRefinedBeam(bx, rigY + cubeH, bz, tx, sh + 0.15, tz, 2.2, beamColors[i % beamColors.length]);
      }
      return;
    }

    // End-Stage or Festival-Stage: All-Black Touring Production Architecture
    const stageZ = st.stageLocalZ;
    const cl = st.catwalkLength;

    // 1. Matte-black stage deck, recessed apron skirt & subtle dark trim
    addStageBox(0, sh / 2, stageZ, sw, sh, sd, stageBlack, 0);
    addStageBox(0, sh + 0.04, stageZ, sw - 0.8, 0.08, sd - 0.8, stageDeckTop, 0);
    addStageBox(0, sh + 0.06, stageZ + sd / 2 - 0.18, sw, 0.10, 0.24, stageTrim, 0);

    // Subtle front stage footlight strip & stage access stairs on left/right wings
    addStageBox(0, sh + 0.11, stageZ + sd / 2 - 0.16, sw * 0.88, 0.06, 0.10, edgeStripBlue, 0);
    addStageBox(-sw / 2 - 1.2, sh * 0.38, stageZ + sd * 0.2, 2.4, sh * 0.76, 3.6, stageBlack, 0);
    addStageBox(sw / 2 + 1.2, sh * 0.38, stageZ + sd * 0.2, 2.4, sh * 0.76, 3.6, stageBlack, 0);

    // 2. Matte-black Catwalk & B-Stage thrust with slim edge accent strips
    const catZ = stageZ + sd / 2 + cl / 2;
    const bStageZ = stageZ + sd / 2 + cl + 2.5;
    addStageBox(0, sh / 2, catZ, cw, sh, cl, stageBlack, 0);
    addStageBox(0, sh + 0.04, catZ, cw - 0.4, 0.08, cl, stageDeckTop, 0);
    addStageBox(-cw / 2 + 0.10, sh + 0.09, catZ, 0.12, 0.06, cl, edgeStripAmber, 0);
    addStageBox(cw / 2 - 0.10, sh + 0.09, catZ, 0.12, 0.06, cl, edgeStripAmber, 0);

    addStageBox(0, sh / 2, bStageZ, cw * 2.2, sh, 5.2, stageBlack, 0);
    addStageBox(0, sh + 0.04, bStageZ, cw * 2.0, 0.08, 4.8, stageDeckTop, 0);
    addStageBox(0, sh + 0.09, bStageZ + 2.48, cw * 2.1, 0.06, 0.12, edgeStripBlue, 0);

    // 3. Refined Multi-Panel Main LED Backdrop & Angled Side IMAG Wing Screens
    const screenZ = stageZ - sd / 2 + 2.0;
    addDetailedLEDWall(0, sh + 0.4, screenZ, sw * 0.88, backH * 0.92, 7, 3, 0, [0.46, 0.32, 0.96, 1.0]);

    const wingW = sw * 0.34;
    const wingH = backH * 0.82;
    addDetailedLEDWall(-sw * 0.66, sh + 0.8, screenZ + 4.2, wingW, wingH, 3, 2, 0.38, [0.14, 0.68, 0.96, 1.0]);
    addDetailedLEDWall(sw * 0.66, sh + 0.8, screenZ + 4.2, wingW, wingH, 3, 2, -0.38, [0.14, 0.68, 0.96, 1.0]);

    // 4. Matte-Black Overhead Box Truss Rig, Vertical Towers & Hanging PA Line-Array Speakers
    const trussH = sh + backH + 1.4;
    const frontTrussZ = stageZ + sd * 0.42;
    const midTrussZ = stageZ;
    const backTrussZ = stageZ - sd * 0.42;

    // 4 main black vertical truss towers + cantilever arms for IMAG screens
    addStageBox(-sw * 0.48, trussH / 2, backTrussZ, 1.0, trussH, 1.0, trussBlack, 0);
    addStageBox(sw * 0.48, trussH / 2, backTrussZ, 1.0, trussH, 1.0, trussBlack, 0);
    addStageBox(-sw * 0.48, trussH / 2, frontTrussZ, 1.0, trussH, 1.0, trussBlack, 0);
    addStageBox(sw * 0.48, trussH / 2, frontTrussZ, 1.0, trussH, 1.0, trussBlack, 0);

    // Open-frame black overhead truss grid (chords + cross-beams + wing arms)
    addStageBeam(-sw * 0.50, trussH, frontTrussZ, sw * 0.50, trussH, frontTrussZ, 0.75, 0.95, trussBlack);
    addStageBeam(-sw * 0.50, trussH, midTrussZ, sw * 0.50, trussH, midTrussZ, 0.65, 0.85, trussBlack);
    addStageBeam(-sw * 0.50, trussH, backTrussZ, sw * 0.50, trussH, backTrussZ, 0.75, 0.95, trussBlack);
    addStageBeam(-sw * 0.48, trussH, backTrussZ, -sw * 0.48, trussH, frontTrussZ, 0.75, 0.95, trussBlack);
    addStageBeam(sw * 0.48, trussH, backTrussZ, sw * 0.48, trussH, frontTrussZ, 0.75, 0.95, trussBlack);
    addStageBeam(0, trussH, backTrussZ, 0, trussH, frontTrussZ, 0.55, 0.75, trussBrace);
    addStageBeam(-sw * 0.48, trussH - 0.5, backTrussZ + 1.5, -sw * 0.66, sh + wingH + 1.0, screenZ + 4.2, 0.55, 0.65, trussBlack);
    addStageBeam(sw * 0.48, trussH - 0.5, backTrussZ + 1.5, sw * 0.66, sh + wingH + 1.0, screenZ + 4.2, 0.55, 0.65, trussBlack);

    // Curved matte-black PA Line-Array Speaker Hangs flanking main stage front
    [-sw * 0.44, sw * 0.44].forEach((sx) => {
      for (let k = 0; k < 5; k++) {
        addStageBox(sx, trussH - 1.4 - k * 0.72, frontTrussZ + 0.6 + k * 0.14, 1.8, 0.58, 1.1, speakerCol, k * 0.04);
      }
    });

    // 5. Matte-Black FOH Sound & Lighting Control Tower
    if (stage.fohEnabled) {
      const fohZ = st.fohLocalZ;
      const fw = stage.fohWidth || 8;
      const fd = stage.fohDepth || 5;
      addStageBox(0, 1.3, fohZ, fw, 2.6, fd, stageBlack, 0);
      addStageBox(0, 2.75, fohZ, fw * 0.85, 0.35, fd * 0.45, trussBrace, 0);
      addStageBox(0, 3.05, fohZ - fd * 0.15, fw * 0.55, 0.28, 0.45, [0.16, 0.62, 0.92, 1.0], 0);
    }

    // 6. Refined Lighting Fixtures (moving-head pods + emitter lenses) & Soft Volumetric Cones
    const beamPalette = [
      [0.34, 0.80, 1.0, 0.11],  // Ice Cyan
      [1.0, 0.76, 0.36, 0.10],  // Warm Gold
      [0.64, 0.42, 0.98, 0.10]  // Royal Violet
    ];
    const lensPalette = [
      [0.65, 0.92, 1.0, 1.0],
      [1.0, 0.88, 0.58, 1.0],
      [0.82, 0.68, 1.0, 1.0]
    ];

    // Front overhead truss spotlights (9 detailed moving-head pods aiming across stage & catwalk)
    const frontPods = 9;
    for (let i = 0; i < frontPods; i++) {
      const frac = (i / (frontPods - 1)) - 0.5;
      const fx = frac * sw * 0.84;
      const podY = trussH - 0.65;
      addStageBox(fx, podY, frontTrussZ, 0.55, 0.55, 0.55, trussBrace, 0);
      addStageBox(fx, podY - 0.32, frontTrussZ + 0.1, 0.32, 0.18, 0.32, lensPalette[i % lensPalette.length], 0);

      const targetZ = (i % 3 === 1) ? bStageZ : (stageZ + sd * 0.55 + (i % 2) * 8);
      const targetX = frac * sw * 0.95;
      addRefinedBeam(fx, podY - 0.35, frontTrussZ + 0.1, targetX, sh + 0.15, targetZ, 2.1, beamPalette[i % beamPalette.length]);
    }

    // Mid-truss & side tower accent wash lights
    const sidePods = 4;
    for (let i = 0; i < sidePods; i++) {
      const frac = (i / (sidePods - 1)) - 0.5;
      const bx = frac * sw * 0.72;
      const podY = trussH - 0.55;
      addStageBox(bx, podY, midTrussZ, 0.50, 0.48, 0.50, trussBrace, 0);
      addStageBox(bx, podY - 0.28, midTrussZ, 0.28, 0.16, 0.28, lensPalette[(i + 1) % lensPalette.length], 0);
      addRefinedBeam(bx, podY - 0.3, midTrussZ, -bx * 0.6, sh + 0.15, stageZ + sd * 0.25, 2.4, beamPalette[(i + 1) % beamPalette.length]);
    }
  }

  buildSportsEquipmentMesh(solid) {
    const infield = this.venue.infield;
    if (!infield) return;
    const hl = (infield.pitchLength || 105) / 2;
    const whiteCol = [0.95, 0.97, 1.0, 1.0];
    const pitchOri = infield.pitchOrientationDeg || 0;
    const rotRad = -pitchOri * DEG2RAD;

    const addEqBox = (lx, cy, lz, w, h, d, col) => {
      const wp = rotateXZ(lx, lz, pitchOri);
      solid.addBox(wp.x, cy, wp.z, w, h, d, col, rotRad);
    };

    if (infield.surfaceType === 'hardwood-court') {
      // Basketball stanchions & backboards
      addEqBox(0, 1.8, -hl - 0.8, 0.4, 3.6, 0.4, [0.15, 0.20, 0.30, 1.0]);
      addEqBox(0, 3.3, -hl + 0.4, 1.8, 1.05, 0.1, whiteCol);
      addEqBox(0, 1.8, hl + 0.8, 0.4, 3.6, 0.4, [0.15, 0.20, 0.30, 1.0]);
      addEqBox(0, 3.3, hl - 0.4, 1.8, 1.05, 0.1, whiteCol);
    } else {
      // Football goals
      addEqBox(0, 1.22, -hl, 7.32, 2.44, 0.3, whiteCol);
      addEqBox(0, 1.22, hl, 7.32, 2.44, 0.3, whiteCol);
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

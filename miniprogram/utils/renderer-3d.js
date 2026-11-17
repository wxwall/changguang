/**
 * STADIACAD 3D WebGL Immersive Stadium & Concert Stage Engine
 * Pure Native WebGL1 implementation for WeChat Mini Program `<canvas type="webgl">`
 * Features:
 * - Accurate parametric 3D stadium bowl generation from STADIACAD 2.0.0 schema
 * - Tiered risers, vomitory portals, VIP skyboxes, and glass/steel guardrails
 * - Concert stage with main LED screen, side wing screens, catwalk, FOH tower, and animated volumetric spotlight beams
 * - Smooth exponential camera flight between Aerial Bird's-Eye View and First-Person Seat Sightline View
 * - Dynamic optical zoom (0.5x Ultra-Wide, 1x Eye, 2x Telephoto, 5x Stage Close-up)
 */

const {
  DEG2RAD,
  getRayRoundedRectDistance,
  computeTierRadialBounds
} = require('./schema-geometry');

// Matrix4 math utilities
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
  uniform float uTime;
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
      // Animated concert stage / LED / laser beam glow
      float pulse = 0.88 + 0.12 * sin(uTime * 3.0 + vWorldPos.x * 0.15 + vWorldPos.y * 0.2);
      gl_FragColor = vec4(vColor.rgb * pulse, vColor.a);
      return;
    }
    vec3 norm = normalize(vNormal);
    vec3 lightDir1 = normalize(vec3(0.35, 0.85, 0.4));
    vec3 lightDir2 = normalize(vec3(-0.4, 0.5, -0.6));
    float diff1 = max(dot(norm, lightDir1), 0.0);
    float diff2 = max(dot(norm, lightDir2), 0.0) * 0.35;
    float ambient = 0.42;
    float lighting = min(1.25, ambient + diff1 * 0.58 + diff2);

    // Subtle distance atmospheric depth
    vec3 finalRgb = vColor.rgb * lighting;
    gl_FragColor = vec4(finalRgb, vColor.a);
  }
`;

/**
 * Dynamic Geometry Builder accumulating triangles with positions, normals, and RGBA colors
 */
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

    // Top
    this.addQuad(v010, v011, v111, v110, color, { x: 0, y: 1, z: 0 });
    // Front (+Z)
    this.addQuad(v001, v101, v111, v011, color);
    // Back (-Z)
    this.addQuad(v100, v000, v010, v110, color);
    // Left (-X)
    this.addQuad(v000, v001, v011, v010, color);
    // Right (+X)
    this.addQuad(v101, v100, v110, v111, color);
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

    // Camera state ('bird' | 'seat')
    this.cameraMode = 'bird';
    this.zoomLevel = 1.0; // 0.5x, 1.0x, 2.0x, 5.0x
    this.baseFovDeg = 58;

    // Current & Target camera vectors for smooth interpolation
    this.camEye = { x: 0, y: 165, z: 215 };
    this.camTarget = { x: 0, y: 0, z: 0 };
    this.targetEye = { x: 0, y: 165, z: 215 };
    this.targetLook = { x: 0, y: 0, z: 0 };

    // Touch look/orbit deltas
    this.orbitYaw = 0.35;
    this.orbitPitch = 0.68;
    this.orbitDist = 270;
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
    this.orbitDist = Math.max(summary.outermostFootprintLengthM || 260, 180) * 0.92;
    this.setBirdEyeView();
    this.rebuildSceneMeshes();
  }

  setViewMode(viewMode) {
    this.viewMode = viewMode;
    this.rebuildSceneMeshes();
  }

  setSelection(sectorId, moduleId) {
    this.selectedSectorId = sectorId;
    this.selectedModuleId = moduleId;
    this.rebuildSceneMeshes();
  }

  setZoom(zoom) {
    this.zoomLevel = zoom;
  }

  /**
   * Transitions camera to Aerial Bird's-Eye View
   */
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
      y: Math.max(25, sinP * r),
      z: Math.cos(this.orbitYaw) * cosP * r
    };
    this.targetLook = { x: 0, y: 4, z: 0 };
  }

  /**
   * Transitions camera smoothly into First-Person Seat Sightline View
   */
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
    this.targetEye = { ...this.baseSeatEye };

    const dx = this.baseSeatTarget.x - this.baseSeatEye.x;
    const dy = this.baseSeatTarget.y - this.baseSeatEye.y;
    const dz = this.baseSeatTarget.z - this.baseSeatEye.z;
    const horizDist = Math.hypot(dx, dz) || 1;
    const baseYaw = Math.atan2(dx, dz);
    const basePitch = Math.atan2(dy, horizDist);

    const finalYaw = baseYaw + this.seatYawOffset;
    const finalPitch = Math.max(-1.1, Math.min(1.1, basePitch + this.seatPitchOffset));
    const dist = Math.hypot(dx, dy, dz) || 50;

    this.targetLook = {
      x: this.baseSeatEye.x + Math.sin(finalYaw) * Math.cos(finalPitch) * dist,
      y: this.baseSeatEye.y + Math.sin(finalPitch) * dist,
      z: this.baseSeatEye.z + Math.cos(finalYaw) * Math.cos(finalPitch) * dist
    };
  }

  /**
   * Handles single-finger drag in 3D view:
   * - In Bird mode: orbits around stadium
   * - In Seat mode: rotates spectator head (360° panoramic look-around)
   */
  handleTouchDrag(dxPx, dyPx) {
    if (this.cameraMode === 'bird') {
      this.orbitYaw -= dxPx * 0.007;
      this.orbitPitch = Math.max(0.22, Math.min(1.42, this.orbitPitch + dyPx * 0.006));
      this.updateBirdCameraTarget();
    } else {
      const sensitivity = 0.0035 / Math.sqrt(this.zoomLevel || 1);
      this.seatYawOffset -= dxPx * sensitivity;
      this.seatPitchOffset = Math.max(-0.65, Math.min(0.65, this.seatPitchOffset - dyPx * sensitivity));
      this.updateSeatCameraTarget();
    }
  }

  handlePinchZoom(scaleDelta) {
    if (this.cameraMode === 'bird') {
      this.orbitDist = Math.max(80, Math.min(480, this.orbitDist / scaleDelta));
      this.updateBirdCameraTarget();
    } else {
      this.zoomLevel = Math.max(0.5, Math.min(6.0, this.zoomLevel * scaleDelta));
    }
  }

  /**
   * Builds all 3D geometry buffers from the current STADIACAD schema
   */
  rebuildSceneMeshes() {
    if (!this.venue || !this.gl) return;

    const solid = new MeshBuilder();
    const alpha = new MeshBuilder();
    const beams = new MeshBuilder();

    // 1. Build Infield Floor & Pitch
    this.buildInfieldMesh(solid);

    // 2. Build Infield Modules (Dugouts / Field-side seats)
    this.buildInfieldModulesMesh(solid);

    // 3. Build Stand Tiers (Stepped bowl, vomitories, VIP boxes, guardrails)
    this.buildStandTiersMesh(solid, alpha);

    // 4. Build Stadium Architectural Roof / Rim Canopy
    this.buildStadiumCanopyRim(solid);

    // 5. Build Concert Stage, Giant LED Screens, Trusses, FOH & Volumetric Light Beams
    if (this.viewMode === 'concert') {
      this.buildConcertStageMesh(solid, alpha, beams);
    } else {
      this.buildSportsGoalsMesh(solid);
    }

    this.solidBuffers = this.uploadMesh(solid);
    this.alphaBuffers = this.uploadMesh(alpha);
    this.beamBuffers = this.uploadMesh(beams);
  }

  buildInfieldMesh(solid) {
    const infield = this.venue.infield;
    if (!infield) return;

    const segs = 64;
    let trackColor = [0.06, 0.28, 0.21, 1.0];
    if (infield.surfaceType === 'synthetic-track') {
      trackColor = [0.52, 0.18, 0.09, 1.0]; // Olympic track terracotta
    } else if (infield.surfaceType === 'hardwood-court') {
      trackColor = [0.12, 0.16, 0.24, 1.0];
    }

    // Rounded-rect floor fan
    for (let i = 0; i < segs; i++) {
      const deg1 = (i / segs) * 360;
      const deg2 = ((i + 1) / segs) * 360;
      const r1 = getRayRoundedRectDistance(deg1, infield.length, infield.width, infield.cornerRadius);
      const r2 = getRayRoundedRectDistance(deg2, infield.length, infield.width, infield.cornerRadius);

      const p1 = { x: Math.sin(deg1 * DEG2RAD) * r1, y: -0.05, z: -Math.cos(deg1 * DEG2RAD) * r1 };
      const p2 = { x: Math.sin(deg2 * DEG2RAD) * r2, y: -0.05, z: -Math.cos(deg2 * DEG2RAD) * r2 };
      solid.addTriangle({ x: 0, y: -0.05, z: 0 }, p1, p2, trackColor, { x: 0, y: 1, z: 0 });
    }

    // Pitch / Court surface
    const pw = infield.pitchWidth || 68;
    const pl = infield.pitchLength || 105;
    const hw = pw / 2;
    const hl = pl / 2;

    if (infield.surfaceType === 'hardwood-court') {
      // Maple hardwood basketball court
      solid.addQuad(
        { x: -hw, y: 0.02, z: -hl },
        { x: -hw, y: 0.02, z: hl },
        { x: hw, y: 0.02, z: hl },
        { x: hw, y: 0.02, z: -hl },
        [0.78, 0.45, 0.16, 1.0],
        { x: 0, y: 1, z: 0 }
      );
      // Key areas
      solid.addQuad(
        { x: -4.5, y: 0.04, z: -hl },
        { x: -4.5, y: 0.04, z: -hl + 5.8 },
        { x: 4.5, y: 0.04, z: -hl + 5.8 },
        { x: 4.5, y: 0.04, z: -hl },
        [0.15, 0.38, 0.85, 1.0],
        { x: 0, y: 1, z: 0 }
      );
      solid.addQuad(
        { x: -4.5, y: 0.04, z: hl - 5.8 },
        { x: -4.5, y: 0.04, z: hl },
        { x: 4.5, y: 0.04, z: hl },
        { x: 4.5, y: 0.04, z: hl - 5.8 },
        [0.15, 0.38, 0.85, 1.0],
        { x: 0, y: 1, z: 0 }
      );
    } else {
      // Mowed grass stripes
      const stripes = 12;
      const stripeLen = pl / stripes;
      for (let i = 0; i < stripes; i++) {
        const z1 = -hl + i * stripeLen;
        const z2 = z1 + stripeLen;
        const col = i % 2 === 0 ? [0.05, 0.46, 0.32, 1.0] : [0.07, 0.54, 0.37, 1.0];
        solid.addQuad(
          { x: -hw, y: 0.02, z: z1 },
          { x: -hw, y: 0.02, z: z2 },
          { x: hw, y: 0.02, z: z2 },
          { x: hw, y: 0.02, z: z1 },
          col,
          { x: 0, y: 1, z: 0 }
        );
      }

      // White boundary & halfway line strips
      const lw = 0.45;
      const lineCol = [0.92, 0.96, 1.0, 1.0];
      solid.addQuad({ x: -hw, y: 0.05, z: -lw }, { x: -hw, y: 0.05, z: lw }, { x: hw, y: 0.05, z: lw }, { x: hw, y: 0.05, z: -lw }, lineCol, { x: 0, y: 1, z: 0 });
      solid.addQuad({ x: -hw, y: 0.05, z: -hl }, { x: -hw, y: 0.05, z: -hl + lw }, { x: hw, y: 0.05, z: -hl + lw }, { x: hw, y: 0.05, z: -hl }, lineCol, { x: 0, y: 1, z: 0 });
      solid.addQuad({ x: -hw, y: 0.05, z: hl - lw }, { x: -hw, y: 0.05, z: hl }, { x: hw, y: 0.05, z: hl }, { x: hw, y: 0.05, z: hl - lw }, lineCol, { x: 0, y: 1, z: 0 });
      solid.addQuad({ x: -hw, y: 0.05, z: -hl }, { x: -hw + lw, y: 0.05, z: -hl }, { x: -hw + lw, y: 0.05, z: hl }, { x: -hw, y: 0.05, z: hl }, lineCol, { x: 0, y: 1, z: 0 });
      solid.addQuad({ x: hw - lw, y: 0.05, z: -hl }, { x: hw, y: 0.05, z: -hl }, { x: hw, y: 0.05, z: hl }, { x: hw - lw, y: 0.05, z: hl }, lineCol, { x: 0, y: 1, z: 0 });
    }
  }

  buildInfieldModulesMesh(solid) {
    const modules = this.venue.infieldModules || [];
    modules.forEach((mod) => {
      const isSelected = mod.id === this.selectedModuleId;
      const col = isSelected ? [0.96, 0.25, 0.37, 1.0] : [0.06, 0.72, 0.50, 1.0];
      const rotRad = (mod.rotationDeg || 0) * DEG2RAD;
      solid.addBox(
        mod.x || 0,
        (mod.baseElevation || 0) + 0.6,
        mod.y || 0,
        mod.width || 24,
        1.2,
        mod.depth || 5,
        col,
        rotRad
      );
    });
  }

  buildStandTiersMesh(solid, alpha) {
    const tiers = this.venue.standTiers || [];
    const tierPalette = [
      [0.16, 0.34, 0.74, 1.0], // 1F Royal Blue
      [0.05, 0.52, 0.38, 1.0], // 2F Emerald
      [0.72, 0.42, 0.09, 1.0], // 3F Amber VIP
      [0.42, 0.22, 0.78, 1.0]  // 4F Violet Upper
    ];

    tiers.forEach((tier, tierIndex) => {
      const baseColor = tierPalette[(tier.level - 1) % tierPalette.length];
      const sectors = tier.sectors || [];

      sectors.forEach((sec) => {
        if (sec.isDeleted || sec.fillType === 'empty-void') return;

        const isSelected = sec.id === this.selectedSectorId;
        const isVip = sec.fillType === 'vip-box';

        let secColor = baseColor;
        if (isSelected) {
          secColor = [0.96, 0.25, 0.37, 1.0]; // Highlight Rose Red
        } else if (isVip) {
          secColor = [0.85, 0.55, 0.12, 1.0]; // Gold VIP Box
        }

        const aisleGapDeg = 0.45;
        const sDeg = sec.startAngleDeg + aisleGapDeg;
        const eDeg = sec.endAngleDeg - aisleGapDeg;
        if (eDeg <= sDeg) return;

        const angularSpan = eDeg - sDeg;
        const angSteps = Math.max(3, Math.ceil(angularSpan / 5.5));
        const totalRows = sec.rows || tier.defaultRows || 22;
        const rowPitch = sec.rowPitch || tier.defaultRowPitch || 0.85;
        const slopeDeg = sec.slopeDeg || tier.defaultSlopeDeg || 20;
        const riserH = sec.riserHeight || (rowPitch * Math.tan(slopeDeg * DEG2RAD));
        const baseElev = tier.baseElevation || 1.0;
        const topElev = baseElev + totalRows * riserH;

        // Subdivide radially into 5 stepped terrace bands for crisp 3D tier steps
        const radialBands = isVip ? 2 : 5;

        for (let a = 0; a < angSteps; a++) {
          const deg1 = sDeg + (a / angSteps) * angularSpan;
          const deg2 = sDeg + ((a + 1) / angSteps) * angularSpan;
          const rad1 = deg1 * DEG2RAD;
          const rad2 = deg2 * DEG2RAD;
          const sin1 = Math.sin(rad1), cos1 = -Math.cos(rad1);
          const sin2 = Math.sin(rad2), cos2 = -Math.cos(rad2);

          const b1 = computeTierRadialBounds(this.venue, tierIndex, deg1, sec.customRadialDepth);
          const b2 = computeTierRadialBounds(this.venue, tierIndex, deg2, sec.customRadialDepth);

          // Check if this angular slice is a Vomitory portal cutout
          const isMidSlice = a === Math.floor(angSteps / 2);
          const hasVomitory = sec.vomitory && sec.vomitory.position !== 'none' && sec.vomitory.enabled !== false;

          for (let rb = 0; rb < radialBands; rb++) {
            const f0 = rb / radialBands;
            const f1 = (rb + 1) / radialBands;

            const r1_in = b1.innerRadius + (b1.outerRadius - b1.innerRadius) * f0;
            const r1_out = b1.innerRadius + (b1.outerRadius - b1.innerRadius) * f1;
            const r2_in = b2.innerRadius + (b2.outerRadius - b2.innerRadius) * f0;
            const r2_out = b2.innerRadius + (b2.outerRadius - b2.innerRadius) * f1;

            const y_in = baseElev + (topElev - baseElev) * f0;
            const y_mid = baseElev + (topElev - baseElev) * (f0 + 0.65 / radialBands);
            const y_out = baseElev + (topElev - baseElev) * f1;

            // Darken vomitory cutout slice
            let bandColor = secColor;
            if (hasVomitory && isMidSlice && rb === 1) {
              bandColor = [0.06, 0.09, 0.15, 1.0];
            } else if (rb % 2 === 1 && !isSelected) {
              bandColor = [secColor[0] * 0.88, secColor[1] * 0.88, secColor[2] * 0.88, 1.0];
            }

            // Riser vertical face
            const p1_b = { x: sin1 * r1_in, y: y_in, z: cos1 * r1_in };
            const p2_b = { x: sin2 * r2_in, y: y_in, z: cos2 * r2_in };
            const p2_t = { x: sin2 * r2_in, y: y_mid, z: cos2 * r2_in };
            const p1_t = { x: sin1 * r1_in, y: y_mid, z: cos1 * r1_in };
            solid.addQuad(p1_b, p1_t, p2_t, p2_b, bandColor);

            // Tread sloped seating deck
            const p1_out = { x: sin1 * r1_out, y: y_out, z: cos1 * r1_out };
            const p2_out = { x: sin2 * r2_out, y: y_out, z: cos2 * r2_out };
            solid.addQuad(p1_t, p1_out, p2_out, p2_t, bandColor);
          }

          // Front fascia parapet wall + Guardrail
          const guard = sec.guardrail || tier.defaultGuardrail || {};
          const frontH = guard.frontRailHeight || 1.1;
          const f1_bot = { x: sin1 * b1.innerRadius, y: Math.max(0, baseElev - 1.2), z: cos1 * b1.innerRadius };
          const f2_bot = { x: sin2 * b2.innerRadius, y: Math.max(0, baseElev - 1.2), z: cos2 * b2.innerRadius };
          const f2_top = { x: sin2 * b2.innerRadius, y: baseElev, z: cos2 * b2.innerRadius };
          const f1_top = { x: sin1 * b1.innerRadius, y: baseElev, z: cos1 * b1.innerRadius };
          solid.addQuad(f1_bot, f1_top, f2_top, f2_bot, [0.18, 0.22, 0.30, 1.0]);

          if (guard.frontRailEnabled) {
            const g1_top = { x: sin1 * b1.innerRadius, y: baseElev + frontH, z: cos1 * b1.innerRadius };
            const g2_top = { x: sin2 * b2.innerRadius, y: baseElev + frontH, z: cos2 * b2.innerRadius };
            const isGlass = guard.material === 'tempered-glass';
            if (isGlass) {
              alpha.addQuad(f1_top, g1_top, g2_top, f2_top, [0.56, 0.85, 0.98, 0.32]);
            } else {
              solid.addQuad(f1_top, g1_top, g2_top, f2_top, [0.45, 0.52, 0.62, 1.0]);
            }
          }

          // Rear perimeter wall
          if (guard.rearWallEnabled) {
            const rearH = guard.rearWallHeight || 1.5;
            const rw1_b = { x: sin1 * b1.outerRadius, y: topElev, z: cos1 * b1.outerRadius };
            const rw2_b = { x: sin2 * b2.outerRadius, y: topElev, z: cos2 * b2.outerRadius };
            const rw2_t = { x: sin2 * b2.outerRadius, y: topElev + rearH, z: cos2 * b2.outerRadius };
            const rw1_t = { x: sin1 * b1.outerRadius, y: topElev + rearH, z: cos1 * b1.outerRadius };
            solid.addQuad(rw1_b, rw1_t, rw2_t, rw2_b, [0.15, 0.19, 0.27, 1.0]);
          }
        }
      });
    });
  }

  buildStadiumCanopyRim(solid) {
    const summary = this.venue.engineeringSummary || {};
    const maxElev = (summary.maxBowlElevationM || 32) + 2.5;
    const tiers = this.venue.standTiers || [];
    const lastTierIdx = tiers.length - 1;
    if (lastTierIdx < 0) return;

    const segs = 60;
    const rimColor = [0.22, 0.27, 0.36, 1.0];
    const soffitColor = [0.12, 0.16, 0.23, 1.0];

    for (let i = 0; i < segs; i++) {
      const deg1 = (i / segs) * 360;
      const deg2 = ((i + 1) / segs) * 360;
      // Leave Torch Vista opening at North top if Bird's Nest
      if (this.venue.id === 'std-beijing-bird-nest' && (deg1 < 12 || deg1 > 348)) {
        continue;
      }

      const b1 = computeTierRadialBounds(this.venue, lastTierIdx, deg1);
      const b2 = computeTierRadialBounds(this.venue, lastTierIdx, deg2);

      const sin1 = Math.sin(deg1 * DEG2RAD), cos1 = -Math.cos(deg1 * DEG2RAD);
      const sin2 = Math.sin(deg2 * DEG2RAD), cos2 = -Math.cos(deg2 * DEG2RAD);

      const rIn1 = b1.outerRadius - 14;
      const rOut1 = b1.outerRadius + 6;
      const rIn2 = b2.outerRadius - 14;
      const rOut2 = b2.outerRadius + 6;

      // Saddle wave modulation for Bird's Nest
      let saddle1 = 0, saddle2 = 0;
      if (this.venue.id === 'std-beijing-bird-nest') {
        saddle1 = Math.sin(deg1 * DEG2RAD) * Math.sin(deg1 * DEG2RAD) * 8.5;
        saddle2 = Math.sin(deg2 * DEG2RAD) * Math.sin(deg2 * DEG2RAD) * 8.5;
      }

      const p1_in = { x: sin1 * rIn1, y: maxElev + saddle1 + 1.5, z: cos1 * rIn1 };
      const p1_out = { x: sin1 * rOut1, y: maxElev + saddle1, z: cos1 * rOut1 };
      const p2_out = { x: sin2 * rOut2, y: maxElev + saddle2, z: cos2 * rOut2 };
      const p2_in = { x: sin2 * rIn2, y: maxElev + saddle2 + 1.5, z: cos2 * rIn2 };

      solid.addQuad(p1_in, p1_out, p2_out, p2_in, rimColor, { x: 0, y: 1, z: 0 });
      solid.addQuad(p1_out, p1_in, p2_in, p2_out, soffitColor, { x: 0, y: -1, z: 0 });
    }
  }

  buildConcertStageMesh(solid, alpha, beams) {
    const infield = this.venue.infield;
    const stage = infield && infield.stageConfig;
    if (!stage) return;

    const sw = stage.width || 36;
    const sd = stage.depth || 22;
    const sh = stage.height || 2.0;
    const backH = stage.backdropHeight || 14;
    const cw = stage.catwalkWidth || 3.5;
    const cl = stage.catwalkLength || 16;

    if (stage.type === 'center-stage') {
      // 360° Four-Sided Arena Center Stage (e.g. Wukesong Arena)
      solid.addBox(0, sh / 2, 0, sw, sh, sd, [0.12, 0.14, 0.20, 1.0], 0);
      // Glowing stage top deck
      solid.addQuad(
        { x: -sw / 2 + 0.5, y: sh + 0.05, z: -sd / 2 + 0.5 },
        { x: -sw / 2 + 0.5, y: sh + 0.05, z: sd / 2 - 0.5 },
        { x: sw / 2 - 0.5, y: sh + 0.05, z: sd / 2 - 0.5 },
        { x: sw / 2 - 0.5, y: sh + 0.05, z: -sd / 2 + 0.5 },
        [0.92, 0.18, 0.48, 1.0],
        { x: 0, y: 1, z: 0 }
      );
      // 4 Catwalks
      solid.addBox(0, sh / 2, -sd / 2 - cl / 2, cw, sh, cl, [0.85, 0.15, 0.38, 1.0], 0);
      solid.addBox(0, sh / 2, sd / 2 + cl / 2, cw, sh, cl, [0.85, 0.15, 0.38, 1.0], 0);
      solid.addBox(-sw / 2 - cl / 2, sh / 2, 0, cl, sh, cw, [0.85, 0.15, 0.38, 1.0], 0);
      solid.addBox(sw / 2 + cl / 2, sh / 2, 0, cl, sh, cw, [0.85, 0.15, 0.38, 1.0], 0);

      // Suspended 4-sided Giant LED Cube Rig above center stage
      const rigY = sh + backH * 0.85;
      solid.addBox(0, rigY, 0, sw * 0.72, backH * 0.65, sd * 0.72, [0.08, 0.65, 0.95, 1.0], 0);

      // Volumetric laser & spotlight beams from center rig
      const beamColors = [
        [0.96, 0.25, 0.55, 0.28],
        [0.22, 0.74, 0.98, 0.26],
        [0.65, 0.32, 0.96, 0.26]
      ];
      for (let i = 0; i < 12; i++) {
        const ang = (i / 12) * Math.PI * 2;
        const bx = Math.cos(ang) * (sw * 0.35);
        const bz = Math.sin(ang) * (sd * 0.35);
        const tx = Math.cos(ang) * (sw * 1.45);
        const tz = Math.sin(ang) * (sd * 1.45);
        const topPt = { x: bx, y: rigY + 2, z: bz };
        const bLeft = { x: tx - Math.sin(ang) * 3.5, y: sh, z: tz + Math.cos(ang) * 3.5 };
        const bRight = { x: tx + Math.sin(ang) * 3.5, y: sh, z: tz - Math.cos(ang) * 3.5 };
        beams.addTriangle(topPt, bLeft, bRight, beamColors[i % beamColors.length]);
      }
      return;
    }

    // End-Stage or Festival-Stage at North end facing South (+Z)
    const stageZ = -(infield.pitchLength || 100) * 0.36;

    // Main stage platform
    solid.addBox(0, sh / 2, stageZ, sw, sh, sd, [0.14, 0.16, 0.24, 1.0], 0);
    // Luminous stage floor
    solid.addQuad(
      { x: -sw / 2 + 1, y: sh + 0.05, z: stageZ - sd / 2 + 1 },
      { x: -sw / 2 + 1, y: sh + 0.05, z: stageZ + sd / 2 - 1 },
      { x: sw / 2 - 1, y: sh + 0.05, z: stageZ + sd / 2 - 1 },
      { x: sw / 2 - 1, y: sh + 0.05, z: stageZ - sd / 2 + 1 },
      [0.88, 0.16, 0.45, 1.0],
      { x: 0, y: 1, z: 0 }
    );

    // Extended T-Catwalk into audience
    const catZ = stageZ + sd / 2 + cl / 2;
    solid.addBox(0, sh / 2, catZ, cw, sh, cl, [0.85, 0.15, 0.42, 1.0], 0);
    // Sub-stage at tip of catwalk
    solid.addBox(0, sh / 2, stageZ + sd / 2 + cl + 3, cw * 2.2, sh, 6, [0.95, 0.24, 0.48, 1.0], 0);

    // Center Giant Curved/Flat Main LED Backdrop Screen
    const screenZ = stageZ - sd / 2 + 1.5;
    solid.addBox(0, sh + backH / 2, screenZ, sw * 0.92, backH, 1.2, [0.06, 0.58, 0.92, 1.0], 0);

    // Left & Right Angled IMAX Side Wing LED Screens
    const wingW = sw * 0.38;
    const wingH = backH * 0.88;
    solid.addBox(-sw * 0.68, sh + wingH / 2, screenZ + 4, wingW, wingH, 1.0, [0.55, 0.24, 0.92, 1.0], 0.35);
    solid.addBox(sw * 0.68, sh + wingH / 2, screenZ + 4, wingW, wingH, 1.0, [0.55, 0.24, 0.92, 1.0], -0.35);

    // Overhead Steel Space Truss Roof & Line Array Speaker Clusters
    const trussH = sh + backH + 1.5;
    solid.addBox(0, trussH, stageZ, sw * 1.05, 1.8, sd * 0.9, [0.35, 0.42, 0.52, 1.0], 0);
    // 4 Vertical Truss Towers
    solid.addBox(-sw * 0.48, (sh + backH) / 2, stageZ - sd * 0.4, 1.2, sh + backH, 1.2, [0.3, 0.36, 0.45, 1.0], 0);
    solid.addBox(sw * 0.48, (sh + backH) / 2, stageZ - sd * 0.4, 1.2, sh + backH, 1.2, [0.3, 0.36, 0.45, 1.0], 0);
    solid.addBox(-sw * 0.48, (sh + backH) / 2, stageZ + sd * 0.4, 1.2, sh + backH, 1.2, [0.3, 0.36, 0.45, 1.0], 0);
    solid.addBox(sw * 0.48, (sh + backH) / 2, stageZ + sd * 0.4, 1.2, sh + backH, 1.2, [0.3, 0.36, 0.45, 1.0], 0);

    // FOH Sound/Light Control Tent in Infield
    if (stage.fohEnabled) {
      const fohZ = stageZ + sd / 2 + (stage.fohDistance || 38);
      const fw = stage.fohWidth || 8;
      const fd = stage.fohDepth || 5;
      solid.addBox(0, 1.8, fohZ, fw, 3.6, fd, [0.08, 0.38, 0.65, 1.0], 0);
    }

    // Volumetric Concert Spotlight & Laser Cones
    const numBeams = 10;
    const beamCols = [
      [0.98, 0.22, 0.52, 0.28],
      [0.18, 0.78, 0.98, 0.26],
      [0.68, 0.28, 0.98, 0.28]
    ];
    for (let i = 0; i < numBeams; i++) {
      const frac = (i / (numBeams - 1)) - 0.5;
      const bx = frac * sw * 0.9;
      const origin = { x: bx, y: trussH - 0.5, z: stageZ + 2 };
      const targetZ = stageZ + sd + 12 + (i % 3) * 14;
      const spreadX = bx * 1.6;
      const pL = { x: spreadX - 4.5, y: 0.2, z: targetZ };
      const pR = { x: spreadX + 4.5, y: 0.2, z: targetZ };
      beams.addTriangle(origin, pL, pR, beamCols[i % beamCols.length]);
    }
  }

  buildSportsGoalsMesh(solid) {
    const infield = this.venue.infield;
    if (!infield) return;
    const hl = (infield.pitchLength || 105) / 2;
    const goalCol = [0.95, 0.97, 1.0, 1.0];
    solid.addBox(0, 1.22, -hl, 7.32, 2.44, 0.4, goalCol, 0);
    solid.addBox(0, 1.22, hl, 7.32, 2.44, 0.4, goalCol, 0);
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

  /**
   * Main 60fps animation frame tick
   */
  renderFrame() {
    const gl = this.gl;
    if (!gl || !this.program) return;

    // Smooth camera damping interpolation
    const lerp = 0.12;
    this.camEye.x += (this.targetEye.x - this.camEye.x) * lerp;
    this.camEye.y += (this.targetEye.y - this.camEye.y) * lerp;
    this.camEye.z += (this.targetEye.z - this.camEye.z) * lerp;

    this.camTarget.x += (this.targetLook.x - this.camTarget.x) * lerp;
    this.camTarget.y += (this.targetLook.y - this.camTarget.y) * lerp;
    this.camTarget.z += (this.targetLook.z - this.camTarget.z) * lerp;

    // Compute dynamic FOV based on zoomLevel (0.5x -> 82 deg, 1x -> 58 deg, 2x -> 32 deg, 5x -> 14 deg)
    const effectiveFovDeg = Math.max(12, Math.min(92, this.baseFovDeg / Math.pow(this.zoomLevel || 1, 0.85)));
    const aspect = (this.width || 375) / Math.max(1, this.height || 400);

    Mat4.perspective(this.projMat, effectiveFovDeg * DEG2RAD, aspect, 1.0, 1200.0);
    Mat4.lookAt(this.viewMat, this.camEye, this.camTarget, { x: 0, y: 1, z: 0 });
    Mat4.multiply(this.mvpMat, this.projMat, this.viewMat);

    gl.viewport(0, 0, this.width, this.height);
    gl.clearColor(0.03, 0.045, 0.09, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.useProgram(this.program);
    gl.uniformMatrix4fv(this.uniMVP, false, this.mvpMat);
    const elapsedSec = (Date.now() - this.startTime) * 0.001;
    gl.uniform1f(this.uniTime, elapsedSec);

    // 1. Opaque stadium & stage geometry
    gl.disable(gl.BLEND);
    gl.depthMask(true);
    this.drawBufferGroup(this.solidBuffers, false);

    // 2. Transparent glass guardrails
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    this.drawBufferGroup(this.alphaBuffers, false);

    // 3. Additive concert spotlight & laser beams
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

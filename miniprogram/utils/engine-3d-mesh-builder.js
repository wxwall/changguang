/**
 * 3D Mesh Builder for Dynamic Geometry Generation
 */
class MeshBuilder {
  constructor(initialVertCap = 4096) {
    this._cap = initialVertCap;
    this._vertCount = 0;
    this._posBuf = new Float32Array(initialVertCap * 3);
    this._normBuf = new Float32Array(initialVertCap * 3);
    this._colBuf = new Float32Array(initialVertCap * 4);

    this._useSeatInstancing = false;
    this._seatInstCap = 0;
    this._seatInstCount = 0;
    this._seatInstBuf = null;
  }

  enableSeatInstancing(initialSeatCap = 4096) {
    this._useSeatInstancing = true;
    this._seatInstCap = initialSeatCap;
    this._seatInstCount = 0;
    this._seatInstBuf = new Float32Array(initialSeatCap * 13);
  }

  get seatInstanceCount() {
    return this._seatInstCount;
  }

  get seatInstances() {
    return this._seatInstBuf ? this._seatInstBuf.subarray(0, this._seatInstCount * 13) : null;
  }

  _ensureSeatInstances(extra = 1) {
    const needed = this._seatInstCount + extra;
    if (needed <= this._seatInstCap) return;
    let newCap = Math.max(4096, this._seatInstCap);
    while (newCap < needed) newCap *= 2;
    const next = new Float32Array(newCap * 13);
    if (this._seatInstBuf && this._seatInstCount > 0) {
      next.set(this._seatInstBuf.subarray(0, this._seatInstCount * 13));
    }
    this._seatInstBuf = next;
    this._seatInstCap = newCap;
  }

  get positions() {
    return this._posBuf.subarray(0, this._vertCount * 3);
  }

  get normals() {
    return this._normBuf.subarray(0, this._vertCount * 3);
  }

  get colors() {
    return this._colBuf.subarray(0, this._vertCount * 4);
  }

  _ensure(extraVerts) {
    const needed = this._vertCount + extraVerts;
    if (needed <= this._cap) return;
    let newCap = this._cap;
    while (newCap < needed) newCap *= 2;
    const nextPos = new Float32Array(newCap * 3);
    const nextNorm = new Float32Array(newCap * 3);
    const nextCol = new Float32Array(newCap * 4);
    nextPos.set(this._posBuf.subarray(0, this._vertCount * 3));
    nextNorm.set(this._normBuf.subarray(0, this._vertCount * 3));
    nextCol.set(this._colBuf.subarray(0, this._vertCount * 4));
    this._posBuf = nextPos;
    this._normBuf = nextNorm;
    this._colBuf = nextCol;
    this._cap = newCap;
  }

  _writeTriRaw(
    x1, y1, z1, x2, y2, z2, x3, y3, z3,
    nx, ny, nz,
    r, g, b, a
  ) {
    this._ensure(3);
    const v = this._vertCount;
    const pIdx = v * 3;
    const cIdx = v * 4;
    const pos = this._posBuf;
    const norm = this._normBuf;
    const col = this._colBuf;

    pos[pIdx] = x1; pos[pIdx + 1] = y1; pos[pIdx + 2] = z1;
    pos[pIdx + 3] = x2; pos[pIdx + 4] = y2; pos[pIdx + 5] = z2;
    pos[pIdx + 6] = x3; pos[pIdx + 7] = y3; pos[pIdx + 8] = z3;

    norm[pIdx] = nx; norm[pIdx + 1] = ny; norm[pIdx + 2] = nz;
    norm[pIdx + 3] = nx; norm[pIdx + 4] = ny; norm[pIdx + 5] = nz;
    norm[pIdx + 6] = nx; norm[pIdx + 7] = ny; norm[pIdx + 8] = nz;

    col[cIdx] = r; col[cIdx + 1] = g; col[cIdx + 2] = b; col[cIdx + 3] = a;
    col[cIdx + 4] = r; col[cIdx + 5] = g; col[cIdx + 6] = b; col[cIdx + 7] = a;
    col[cIdx + 8] = r; col[cIdx + 9] = g; col[cIdx + 10] = b; col[cIdx + 11] = a;

    this._vertCount = v + 3;
  }

  _writeQuadRaw(
    x1, y1, z1, x2, y2, z2, x3, y3, z3, x4, y4, z4,
    nx, ny, nz,
    r, g, b, a
  ) {
    this._ensure(6);
    const v = this._vertCount;
    const pIdx = v * 3;
    const cIdx = v * 4;
    const pos = this._posBuf;
    const norm = this._normBuf;
    const col = this._colBuf;

    // Tri 1: p1, p2, p3
    pos[pIdx] = x1; pos[pIdx + 1] = y1; pos[pIdx + 2] = z1;
    pos[pIdx + 3] = x2; pos[pIdx + 4] = y2; pos[pIdx + 5] = z2;
    pos[pIdx + 6] = x3; pos[pIdx + 7] = y3; pos[pIdx + 8] = z3;
    // Tri 2: p1, p3, p4
    pos[pIdx + 9] = x1; pos[pIdx + 10] = y1; pos[pIdx + 11] = z1;
    pos[pIdx + 12] = x3; pos[pIdx + 13] = y3; pos[pIdx + 14] = z3;
    pos[pIdx + 15] = x4; pos[pIdx + 16] = y4; pos[pIdx + 17] = z4;

    for (let i = 0; i < 18; i += 3) {
      norm[pIdx + i] = nx;
      norm[pIdx + i + 1] = ny;
      norm[pIdx + i + 2] = nz;
    }

    for (let i = 0; i < 24; i += 4) {
      col[cIdx + i] = r;
      col[cIdx + i + 1] = g;
      col[cIdx + i + 2] = b;
      col[cIdx + i + 3] = a;
    }

    this._vertCount = v + 6;
  }

  _writeVCQuadRaw(
    x1, y1, z1, r1, g1, b1, a1,
    x2, y2, z2, r2, g2, b2, a2,
    x3, y3, z3, r3, g3, b3, a3,
    x4, y4, z4, r4, g4, b4, a4,
    nx, ny, nz
  ) {
    this._ensure(6);
    const v = this._vertCount;
    const pIdx = v * 3;
    const cIdx = v * 4;
    const pos = this._posBuf;
    const norm = this._normBuf;
    const col = this._colBuf;

    pos[pIdx] = x1; pos[pIdx + 1] = y1; pos[pIdx + 2] = z1;
    pos[pIdx + 3] = x2; pos[pIdx + 4] = y2; pos[pIdx + 5] = z2;
    pos[pIdx + 6] = x3; pos[pIdx + 7] = y3; pos[pIdx + 8] = z3;

    pos[pIdx + 9] = x1; pos[pIdx + 10] = y1; pos[pIdx + 11] = z1;
    pos[pIdx + 12] = x3; pos[pIdx + 13] = y3; pos[pIdx + 14] = z3;
    pos[pIdx + 15] = x4; pos[pIdx + 16] = y4; pos[pIdx + 17] = z4;

    for (let i = 0; i < 18; i += 3) {
      norm[pIdx + i] = nx;
      norm[pIdx + i + 1] = ny;
      norm[pIdx + i + 2] = nz;
    }

    col[cIdx] = r1; col[cIdx + 1] = g1; col[cIdx + 2] = b1; col[cIdx + 3] = a1;
    col[cIdx + 4] = r2; col[cIdx + 5] = g2; col[cIdx + 6] = b2; col[cIdx + 7] = a2;
    col[cIdx + 8] = r3; col[cIdx + 9] = g3; col[cIdx + 10] = b3; col[cIdx + 11] = a3;

    col[cIdx + 12] = r1; col[cIdx + 13] = g1; col[cIdx + 14] = b1; col[cIdx + 15] = a1;
    col[cIdx + 16] = r3; col[cIdx + 17] = g3; col[cIdx + 18] = b3; col[cIdx + 19] = a3;
    col[cIdx + 20] = r4; col[cIdx + 21] = g4; col[cIdx + 22] = b4; col[cIdx + 23] = a4;

    this._vertCount = v + 6;
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
    this._writeTriRaw(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z, p3.x, p3.y, p3.z, nx, ny, nz, r, g, b, a);
  }

  addTri(p1, p2, p3, color, customNormal) {
    this.addTriangle(p1, p2, p3, color, customNormal);
  }

  addQuad(p1, p2, p3, p4, color, customNormal) {
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
    this._writeQuadRaw(
      p1.x, p1.y, p1.z, p2.x, p2.y, p2.z, p3.x, p3.y, p3.z, p4.x, p4.y, p4.z,
      nx, ny, nz, r, g, b, a
    );
  }

  addVertexColoredTriangle(p1, c1, p2, c2, p3, c3, customNormal) {
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
    this._ensure(3);
    const v = this._vertCount;
    const pIdx = v * 3;
    const cIdx = v * 4;
    const pos = this._posBuf;
    const norm = this._normBuf;
    const col = this._colBuf;

    pos[pIdx] = p1.x; pos[pIdx + 1] = p1.y; pos[pIdx + 2] = p1.z;
    pos[pIdx + 3] = p2.x; pos[pIdx + 4] = p2.y; pos[pIdx + 5] = p2.z;
    pos[pIdx + 6] = p3.x; pos[pIdx + 7] = p3.y; pos[pIdx + 8] = p3.z;

    norm[pIdx] = nx; norm[pIdx + 1] = ny; norm[pIdx + 2] = nz;
    norm[pIdx + 3] = nx; norm[pIdx + 4] = ny; norm[pIdx + 5] = nz;
    norm[pIdx + 6] = nx; norm[pIdx + 7] = ny; norm[pIdx + 8] = nz;

    col[cIdx] = c1[0]; col[cIdx + 1] = c1[1]; col[cIdx + 2] = c1[2]; col[cIdx + 3] = c1[3] !== undefined ? c1[3] : 1.0;
    col[cIdx + 4] = c2[0]; col[cIdx + 5] = c2[1]; col[cIdx + 6] = c2[2]; col[cIdx + 7] = c2[3] !== undefined ? c2[3] : 1.0;
    col[cIdx + 8] = c3[0]; col[cIdx + 9] = c3[1]; col[cIdx + 10] = c3[2]; col[cIdx + 11] = c3[3] !== undefined ? c3[3] : 1.0;

    this._vertCount = v + 3;
  }

  addVertexColoredQuad(p1, c1, p2, c2, p3, c3, p4, c4, customNormal) {
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
    this._writeVCQuadRaw(
      p1.x, p1.y, p1.z, c1[0], c1[1], c1[2], c1[3] !== undefined ? c1[3] : 1.0,
      p2.x, p2.y, p2.z, c2[0], c2[1], c2[2], c2[3] !== undefined ? c2[3] : 1.0,
      p3.x, p3.y, p3.z, c3[0], c3[1], c3[2], c3[3] !== undefined ? c3[3] : 1.0,
      p4.x, p4.y, p4.z, c4[0], c4[1], c4[2], c4[3] !== undefined ? c4[3] : 1.0,
      nx, ny, nz
    );
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
   * Adds a sculpted 3D stadium bucket seat oriented facing (fx, fz).
   * Features: dark riser stanchion, thick contoured seat pan with front bullnose lip,
   * AO vertex-color shading, tapered backrest with top crest rim & dark polymer rear shell.
   */
  addSeat3D(cx, cy, cz, seatWidth, seatDepth, fx, fz, panColor, backColor) {
    if (this._useSeatInstancing) {
      this._ensureSeatInstances(1);
      const idx = this._seatInstCount * 13;
      const buf = this._seatInstBuf;
      buf[idx] = cx;
      buf[idx + 1] = cy;
      buf[idx + 2] = cz;
      buf[idx + 3] = seatWidth;
      buf[idx + 4] = fx;
      buf[idx + 5] = fz;
      buf[idx + 6] = seatDepth;
      buf[idx + 7] = panColor[0];
      buf[idx + 8] = panColor[1];
      buf[idx + 9] = panColor[2];
      buf[idx + 10] = backColor[0];
      buf[idx + 11] = backColor[1];
      buf[idx + 12] = backColor[2];
      this._seatInstCount++;
      return;
    }
    this._writeSeat3D(cx, cy, cz, seatWidth, seatDepth, fx, fz, panColor, backColor, false);
  }

  _writeSeat3D(cx, cy, cz, seatWidth, seatDepth, fx, fz, panColor, backColor, encodePart) {
    const rx = -fz; // right-hand tangent vector
    const rz = fx;
    const hw = seatWidth * 0.495;
    const topHw = hw * 0.94;
    const hd = seatDepth * 0.49;

    const panFrontY = cy + 0.31;
    const panBackY = cy + 0.28;
    const panBotY = cy + 0.19;
    const backTopY = cy + 0.72;

    const pR0 = panColor[0], pG0 = panColor[1], pB0 = panColor[2], pA = encodePart ? 1.0 : (panColor[3] !== undefined ? panColor[3] : 1.0);
    const bR0 = backColor[0], bG0 = backColor[1], bB0 = backColor[2], bA = encodePart ? 2.0 : (backColor[3] !== undefined ? backColor[3] : 1.0);
    const legA = encodePart ? 0.0 : 1.0;

    const panLightR = Math.min(1.0, Math.max(0.02, pR0 * 1.02));
    const panLightG = Math.min(1.0, Math.max(0.02, pG0 * 1.02));
    const panLightB = Math.min(1.0, Math.max(0.02, pB0 * 1.02));

    const panCreaseR = Math.min(1.0, Math.max(0.02, pR0 * 0.93));
    const panCreaseG = Math.min(1.0, Math.max(0.02, pG0 * 0.93));
    const panCreaseB = Math.min(1.0, Math.max(0.02, pB0 * 0.93));

    const panLipR = Math.min(1.0, Math.max(0.02, pR0 * 0.91));
    const panLipG = Math.min(1.0, Math.max(0.02, pG0 * 0.91));
    const panLipB = Math.min(1.0, Math.max(0.02, pB0 * 0.91));

    const backCreaseR = Math.min(1.0, Math.max(0.02, bR0 * 0.91));
    const backCreaseG = Math.min(1.0, Math.max(0.02, bG0 * 0.91));
    const backCreaseB = Math.min(1.0, Math.max(0.02, bB0 * 0.91));

    const backShR = Math.min(1.0, Math.max(0.02, bR0 * 1.02));
    const backShG = Math.min(1.0, Math.max(0.02, bG0 * 1.02));
    const backShB = Math.min(1.0, Math.max(0.02, bB0 * 1.02));

    const crestR = Math.min(1.0, Math.max(0.02, bR0 * 1.04));
    const crestG = Math.min(1.0, Math.max(0.02, bG0 * 1.04));
    const crestB = Math.min(1.0, Math.max(0.02, bB0 * 1.04));

    const panUnderR = encodePart ? 0.72 : Math.max(0.06, pR0 * 0.72);
    const panUnderG = encodePart ? 0.72 : Math.max(0.06, pG0 * 0.72);
    const panUnderB = encodePart ? 0.74 : Math.max(0.08, pB0 * 0.74);

    const rearR = encodePart ? 0.84 : Math.max(0.10, bR0 * 0.84);
    const rearG = encodePart ? 0.84 : Math.max(0.11, bG0 * 0.84);
    const rearB = encodePart ? 0.85 : Math.max(0.13, bB0 * 0.85);

    this._ensure(84);

    // 1. Center riser-mounted 3D stanchion / pedestal leg (4 vertical faces)
    const legHw = encodePart ? 0.086 : Math.min(0.045, hw * 0.26);
    const legHd = encodePart ? 0.072 : Math.min(0.042, hd * 0.24);
    const legZ = -hd * 0.10;
    const rxLeg = rx * legHw, rzLeg = rz * legHw;
    const fxLegCenter = cx + fx * legZ, fzLegCenter = cz + fz * legZ;
    const fxLeg = fx * legHd, fzLeg = fz * legHd;
    const lFLx = fxLegCenter - rxLeg + fxLeg, lFLz = fzLegCenter - rzLeg + fzLeg;
    const lFRx = fxLegCenter + rxLeg + fxLeg, lFRz = fzLegCenter + rzLeg + fzLeg;
    const lBRx = fxLegCenter + rxLeg - fxLeg, lBRz = fzLegCenter + rzLeg - fzLeg;
    const lBLx = fxLegCenter - rxLeg - fxLeg, lBLz = fzLegCenter - rzLeg - fzLeg;
    // Front leg face
    this._writeQuadRaw(
      lFLx, cy, lFLz,
      lFRx, cy, lFRz,
      lFRx, panBotY, lFRz,
      lFLx, panBotY, lFLz,
      fx, 0.1, fz,
      0.14, 0.17, 0.22, legA
    );
    // Back leg face
    this._writeQuadRaw(
      lBRx, cy, lBRz,
      lBLx, cy, lBLz,
      lBLx, panBotY, lBLz,
      lBRx, panBotY, lBRz,
      -fx, 0.0, -fz,
      0.12, 0.15, 0.20, legA
    );
    // Left leg face
    this._writeQuadRaw(
      lBLx, cy, lBLz,
      lFLx, cy, lFLz,
      lFLx, panBotY, lFLz,
      lBLx, panBotY, lBLz,
      -rx, 0.0, -rz,
      0.13, 0.16, 0.21, legA
    );
    // Right leg face
    this._writeQuadRaw(
      lFRx, cy, lFRz,
      lBRx, cy, lBRz,
      lBRx, panBotY, lBRz,
      lFRx, panBotY, lFRz,
      rx, 0.0, rz,
      0.13, 0.16, 0.21, legA
    );

    // 2. Contoured seat pan top with AO crease gradient
    const rxhw = rx * hw, rzhw = rz * hw;
    const fxhd = fx * hd, fzhd = fz * hd;
    const pFLx = cx - rxhw + fxhd, pFLz = cz - rzhw + fzhd;
    const pFRx = cx + rxhw + fxhd, pFRz = cz + rzhw + fzhd;
    const pBRx = cx + rxhw - fxhd * 0.72, pBRz = cz + rzhw - fzhd * 0.72;
    const pBLx = cx - rxhw - fxhd * 0.72, pBLz = cz - rzhw - fzhd * 0.72;
    const shellThick = 0.048;
    const fxSh = fx * shellThick, fzSh = fz * shellThick;
    const rBLx = pBLx - fxSh, rBLz = pBLz - fzSh;
    const rBRx = pBRx - fxSh, rBRz = pBRz - fzSh;

    this._writeVCQuadRaw(
      pBLx, panBackY, pBLz, panCreaseR, panCreaseG, panCreaseB, pA,
      pFLx, panFrontY, pFLz, panLightR, panLightG, panLightB, pA,
      pFRx, panFrontY, pFRz, panLightR, panLightG, panLightB, pA,
      pBRx, panBackY, pBRz, panCreaseR, panCreaseG, panCreaseB, pA,
      0, 1, 0
    );

    // 2b. Seat pan bottom shell layer (座垫底面直接连到靠背背面底边 rBL/rBR 闭合)
    this._writeQuadRaw(
      pFLx, panBotY, pFLz,
      rBLx, panBotY, rBLz,
      rBRx, panBotY, rBRz,
      pFRx, panBotY, pFRz,
      0, -1, 0,
      panUnderR, panUnderG, panUnderB, pA
    );

    // 3. Front bullnose cushion thickness face
    this._writeQuadRaw(
      pFLx, panBotY, pFLz,
      pFRx, panBotY, pFRz,
      pFRx, panFrontY, pFRz,
      pFLx, panFrontY, pFLz,
      fx, -0.15, fz,
      panLipR, panLipG, panLipB, pA
    );

    // 3b. Left & Right seat pan side thickness faces
    this._writeQuadRaw(
      pBLx, panBotY, pBLz,
      pFLx, panBotY, pFLz,
      pFLx, panFrontY, pFLz,
      pBLx, panBackY, pBLz,
      -rx, 0, -rz,
      panLipR, panLipG, panLipB, pA
    );
    this._writeQuadRaw(
      pFRx, panBotY, pFRz,
      pBRx, panBotY, pBRz,
      pBRx, panBackY, pBRz,
      pFRx, panFrontY, pFRz,
      rx, 0, rz,
      panLipR, panLipG, panLipB, pA
    );

    // 4. Tapered ergonomic backrest front cushion
    const rxTop = rx * topHw, rzTop = rz * topHw;
    const bTLx = cx - rxTop - fxhd * 0.88, bTLz = cz - rzTop - fzhd * 0.88;
    const bTRx = cx + rxTop - fxhd * 0.88, bTRz = cz + rzTop - fzhd * 0.88;
    this._writeVCQuadRaw(
      pBLx, panBackY, pBLz, backCreaseR, backCreaseG, backCreaseB, bA,
      pBRx, panBackY, pBRz, backCreaseR, backCreaseG, backCreaseB, bA,
      bTRx, backTopY, bTRz, backShR, backShG, backShB, bA,
      bTLx, backTopY, bTLz, backShR, backShG, backShB, bA,
      fx * 0.55, 0.82, fz * 0.55
    );

    // 5. Top backrest crest rim & dark molded rear polymer shell + side caps
    const rTLx = bTLx - fxSh, rTLy = backTopY - 0.01, rTLz = bTLz - fzSh;
    const rTRx = bTRx - fxSh, rTRy = backTopY - 0.01, rTRz = bTRz - fzSh;

    this._writeQuadRaw(
      bTLx, backTopY, bTLz,
      bTRx, backTopY, bTRz,
      rTRx, rTRy, rTRz,
      rTLx, rTLy, rTLz,
      0, 1, 0,
      crestR, crestG, crestB, bA
    );
    this._writeQuadRaw(
      rBRx, panBotY, rBRz,
      rBLx, panBotY, rBLz,
      rTLx, rTLy, rTLz,
      rTRx, rTRy, rTRz,
      -fx * 0.94, 0.25, -fz * 0.94,
      rearR, rearG, rearB, bA
    );
    // Backrest left side thickness face
    this._writeQuadRaw(
      rBLx, panBotY, rBLz,
      pBLx, panBackY, pBLz,
      bTLx, backTopY, bTLz,
      rTLx, rTLy, rTLz,
      -rx, 0, -rz,
      rearR, rearG, rearB, bA
    );
    // Backrest right side thickness face
    this._writeQuadRaw(
      pBRx, panBackY, pBRz,
      rBRx, panBotY, rBRz,
      rTRx, rTRy, rTRz,
      bTRx, backTopY, bTRz,
      rx, 0, rz,
      rearR, rearG, rearB, bA
    );
  }

  static createSeatPrototype() {
    const proto = new MeshBuilder(96);
    proto._writeSeat3D(0, 0, 0, 1.0, 1.0, 0, 1, [1, 1, 1, 1.0], [1, 1, 1, 2.0], true);
    return proto;
  }

  /**
   * Adds a plush architectural VIP executive leather armchair with thick cushion,
   * tall winged backrest, champagne-gold headrest piping, and dual upholstered armrests.
   */
  addVipSeat3D(cx, cy, cz, seatWidth, seatDepth, fx, fz, panColor, backColor) {
    const rx = -fz;
    const rz = fx;
    const rotY = Math.atan2(fx, fz);
    const armW = Math.min(0.11, seatWidth * 0.16);
    const innerW = Math.max(0.32, seatWidth - armW * 2.1);
    const armOffset = innerW * 0.5 + armW * 0.45;
    const armColor = [
      Math.max(0.05, backColor[0] * 0.72),
      Math.max(0.05, backColor[1] * 0.72),
      Math.max(0.05, backColor[2] * 0.72),
      1.0
    ];
    const goldPiping = [0.90, 0.75, 0.40, 1.0];

    // Dark-bronze pedestal base + floor plate
    this.addBox(cx, cy + 0.03, cz, innerW * 0.64, 0.06, seatDepth * 0.56, [0.12, 0.11, 0.10, 1.0], rotY);
    this.addBox(cx, cy + 0.15, cz, innerW * 0.52, 0.22, seatDepth * 0.48, [0.18, 0.15, 0.13, 1.0], rotY);
    // Thick plush contoured leather cushion
    this.addBox(cx + fx * 0.04, cy + 0.34, cz + fz * 0.04, innerW, 0.16, seatDepth * 0.88, panColor, rotY);
    // Tall executive backrest
    this.addBox(cx - fx * (seatDepth * 0.36), cy + 0.66, cz - fz * (seatDepth * 0.36), innerW * 1.02, 0.56, 0.14, backColor, rotY);
    // Champagne-gold headrest accent bar
    this.addBox(cx - fx * (seatDepth * 0.35), cy + 0.96, cz - fz * (seatDepth * 0.35), innerW * 0.88, 0.06, 0.15, goldPiping, rotY);
    // Dual upholstered armrests with subtle top cap
    this.addBox(cx - rx * armOffset - fx * 0.02, cy + 0.47, cz - rz * armOffset - fz * 0.02, armW, 0.26, seatDepth * 0.84, armColor, rotY);
    this.addBox(cx + rx * armOffset - fx * 0.02, cy + 0.47, cz + rz * armOffset - fz * 0.02, armW, 0.26, seatDepth * 0.84, armColor, rotY);
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

  /**
   * Adds an architectural multi-part railing run between (pA, yA) and (pB, yB):
   * dark gunmetal/bronze stanchion posts with base anchor shoes, sleek brushed-metal
   * ergonomic top cap, slim mid-rail, and optional tempered glass infill.
   */
  addTexturedRailingRun(pA, yA, pB, yB, height, opts, alpha) {
    const o = opts || {};
    const capCol = o.capColor || [0.78, 0.82, 0.88, 1.0];
    const postCol = o.postColor || [0.24, 0.28, 0.35, 1.0];
    const midCol = o.midColor || [0.58, 0.63, 0.70, 1.0];
    const glassCol = o.glassColor || [0.56, 0.78, 0.92, 0.22];
    const postSpacing = o.postSpacing || 2.4;
    const includeStartPost = o.includeStartPost !== false;
    const includeEndPost = o.includeEndPost !== false;
    const showMidRail = o.showMidRail !== false;
    const showGlass = !!o.showGlass && !!alpha;

    const span = Math.hypot(pB.x - pA.x, pB.z - pA.z);
    if (span < 0.05) return;

    // Ergonomic wide-profile brushed top handrail cap
    this.addBeam3D(
      { x: pA.x, y: yA + height, z: pA.z },
      { x: pB.x, y: yB + height, z: pB.z },
      o.capWidth || 0.095,
      o.capHeight || 0.05,
      capCol
    );

    // Slim secondary mid-rail at ~52% height
    if (showMidRail) {
      const midFrac = 0.52;
      this.addBeam3D(
        { x: pA.x, y: yA + height * midFrac, z: pA.z },
        { x: pB.x, y: yB + height * midFrac, z: pB.z },
        0.042,
        0.042,
        midCol
      );
    }

    // Tempered glass infill panel (from slim shoe channel up to top rail)
    if (showGlass) {
      const botOff = 0.06;
      const topOff = height - 0.03;
      alpha.addQuad(
        { x: pA.x, y: yA + botOff, z: pA.z },
        { x: pA.x, y: yA + topOff, z: pA.z },
        { x: pB.x, y: yB + topOff, z: pB.z },
        { x: pB.x, y: yB + botOff, z: pB.z },
        glassCol
      );
    }

    // Gunmetal stanchion posts with base anchor flanges
    const segments = Math.max(1, Math.ceil(span / postSpacing));
    for (let i = 0; i <= segments; i++) {
      if (i === 0 && !includeStartPost) continue;
      if (i === segments && !includeEndPost) continue;
      const f = i / segments;
      const px = pA.x + (pB.x - pA.x) * f;
      const py = yA + (yB - yA) * f;
      const pz = pA.z + (pB.z - pA.z) * f;
      this.addBox(px, py + height * 0.5, pz, 0.065, height, 0.065, postCol, 0);
      this.addBox(px, py + 0.025, pz, 0.12, 0.05, 0.12, postCol, 0);
    }
  }
}

module.exports = { MeshBuilder };

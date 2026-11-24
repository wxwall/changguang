/**
 * 3D Mesh Builder for Dynamic Geometry Generation
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

  addTri(p1, p2, p3, color, customNormal) {
    this.addTriangle(p1, p2, p3, color, customNormal);
  }

  addQuad(p1, p2, p3, p4, color, customNormal) {
    this.addTriangle(p1, p2, p3, color, customNormal);
    this.addTriangle(p1, p3, p4, color, customNormal);
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
    this.positions.push(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z, p3.x, p3.y, p3.z);
    this.normals.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
    this.colors.push(
      c1[0], c1[1], c1[2], c1[3] !== undefined ? c1[3] : 1.0,
      c2[0], c2[1], c2[2], c2[3] !== undefined ? c2[3] : 1.0,
      c3[0], c3[1], c3[2], c3[3] !== undefined ? c3[3] : 1.0
    );
  }

  addVertexColoredQuad(p1, c1, p2, c2, p3, c3, p4, c4, customNormal) {
    this.addVertexColoredTriangle(p1, c1, p2, c2, p3, c3, customNormal);
    this.addVertexColoredTriangle(p1, c1, p3, c3, p4, c4, customNormal);
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
      Math.max(0.05, backColor[0] * 0.78),
      Math.max(0.05, backColor[1] * 0.78),
      Math.max(0.05, backColor[2] * 0.78),
      1.0
    ];
    const goldPiping = [0.88, 0.72, 0.38, 1.0];

    // Dark-bronze pedestal base
    this.addBox(cx, cy + 0.14, cz, innerW * 0.76, 0.28, seatDepth * 0.68, [0.16, 0.14, 0.13, 1.0], rotY);
    // Thick plush contoured leather cushion
    this.addBox(cx + fx * 0.04, cy + 0.34, cz + fz * 0.04, innerW, 0.16, seatDepth * 0.88, panColor, rotY);
    // Tall executive backrest
    this.addBox(cx - fx * (seatDepth * 0.36), cy + 0.66, cz - fz * (seatDepth * 0.36), innerW * 1.02, 0.56, 0.14, backColor, rotY);
    // Champagne-gold headrest accent bar
    this.addBox(cx - fx * (seatDepth * 0.35), cy + 0.96, cz - fz * (seatDepth * 0.35), innerW * 0.88, 0.06, 0.15, goldPiping, rotY);
    // Dual upholstered armrests (left & right)
    this.addBox(cx - rx * armOffset - fx * 0.02, cy + 0.48, cz - rz * armOffset - fz * 0.02, armW, 0.28, seatDepth * 0.84, armColor, rotY);
    this.addBox(cx + rx * armOffset - fx * 0.02, cy + 0.48, cz + rz * armOffset - fz * 0.02, armW, 0.28, seatDepth * 0.84, armColor, rotY);
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

module.exports = { MeshBuilder };

/**
 * Floating Island Scene (悬浮石头地台场景)
 *
 * Requirements:
 * - Backdrop: Warm cream #f6eee3, center brighter #fefaf2, soft warm yellow gradient
 * - Platform: Irregular rounded-corner rock platform, floating in mid-air
 * - Ratio: Overall Width : Depth ≈ 10 : 8.8
 * - Top: Natural flat yellow-green meadow (#a6d672 to #b6de7c)
 * - Meadow Edge: Short grass tufts, moss patches, and tiny wild flowers
 * - Rock Cliff: Irregular brownish-gray cliff facets, top light, bottom dark
 * - Rock Features: Horizontal strata layers, cleft cracks, bumpy crags, embedded pebbles
 * - Bottom: Rock narrows downward into a floating suspended mountain keel
 * - Drop Shadow: Soft translucent ambient shadow underneath
 * - Clouds: Flat fluffy white clouds floating outside platform, drifting & bobbing
 * - Fairy Sparkles: Small golden glowing light specks floating around platform
 * - Viewport: Entire platform stays completely visible in bird's eye view
 */

const { BaseScene } = require('./base-scene');

class FloatingIslandScene extends BaseScene {
  constructor() {
    super('floating-island', '悬浮仙境石头地台');

    // Cached animation state
    this.cloudInstances = [
      { baseRadius: 180 * 1.35, angle: 0.35, speed: 0.024, baseY: 8, bobSpeed: 0.65, bobAmp: 2.2, phase: 0.0, scale: 1.15 },
      { baseRadius: 180 * 1.50, angle: 1.45, speed: 0.018, baseY: -6, bobSpeed: 0.55, bobAmp: 2.8, phase: 1.2, scale: 0.95 },
      { baseRadius: 180 * 1.38, angle: 2.50, speed: 0.022, baseY: 12, bobSpeed: 0.70, bobAmp: 2.0, phase: 2.4, scale: 1.10 },
      { baseRadius: 180 * 1.55, angle: 3.65, speed: 0.016, baseY: -12, bobSpeed: 0.48, bobAmp: 3.0, phase: 3.8, scale: 1.25 },
      { baseRadius: 180 * 1.42, angle: 4.75, speed: 0.020, baseY: 4, bobSpeed: 0.60, bobAmp: 2.4, phase: 4.9, scale: 1.00 },
      { baseRadius: 180 * 1.48, angle: 5.65, speed: 0.025, baseY: -4, bobSpeed: 0.72, bobAmp: 2.5, phase: 5.7, scale: 1.05 }
    ];
    this.particleInstances = [];

    // Vertex offsets for dynamic buffers
    this.cloudVertexStart = 0;
    this.cloudVertexCount = 0;
    this.particleVertexStart = 0;
    this.particleVertexCount = 0;

    // Buffer references
    this.cloudBasePositions = null;
    this.particleBasePositions = null;
    this.dynamicSolidPosArray = null;
    this.dynamicScreenPosArray = null;
  }

  /**
   * Calculates platform dimensions based on venue bounding box.
   * Ensures ratio W : D is strictly 10 : 8.8, and platform stays inside NDC view.
   */
  computeDimensions(venueBounds) {
    const rx = (venueBounds && venueBounds.radiusX) || 60;
    const rz = (venueBounds && venueBounds.radiusZ) || 70;

    // Platform must be larger than stadium, preserving 10 : 8.8 ratio
    // Depth = Width * 0.88. To satisfy depth > rz + margin, width >= (rz + margin) / 0.88
    const marginZ = Math.max(3.5, rz * 0.025);
    const marginX = Math.max(10, rx * 0.10);

    let halfWidth = Math.max(
      rx + marginX,
      (rz + marginZ) / 0.88,
      90
    );

    // Keep halfWidth bounded to ensure entire platform remains within screen NDC (< 0.96) across all pitches
    halfWidth = Math.min(188, Math.max(90, halfWidth));
    const halfDepth = halfWidth * 0.88;

    // Mountain rock vertical height: proportional to halfWidth
    const rockHeight = Math.max(28, Math.min(52, halfWidth * 0.26));

    return {
      halfWidth,
      halfDepth,
      width: halfWidth * 2,
      depth: halfDepth * 2,
      topY: -0.60,
      bottomY: -0.60 - rockHeight,
      rockHeight,
      ratio: halfWidth / halfDepth // strictly 10 / 8.8 = 1.13636
    };
  }

  getClearColor() {
    // Warm cream #f6eee3
    return [0.9647, 0.9333, 0.8902, 1.0];
  }

  /**
   * Superellipse rounded rectangle radius with organic rock perturbation
   */
  getPerimeterRadius(angleRad, halfWidth, halfDepth) {
    const cosA = Math.cos(angleRad);
    const sinA = Math.sin(angleRad);

    // Superellipse exponent n = 3.2 gives a graceful rounded rectangle
    const n = 3.2;
    const cosPow = Math.sign(cosA) * Math.pow(Math.abs(cosA), 2 / n);
    const sinPow = Math.sign(sinA) * Math.pow(Math.abs(sinA), 2 / n);

    const x0 = halfWidth * cosPow;
    const z0 = halfDepth * sinPow;
    const baseR = Math.hypot(x0, z0);

    // Multi-frequency harmonic perturbation for natural, craggy rock silhouette
    const pert = 1.0 +
      0.038 * Math.cos(3 * angleRad + 0.45) +
      0.028 * Math.sin(5 * angleRad - 0.65) +
      0.018 * Math.cos(7 * angleRad + 1.82);

    return {
      x: x0 * pert,
      z: z0 * pert,
      r: baseR * pert,
      baseX: x0,
      baseZ: z0
    };
  }

  buildMeshes(builders, venueBounds, options) {
    const { solid, screens, alpha } = builders;
    if (!solid) return;

    const dims = this.computeDimensions(venueBounds);
    const { halfWidth, halfDepth, topY, bottomY, rockHeight } = dims;

    // 1. Warm cream sky backdrop with soft radial sunbeam gradient (#fefaf2 -> #fff5dc -> #f6eee3)
    if (screens) {
      this.buildWarmSkyBackdrop(screens, halfWidth);
    }

    // 2. Soft ambient drop shadow underneath suspended mountain
    if (alpha) {
      this.buildDropShadow(alpha, halfWidth, halfDepth, bottomY);
    }

    // 3. Top yellow-green grass meadow (#a6d672 to #b6de7c)
    this.buildGrassMeadow(solid, halfWidth, halfDepth, topY);

    // 4. Meadow edge details: short grass tufts, moss patches, and tiny wild flowers
    this.buildMeadowEdgeDetails(solid, screens, halfWidth, halfDepth, topY);

    // 5. Rock cliff sides: strata layers, cracks, bumps, pebbles & downward tapering mountain keel
    this.buildRockCliffAndKeel(solid, halfWidth, halfDepth, topY, bottomY, rockHeight);

    // 6. Fluffy white clouds floating outside the platform
    this.buildFluffyClouds(solid, halfWidth, halfDepth, topY);

    // 7. Golden fairy particles floating around the scene
    if (screens) {
      this.buildGoldenParticles(screens, halfWidth, halfDepth, topY);
    }
  }

  /**
   * 1. Warm cream sky backdrop dome with gentle warm yellow light gradient
   */
  buildWarmSkyBackdrop(screens, halfWidth) {
    const domeR = 640;
    const segments = 32;
    const rings = 14;

    // Colors:
    // Center / zenith: #fefaf2 (254, 250, 242)
    const colZenith = [0.9961, 0.9804, 0.9490, 1.0];
    // Gentle warm yellow glow: #fff5dc (255, 245, 220)
    const colWarmGlow = [1.0, 0.9608, 0.8627, 1.0];
    // Horizon / edge / lower skirt: #f6eee3 (246, 238, 227)
    const colBase = [0.9647, 0.9333, 0.8902, 1.0];

    for (let r = 0; r < rings; r++) {
      const phi1 = (r / rings) * (Math.PI * 0.78);
      const phi2 = ((r + 1) / rings) * (Math.PI * 0.78);

      const t1 = r / rings;
      const t2 = (r + 1) / rings;

      const c1 = this.interpolateSkyColor(colZenith, colWarmGlow, colBase, t1);
      const c2 = this.interpolateSkyColor(colZenith, colWarmGlow, colBase, t2);

      const y1 = Math.cos(phi1) * domeR;
      const rad1 = Math.sin(phi1) * domeR;
      const y2 = Math.cos(phi2) * domeR;
      const rad2 = Math.sin(phi2) * domeR;

      for (let s = 0; s < segments; s++) {
        const a1 = (s / segments) * Math.PI * 2;
        const a2 = ((s + 1) / segments) * Math.PI * 2;

        const p11 = { x: Math.cos(a1) * rad1, y: y1 - 80, z: Math.sin(a1) * rad1 };
        const p12 = { x: Math.cos(a2) * rad1, y: y1 - 80, z: Math.sin(a2) * rad1 };
        const p21 = { x: Math.cos(a1) * rad2, y: y2 - 80, z: Math.sin(a1) * rad2 };
        const p22 = { x: Math.cos(a2) * rad2, y: y2 - 80, z: Math.sin(a2) * rad2 };

        // Facing inward
        screens.addTriangle(p11, p21, p12, c1);
        screens.addTriangle(p12, p21, p22, c2);
      }
    }
  }

  interpolateSkyColor(zenith, glow, base, t) {
    if (t < 0.35) {
      const u = t / 0.35;
      return [
        zenith[0] * (1 - u) + glow[0] * u,
        zenith[1] * (1 - u) + glow[1] * u,
        zenith[2] * (1 - u) + glow[2] * u,
        1.0
      ];
    }
    if (t < 0.75) {
      const u = (t - 0.35) / 0.40;
      return [
        glow[0] * (1 - u) + base[0] * u,
        glow[1] * (1 - u) + base[1] * u,
        glow[2] * (1 - u) + base[2] * u,
        1.0
      ];
    }
    return [base[0], base[1], base[2], 1.0];
  }

  /**
   * 2. Soft ambient drop shadow underneath suspended mountain
   */
  buildDropShadow(alpha, halfWidth, halfDepth, bottomY) {
    const shadowY = bottomY - 10;
    const shadowR_X = halfWidth * 0.72;
    const shadowR_Z = halfDepth * 0.72;
    const rings = 4;
    const segments = 40;

    // Ambient shadow color: dark warm brown fading out
    const shadowCenter = [0.18, 0.15, 0.13, 0.28];
    const shadowRim = [0.18, 0.15, 0.13, 0.0];

    for (let r = 0; r < rings; r++) {
      const frac1 = r / rings;
      const frac2 = (r + 1) / rings;
      const alpha1 = shadowCenter[3] * (1.0 - Math.pow(frac1, 1.4));
      const alpha2 = shadowCenter[3] * (1.0 - Math.pow(frac2, 1.4));

      const col1 = [shadowCenter[0], shadowCenter[1], shadowCenter[2], alpha1];
      const col2 = [shadowCenter[0], shadowCenter[1], shadowCenter[2], alpha2];

      for (let s = 0; s < segments; s++) {
        const a1 = (s / segments) * Math.PI * 2;
        const a2 = ((s + 1) / segments) * Math.PI * 2;

        const x11 = Math.cos(a1) * shadowR_X * frac1;
        const z11 = Math.sin(a1) * shadowR_Z * frac1;
        const x12 = Math.cos(a2) * shadowR_X * frac1;
        const z12 = Math.sin(a2) * shadowR_Z * frac1;

        const x21 = Math.cos(a1) * shadowR_X * frac2;
        const z21 = Math.sin(a1) * shadowR_Z * frac2;
        const x22 = Math.cos(a2) * shadowR_X * frac2;
        const z22 = Math.sin(a2) * shadowR_Z * frac2;

        alpha.addQuad(
          { x: x11, y: shadowY, z: z11 },
          { x: x12, y: shadowY, z: z12 },
          { x: x22, y: shadowY, z: z22 },
          { x: x21, y: shadowY, z: z21 },
          col1,
          { x: 0, y: 1, z: 0 }
        );
      }
    }
  }

  /**
   * 3. Top flat yellow-green meadow: #a6d672 to #b6de7c
   */
  buildGrassMeadow(solid, halfWidth, halfDepth, topY) {
    const rings = 6;
    const sectors = 72;

    // Grass colors:
    // #a6d672: [166/255, 214/255, 114/255] = [0.651, 0.839, 0.447]
    const grassColA = [0.651, 0.839, 0.447, 1.0];
    // #b6de7c: [182/255, 222/255, 124/255] = [0.714, 0.871, 0.486]
    const grassColB = [0.714, 0.871, 0.486, 1.0];

    const upNormal = { x: 0, y: 1, z: 0 };

    for (let r = 0; r < rings; r++) {
      const frac1 = r / rings;
      const frac2 = (r + 1) / rings;

      for (let s = 0; s < sectors; s++) {
        const a1 = (s / sectors) * Math.PI * 2;
        const a2 = ((s + 1) / sectors) * Math.PI * 2;

        const pA1 = this.getPerimeterRadius(a1, halfWidth, halfDepth);
        const pA2 = this.getPerimeterRadius(a2, halfWidth, halfDepth);

        const pt11 = { x: pA1.x * frac1, y: topY, z: pA1.z * frac1 };
        const pt12 = { x: pA2.x * frac1, y: topY, z: pA2.z * frac1 };
        const pt21 = { x: pA1.x * frac2, y: topY, z: pA1.z * frac2 };
        const pt22 = { x: pA2.x * frac2, y: topY, z: pA2.z * frac2 };

        // Subtle organic color modulation between #a6d672 and #b6de7c
        const noise1 = 0.5 + 0.35 * Math.sin(3 * a1 + frac1 * 4) + 0.15 * Math.cos(5 * a1);
        const noise2 = 0.5 + 0.35 * Math.sin(3 * a2 + frac2 * 4) + 0.15 * Math.cos(5 * a2);
        const t1 = Math.max(0, Math.min(1, noise1));
        const t2 = Math.max(0, Math.min(1, noise2));

        const c1 = [
          grassColA[0] * (1 - t1) + grassColB[0] * t1,
          grassColA[1] * (1 - t1) + grassColB[1] * t1,
          grassColA[2] * (1 - t1) + grassColB[2] * t1,
          1.0
        ];
        const c2 = [
          grassColA[0] * (1 - t2) + grassColB[0] * t2,
          grassColA[1] * (1 - t2) + grassColB[1] * t2,
          grassColA[2] * (1 - t2) + grassColB[2] * t2,
          1.0
        ];

        if (r === 0) {
          // Center fan
          solid.addTriangle(pt11, pt22, pt21, c1, upNormal);
        } else {
          solid.addQuad(pt11, pt12, pt22, pt21, c1, upNormal);
        }
      }
    }
  }

  /**
   * 4. Meadow Edge Details: short grass blades, moss cushions, and tiny wild flowers
   */
  buildMeadowEdgeDetails(solid, screens, halfWidth, halfDepth, topY) {
    const numPoints = 64;

    // Colors:
    const mossCol = [0.302, 0.486, 0.059, 1.0]; // Deep velvet moss #4d7c0f
    const shortGrassCol = [0.518, 0.800, 0.086, 1.0]; // Fresh blade green #84cc16
    const flowerColors = [
      [1.0, 1.0, 1.0, 1.0], // White daisy #ffffff
      [0.992, 0.878, 0.278, 1.0], // Buttercup yellow #fde047
      [0.957, 0.447, 0.714, 1.0] // Pastel pink #f472b6
    ];

    for (let i = 0; i < numPoints; i++) {
      const angle = (i / numPoints) * Math.PI * 2;
      const p = this.getPerimeterRadius(angle, halfWidth, halfDepth);
      const dirX = p.x / (p.r || 1);
      const dirZ = p.z / (p.r || 1);

      // (a) Moss cushions on the edge lip
      if (i % 2 === 0) {
        const mossRadius = 1.2 + 0.8 * Math.sin(i * 3.5);
        const mossX = p.x - dirX * 0.8;
        const mossZ = p.z - dirZ * 0.8;
        solid.addBox(mossX, topY + 0.15, mossZ, mossRadius * 1.5, 0.35, mossRadius * 1.5, mossCol);
      }

      // (b) Short grass tufts
      if (i % 3 === 0) {
        const bladeH = 0.8 + 0.5 * Math.sin(i * 4.2);
        const bladeW = 0.5;
        const bX = p.x - dirX * 0.4;
        const bZ = p.z - dirZ * 0.4;

        // Small upright grass triangle
        const v1 = { x: bX - dirZ * bladeW, y: topY, z: bZ + dirX * bladeW };
        const v2 = { x: bX + dirZ * bladeW, y: topY, z: bZ - dirX * bladeW };
        const v3 = { x: bX + dirX * 0.3, y: topY + bladeH, z: bZ + dirZ * 0.3 };
        solid.addTriangle(v1, v2, v3, shortGrassCol);
      }

      // (c) Tiny wild flowers scattered around the edge
      if (i % 4 === 1 && screens) {
        const fCol = flowerColors[i % flowerColors.length];
        const fRadius = 0.75;
        const fX = p.x - dirX * (1.2 + (i % 3) * 0.9);
        const fZ = p.z - dirZ * (1.2 + (i % 3) * 0.9);
        const fY = topY + 0.25;

        // 4-petal flower head
        screens.addQuad(
          { x: fX - fRadius, y: fY, z: fZ },
          { x: fX, y: fY, z: fZ - fRadius },
          { x: fX + fRadius, y: fY, z: fZ },
          { x: fX, y: fY, z: fZ + fRadius },
          fCol,
          { x: 0, y: 1, z: 0 }
        );
      }
    }
  }

  /**
   * 5. Rock Cliff Sides: Brownish-gray facets (light top, dark bottom),
   * strata bands, cleft cracks, craggy bumps, embedded pebbles, and narrowing keel
   */
  buildRockCliffAndKeel(solid, halfWidth, halfDepth, topY, bottomY, rockHeight) {
    const strataCount = 7;
    const sectors = 64;

    // Rock colors:
    // Top light brownish-gray: #8c7d70
    const rockColTop = [0.549, 0.490, 0.439, 1.0];
    // Bottom deep brownish-gray: #342a24
    const rockColBottom = [0.204, 0.165, 0.141, 1.0];

    // Build strata vertices grid
    const strataGrid = [];

    for (let layer = 0; layer <= strataCount; layer++) {
      const vFrac = layer / strataCount;
      // Strata step elevation
      const curY = topY - rockHeight * Math.pow(vFrac, 1.15);

      // Downward narrowing scale factor (keel shape: wide top, tapered bottom)
      // At top: 1.0, at bottom: 0.10
      const keelScale = 1.0 - 0.90 * Math.pow(vFrac, 1.35);

      // Horizontal strata ledge step
      const strataLedge = 1.0 + 0.038 * Math.sin(layer * 2.85);

      const ring = [];
      for (let s = 0; s < sectors; s++) {
        const angle = (s / sectors) * Math.PI * 2;
        const baseP = this.getPerimeterRadius(angle, halfWidth, halfDepth);

        // Craggy bump perturbation per vertex
        const bump = 1.0 +
          0.045 * Math.cos(layer * 1.6 + angle * 7) +
          0.025 * Math.sin(layer * 3.2 - angle * 11);

        // Cracks / cleft fissures along 3 angular fault lines
        let crackOffset = 0;
        const crackAngles = [0.82, 2.65, 4.90];
        for (let k = 0; k < crackAngles.length; k++) {
          const diff = Math.abs(angle - crackAngles[k]);
          const dAngle = Math.min(diff, Math.PI * 2 - diff);
          if (dAngle < 0.22) {
            crackOffset -= 0.08 * (1.0 - dAngle / 0.22);
          }
        }

        const scaleTotal = keelScale * strataLedge * bump * (1.0 + crackOffset);
        const vx = baseP.x * scaleTotal;
        const vz = baseP.z * scaleTotal;
        const vy = curY + (layer > 0 && layer < strataCount ? 0.35 * Math.sin(layer * 2 + angle * 5) : 0);

        // Strata band color: alternating lighter and darker sediment layers
        const bandMod = (layer % 2 === 0 ? 1.06 : 0.94);
        const col = [
          Math.min(1.0, (rockColTop[0] * (1 - vFrac) + rockColBottom[0] * vFrac) * bandMod),
          Math.min(1.0, (rockColTop[1] * (1 - vFrac) + rockColBottom[1] * vFrac) * bandMod),
          Math.min(1.0, (rockColTop[2] * (1 - vFrac) + rockColBottom[2] * vFrac) * bandMod),
          1.0
        ];

        ring.push({ x: vx, y: vy, z: vz, col });
      }
      strataGrid.push(ring);
    }

    // Connect strata grid into faceted rock quads
    for (let layer = 0; layer < strataCount; layer++) {
      const r1 = strataGrid[layer];
      const r2 = strataGrid[layer + 1];

      for (let s = 0; s < sectors; s++) {
        const nextS = (s + 1) % sectors;
        const p11 = r1[s];
        const p12 = r1[nextS];
        const p21 = r2[s];
        const p22 = r2[nextS];

        // Faceted cliff normals
        solid.addQuad(
          { x: p11.x, y: p11.y, z: p11.z },
          { x: p12.x, y: p12.y, z: p12.z },
          { x: p22.x, y: p22.y, z: p22.z },
          { x: p21.x, y: p21.y, z: p21.z },
          p11.col
        );
      }
    }

    // Close bottom tip apex
    const apexY = bottomY - 2.5;
    const apexPt = { x: 0, y: apexY, z: 0 };
    const lastRing = strataGrid[strataCount];
    const apexCol = rockColBottom;

    for (let s = 0; s < sectors; s++) {
      const nextS = (s + 1) % sectors;
      solid.addTriangle(
        { x: lastRing[s].x, y: lastRing[s].y, z: lastRing[s].z },
        { x: lastRing[nextS].x, y: lastRing[nextS].y, z: lastRing[nextS].z },
        apexPt,
        apexCol
      );
    }

    // Embedded small pebbles & rock boulders jutting out from cliff ledges
    this.buildEmbeddedPebbles(solid, strataGrid, halfWidth);
  }

  /**
   * Embedded small pebbles / boulders on rock cliff ledges
   */
  buildEmbeddedPebbles(solid, strataGrid, halfWidth) {
    const pebbleCount = 18;
    const pebbleCol = [0.42, 0.36, 0.32, 1.0];

    for (let i = 0; i < pebbleCount; i++) {
      const layer = 1 + (i % 4);
      const sector = (i * 7 + 3) % strataGrid[layer].length;
      const pt = strataGrid[layer][sector];

      const size = 1.6 + 0.8 * Math.sin(i * 2.1);
      solid.addBox(
        pt.x * 1.02,
        pt.y + 0.2,
        pt.z * 1.02,
        size,
        size * 0.7,
        size,
        pebbleCol,
        (i * 35 * Math.PI) / 180
      );
    }
  }

  /**
   * 6. Fluffy White Clouds floating outside the platform
   */
  buildFluffyClouds(solid, halfWidth, halfDepth, topY) {
    this.cloudInstances = [
      { baseRadius: halfWidth * 1.35, angle: 0.35, speed: 0.024, baseY: topY + 8, bobSpeed: 0.65, bobAmp: 2.2, phase: 0.0, scale: 1.15 },
      { baseRadius: halfWidth * 1.50, angle: 1.45, speed: 0.018, baseY: topY - 6, bobSpeed: 0.55, bobAmp: 2.8, phase: 1.2, scale: 0.95 },
      { baseRadius: halfWidth * 1.38, angle: 2.50, speed: 0.022, baseY: topY + 12, bobSpeed: 0.70, bobAmp: 2.0, phase: 2.4, scale: 1.10 },
      { baseRadius: halfWidth * 1.55, angle: 3.65, speed: 0.016, baseY: topY - 12, bobSpeed: 0.48, bobAmp: 3.0, phase: 3.8, scale: 1.25 },
      { baseRadius: halfWidth * 1.42, angle: 4.75, speed: 0.020, baseY: topY + 4, bobSpeed: 0.60, bobAmp: 2.4, phase: 4.9, scale: 1.00 },
      { baseRadius: halfWidth * 1.48, angle: 5.65, speed: 0.025, baseY: topY - 4, bobSpeed: 0.72, bobAmp: 2.5, phase: 5.7, scale: 1.05 }
    ];

    const cloudTopCol = [1.0, 1.0, 1.0, 1.0]; // Pure white
    const cloudBotCol = [0.957, 0.965, 0.980, 1.0]; // Soft gentle sky tint

    this.cloudVertexStart = solid.positions.length / 3;

    // Sub-puffs relative offsets and radii for a flat, fluffy cumulus shape
    const puffDefs = [
      { dx: 0, dy: 0, dz: 0, rx: 14, ry: 4.2, rz: 11 },
      { dx: -10, dy: -0.6, dz: -3, rx: 9, ry: 3.2, rz: 8 },
      { dx: 11, dy: -0.4, dz: 2, rx: 10, ry: 3.5, rz: 9 },
      { dx: -4, dy: 0.8, dz: 7, rx: 8.5, ry: 3.0, rz: 7.5 },
      { dx: 5, dy: 0.5, dz: -6, rx: 8, ry: 2.8, rz: 7 }
    ];

    for (let c = 0; c < this.cloudInstances.length; c++) {
      const inst = this.cloudInstances[c];
      const cx = Math.cos(inst.angle) * inst.baseRadius;
      const cz = Math.sin(inst.angle) * inst.baseRadius * 0.88;
      const cy = inst.baseY;

      inst.initialX = cx;
      inst.initialY = cy;
      inst.initialZ = cz;
      inst.vertexStart = solid.positions.length / 3;

      for (let p = 0; p < puffDefs.length; p++) {
        const puff = puffDefs[p];
        const px = cx + puff.dx * inst.scale;
        const py = cy + puff.dy * inst.scale;
        const pz = cz + puff.dz * inst.scale;
        const rx = puff.rx * inst.scale;
        const ry = puff.ry * inst.scale;
        const rz = puff.rz * inst.scale;

        this.addFlattenedPuff(solid, px, py, pz, rx, ry, rz, cloudTopCol, cloudBotCol);
      }
      inst.vertexCount = solid.positions.length / 3 - inst.vertexStart;
    }

    this.cloudVertexCount = solid.positions.length / 3 - this.cloudVertexStart;

    // Allocate & initialize base positions buffer and dynamic positions for WebGL bufferSubData
    const cloudFloats = this.cloudVertexCount * 3;
    this.cloudBasePositions = new Float32Array(cloudFloats);
    this.dynamicCloudPositions = new Float32Array(cloudFloats);
    const startIdx = this.cloudVertexStart * 3;
    for (let i = 0; i < cloudFloats; i++) {
      this.cloudBasePositions[i] = solid.positions[startIdx + i];
      this.dynamicCloudPositions[i] = solid.positions[startIdx + i];
    }
  }

  /**
   * Generates a flat fluffy low-poly ellipsoid puff
   */
  addFlattenedPuff(solid, cx, cy, cz, rx, ry, rz, topCol, botCol) {
    const latBands = 5;
    const lonBands = 8;

    for (let lat = 0; lat < latBands; lat++) {
      const theta1 = (lat / latBands) * Math.PI;
      const theta2 = ((lat + 1) / latBands) * Math.PI;

      const sinT1 = Math.sin(theta1);
      const cosT1 = Math.cos(theta1);
      const sinT2 = Math.sin(theta2);
      const cosT2 = Math.cos(theta2);

      const col1 = cosT1 > 0 ? topCol : botCol;
      const col2 = cosT2 > 0 ? topCol : botCol;

      for (let lon = 0; lon < lonBands; lon++) {
        const phi1 = (lon / lonBands) * Math.PI * 2;
        const phi2 = ((lon + 1) / lonBands) * Math.PI * 2;

        const sinP1 = Math.sin(phi1);
        const cosP1 = Math.cos(phi1);
        const sinP2 = Math.sin(phi2);
        const cosP2 = Math.cos(phi2);

        const v1 = { x: cx + rx * sinT1 * cosP1, y: cy + ry * cosT1, z: cz + rz * sinT1 * sinP1 };
        const v2 = { x: cx + rx * sinT1 * cosP2, y: cy + ry * cosT1, z: cz + rz * sinT1 * sinP2 };
        const v3 = { x: cx + rx * sinT2 * cosP2, y: cy + ry * cosT2, z: cz + rz * sinT2 * sinP2 };
        const v4 = { x: cx + rx * sinT2 * cosP1, y: cy + ry * cosT2, z: cz + rz * sinT2 * sinP1 };

        solid.addQuad(v1, v2, v3, v4, col1);
      }
    }
  }

  /**
   * 7. Golden fairy particles floating around the scene
   */
  buildGoldenParticles(screens, halfWidth, halfDepth, topY) {
    const particleCount = 36;
    this.particleInstances = [];

    // Glowing warm gold color #fde047
    const goldCol = [0.992, 0.878, 0.278, 0.90];

    this.particleVertexStart = screens.positions.length / 3;

    for (let i = 0; i < particleCount; i++) {
      const angle = (i / particleCount) * Math.PI * 2 + (i % 5) * 0.4;
      const rDist = (0.25 + 0.90 * ((i * 13) % 100) / 100);
      const px = Math.cos(angle) * halfWidth * rDist;
      const pz = Math.sin(angle) * halfDepth * rDist;
      const py = topY + 2.0 + (((i * 17) % 100) / 100) * 24.0;

      const pSize = 0.65 + 0.45 * Math.sin(i * 1.7);
      const pStartV = screens.positions.length / 3;

      // Small glowing diamond quad
      screens.addQuad(
        { x: px - pSize, y: py, z: pz },
        { x: px, y: py + pSize, z: pz },
        { x: px + pSize, y: py, z: pz },
        { x: px, y: py - pSize, z: pz },
        goldCol
      );

      this.particleInstances.push({
        initialX: px,
        initialY: py,
        initialZ: pz,
        vertexStart: pStartV,
        vertexCount: screens.positions.length / 3 - pStartV,
        size: pSize,
        floatSpeed: 0.35 + 0.25 * ((i % 7) / 7),
        swaySpeed: 0.8 + 0.4 * ((i % 5) / 5),
        phase: i * 0.72
      });
    }

    this.particleVertexCount = screens.positions.length / 3 - this.particleVertexStart;

    // Allocate & initialize base positions buffer and dynamic positions for WebGL bufferSubData
    const partFloats = this.particleVertexCount * 3;
    this.particleBasePositions = new Float32Array(partFloats);
    this.dynamicParticlePositions = new Float32Array(partFloats);
    const startPartIdx = this.particleVertexStart * 3;
    for (let i = 0; i < partFloats; i++) {
      this.particleBasePositions[i] = screens.positions[startPartIdx + i];
      this.dynamicParticlePositions[i] = screens.positions[startPartIdx + i];
    }
  }

  /**
   * Frame-by-frame animation update for clouds drifting/bobbing and particles floating.
   * Performs real WebGL bufferSubData updates if WebGL context and buffers are provided.
   */
  update(elapsedSec, deltaSec, gl, buffers) {
    // 1. Dynamic clouds orbital drift & vertical bobbing
    if (this.cloudInstances && this.cloudInstances.length > 0) {
      for (let c = 0; c < this.cloudInstances.length; c++) {
        const cloud = this.cloudInstances[c];
        cloud.currentAngle = cloud.angle + cloud.speed * elapsedSec;
        cloud.currentY = cloud.baseY + Math.sin(elapsedSec * cloud.bobSpeed + cloud.phase) * cloud.bobAmp;
        cloud.currentX = Math.cos(cloud.currentAngle) * cloud.baseRadius;
        cloud.currentZ = Math.sin(cloud.currentAngle) * cloud.baseRadius * 0.88;

        if (this.cloudBasePositions && this.dynamicCloudPositions && cloud.initialX !== undefined) {
          const dx = cloud.currentX - cloud.initialX;
          const dy = cloud.currentY - cloud.initialY;
          const dz = cloud.currentZ - cloud.initialZ;

          const relStart = (cloud.vertexStart - this.cloudVertexStart) * 3;
          const relEnd = relStart + cloud.vertexCount * 3;
          for (let i = relStart; i < relEnd; i += 3) {
            this.dynamicCloudPositions[i] = this.cloudBasePositions[i] + dx;
            this.dynamicCloudPositions[i + 1] = this.cloudBasePositions[i + 1] + dy;
            this.dynamicCloudPositions[i + 2] = this.cloudBasePositions[i + 2] + dz;
          }
        }
      }

      if (gl && buffers && buffers.solidBuffers && buffers.solidBuffers.posBuf && typeof gl.bufferSubData === 'function' && this.dynamicCloudPositions) {
        gl.bindBuffer(gl.ARRAY_BUFFER, buffers.solidBuffers.posBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, this.cloudVertexStart * 3 * 4, this.dynamicCloudPositions);
      }
    }

    // 2. Dynamic fairy golden sparkles gentle upward floating & swaying
    if (this.particleInstances && this.particleInstances.length > 0) {
      const floatRangeY = 24.0;
      for (let p = 0; p < this.particleInstances.length; p++) {
        const part = this.particleInstances[p];
        const dy = ((elapsedSec * part.floatSpeed + part.phase * 3.0) % floatRangeY);
        const dx = Math.sin(elapsedSec * part.swaySpeed + part.phase) * 1.8;
        const dz = Math.cos(elapsedSec * part.swaySpeed + part.phase) * 1.8;

        if (this.particleBasePositions && this.dynamicParticlePositions) {
          const relStart = (part.vertexStart - this.particleVertexStart) * 3;
          const relEnd = relStart + part.vertexCount * 3;
          for (let i = relStart; i < relEnd; i += 3) {
            this.dynamicParticlePositions[i] = this.particleBasePositions[i] + dx;
            this.dynamicParticlePositions[i + 1] = this.particleBasePositions[i + 1] + dy;
            this.dynamicParticlePositions[i + 2] = this.particleBasePositions[i + 2] + dz;
          }
        }
      }

      if (gl && buffers && buffers.screenBuffers && buffers.screenBuffers.posBuf && typeof gl.bufferSubData === 'function' && this.dynamicParticlePositions) {
        gl.bindBuffer(gl.ARRAY_BUFFER, buffers.screenBuffers.posBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, this.particleVertexStart * 3 * 4, this.dynamicParticlePositions);
      }
    }
  }

  /**
   * Camera recommendation for bird's eye view
   */
  getCameraConfig(venueBounds) {
    const dims = this.computeDimensions(venueBounds);
    return {
      recommendedOrbitDist: 460, // locked to 460 for minimum form compatibility
      targetLook: { x: 0, y: 6, z: 0 },
      bounds: dims
    };
  }
}

module.exports = {
  FloatingIslandScene
};

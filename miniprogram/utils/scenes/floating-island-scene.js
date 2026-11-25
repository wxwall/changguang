/**
 * Floating Island Scene (悬浮仙境体育场馆岛屿场景)
 *
 * Inspired by miniature fairy-tale diorama floating islands:
 * - Backdrop: Sunlit warm cream zenith (#fefaf2) -> golden sunbeam -> misty woodland green horizon -> turquoise river below
 * - Platform: Irregular rounded-corner rock island, Ratio W : D = 10 : 8.8
 * - Turf Cap: Thick, plush overhanging yellow-green meadow (#9fd35a to #b8e372) with rounded mossy lip
 * - Rock Cliff: Chunky sculpted boulder underside with strata layers, crevices, and embedded pebbles
 * - Waterfall: Crystal-turquoise stream winding across the meadow edge and cascading down the front cliff with foam & mist
 * - Diorama Props: Miniature pine & blossom trees, flowering bushes, cobblestone path, warm glowing lanterns, bench & bunny
 * - Clouds & Sparkles: Dynamic drifting/bobbing fluffy white clouds and floating golden fairy particles
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
    this.dynamicCloudPositions = null;
    this.dynamicParticlePositions = null;

    // Signature front-facing waterfall angle (matches default bird-eye camera azimuth)
    this.waterfallAngle = 1.15;
  }

  /**
   * Calculates platform dimensions based on venue bounding box.
   * Ensures ratio W : D is strictly 10 : 8.8, and platform stays inside NDC view.
   */
  computeDimensions(venueBounds) {
    const rx = (venueBounds && venueBounds.radiusX) || 60;
    const rz = (venueBounds && venueBounds.radiusZ) || 70;

    // Platform must be larger than stadium, preserving 10 : 8.8 ratio
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

  /**
   * Approximate stadium outer radius at a given polar angle for safe prop placement
   */
  getStadiumOuterRadiusAtAngle(angleRad, venueBounds) {
    const rx = (venueBounds && venueBounds.radiusX) || 60;
    const rz = (venueBounds && venueBounds.radiusZ) || 70;
    const cosA = Math.cos(angleRad);
    const sinA = Math.sin(angleRad);
    const denom = Math.hypot(cosA / rx, sinA / rz) || 1;
    return 1.0 / denom;
  }

  /**
   * Shortest angular distance between two angles in radians
   */
  angleDiff(a, b) {
    let d = (a - b) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return Math.abs(d);
  }

  buildMeshes(builders, venueBounds, options) {
    const { solid, screens, alpha } = builders;
    if (!solid) return;

    const dims = this.computeDimensions(venueBounds);
    const { halfWidth, halfDepth, topY, bottomY, rockHeight } = dims;

    // 1. Sunlit woodland & misty river sky backdrop
    if (screens) {
      this.buildWarmSkyBackdrop(screens, halfWidth);
    }

    // 2. Soft ambient drop shadow & shimmering turquoise river reflection underneath
    if (alpha) {
      this.buildDropShadow(alpha, halfWidth, halfDepth, bottomY);
    }

    // 3. Thick, sculpted overhanging yellow-green grass meadow cap
    this.buildGrassMeadow(solid, halfWidth, halfDepth, topY);

    // 4. Chunky sculpted rock cliff sides & rounded boulder keel
    this.buildRockCliffAndKeel(solid, halfWidth, halfDepth, topY, bottomY, rockHeight);

    // 5. Signature cascading turquoise waterfall & mossy stream channel
    this.buildWaterfallAndStream(solid, screens, alpha, venueBounds, halfWidth, halfDepth, topY, bottomY);

    // 6. Lush miniature diorama props around the stadium (trees, bushes, flowers, path, lanterns, bench, bunny)
    this.buildMeadowDioramaProps(solid, screens, venueBounds, halfWidth, halfDepth, topY);

    // 7. Fluffy white clouds floating outside the platform (contiguous dynamic range in solid)
    this.buildFluffyClouds(solid, halfWidth, halfDepth, topY);

    // 8. Golden fairy particles floating around the scene (contiguous dynamic range in screens)
    if (screens) {
      this.buildGoldenParticles(screens, halfWidth, halfDepth, topY);
    }
  }

  /**
   * 1. Sunlit forest & misty river sky backdrop dome
   */
  buildWarmSkyBackdrop(screens, halfWidth) {
    // domeR = 480 centered at origin: strictly > max orbitDist (460) so camera is always inside,
    // and 460 + 480 = 940 < farPlane (950) so the back wall is never clipped.
    const domeR = 480;
    const segments = 36;
    const rings = 18;

    const colZenith = [0.9961, 0.9804, 0.9490, 1.0];   // #fefaf2 warm sunlit cream
    const colWarmGlow = [1.0, 0.9569, 0.8314, 1.0];    // #fff4d4 golden sunbeam
    const colForestTop = [0.8275, 0.8941, 0.7373, 1.0]; // #d3e4bc sunlit misty foliage
    const colForestMid = [0.6627, 0.7922, 0.5608, 1.0]; // #a9ca8f soft woodland green
    const colRiver = [0.4784, 0.7529, 0.7882, 1.0];    // #7ac0c9 misty turquoise river

    const evalDomeColor = (t, angle) => {
      let base;
      if (t < 0.25) {
        const u = t / 0.25;
        base = [
          colZenith[0] * (1 - u) + colWarmGlow[0] * u,
          colZenith[1] * (1 - u) + colWarmGlow[1] * u,
          colZenith[2] * (1 - u) + colWarmGlow[2] * u
        ];
      } else if (t < 0.48) {
        const u = (t - 0.25) / 0.23;
        base = [
          colWarmGlow[0] * (1 - u) + colForestTop[0] * u,
          colWarmGlow[1] * (1 - u) + colForestTop[1] * u,
          colWarmGlow[2] * (1 - u) + colForestTop[2] * u
        ];
      } else if (t < 0.66) {
        const u = (t - 0.48) / 0.18;
        base = [
          colForestTop[0] * (1 - u) + colForestMid[0] * u,
          colForestTop[1] * (1 - u) + colForestMid[1] * u,
          colForestTop[2] * (1 - u) + colForestMid[2] * u
        ];
      } else {
        const u = Math.min(1, (t - 0.66) / 0.34);
        base = [
          colForestMid[0] * (1 - u) + colRiver[0] * u,
          colForestMid[1] * (1 - u) + colRiver[1] * u,
          colForestMid[2] * (1 - u) + colRiver[2] * u
        ];
      }

      // Subtle bokeh tree-canopy & sunbeam vertical modulation near the forest horizon band
      if (t > 0.35 && t < 0.75) {
        const bandWeight = Math.sin(((t - 0.35) / 0.40) * Math.PI);
        const foliageWave = 0.045 * Math.sin(angle * 7 + 0.5) + 0.03 * Math.cos(angle * 13 - 1.1);
        const mod = 1.0 + foliageWave * bandWeight;
        return [
          Math.min(1.0, Math.max(0.0, base[0] * mod)),
          Math.min(1.0, Math.max(0.0, base[1] * mod)),
          Math.min(1.0, Math.max(0.0, base[2] * mod)),
          1.0
        ];
      }
      return [base[0], base[1], base[2], 1.0];
    };

    for (let r = 0; r < rings; r++) {
      const phi1 = (r / rings) * Math.PI;
      const phi2 = ((r + 1) / rings) * Math.PI;

      const t1 = r / rings;
      const t2 = (r + 1) / rings;

      const y1 = Math.cos(phi1) * domeR;
      const rad1 = Math.sin(phi1) * domeR;
      const y2 = Math.cos(phi2) * domeR;
      const rad2 = Math.sin(phi2) * domeR;

      for (let s = 0; s < segments; s++) {
        const a1 = (s / segments) * Math.PI * 2;
        const a2 = ((s + 1) / segments) * Math.PI * 2;

        const p11 = { x: Math.cos(a1) * rad1, y: y1, z: Math.sin(a1) * rad1 };
        const p12 = { x: Math.cos(a2) * rad1, y: y1, z: Math.sin(a2) * rad1 };
        const p21 = { x: Math.cos(a1) * rad2, y: y2, z: Math.sin(a1) * rad2 };
        const p22 = { x: Math.cos(a2) * rad2, y: y2, z: Math.sin(a2) * rad2 };

        const c11 = evalDomeColor(t1, a1);
        const c12 = evalDomeColor(t1, a2);
        const c21 = evalDomeColor(t2, a1);
        const c22 = evalDomeColor(t2, a2);

        // Facing inward
        screens.addVertexColoredTriangle(p11, c11, p21, c21, p12, c12);
        screens.addVertexColoredTriangle(p12, c12, p21, c21, p22, c22);
      }
    }
  }

  /**
   * 2. Soft ambient drop shadow & shimmering turquoise river reflection underneath
   */
  buildDropShadow(alpha, halfWidth, halfDepth, bottomY) {
    const shadowY = bottomY - 10;
    const shadowR_X = halfWidth * 0.72;
    const shadowR_Z = halfDepth * 0.72;
    const rings = 4;
    const segments = 40;

    const shadowCenter = [0.16, 0.14, 0.12, 0.26];

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

        const p11 = { x: Math.cos(a1) * shadowR_X * frac1, y: shadowY, z: Math.sin(a1) * shadowR_Z * frac1 };
        const p12 = { x: Math.cos(a2) * shadowR_X * frac1, y: shadowY, z: Math.sin(a2) * shadowR_Z * frac1 };
        const p21 = { x: Math.cos(a1) * shadowR_X * frac2, y: shadowY, z: Math.sin(a1) * shadowR_Z * frac2 };
        const p22 = { x: Math.cos(a2) * shadowR_X * frac2, y: shadowY, z: Math.sin(a2) * shadowR_Z * frac2 };

        alpha.addVertexColoredQuad(p11, col1, p12, col1, p22, col2, p21, col2, { x: 0, y: 1, z: 0 });
      }
    }

    // Soft turquoise river pool ripple slightly below the drop shadow
    const riverY = bottomY - 13.5;
    const riverR_X = halfWidth * 0.92;
    const riverR_Z = halfDepth * 0.92;
    const riverColInner = [0.36, 0.74, 0.80, 0.24];
    const riverColOuter = [0.46, 0.78, 0.82, 0.0];

    for (let r = 0; r < 3; r++) {
      const f1 = r / 3;
      const f2 = (r + 1) / 3;
      const c1 = [riverColInner[0], riverColInner[1], riverColInner[2], riverColInner[3] * (1 - f1)];
      const c2 = [riverColOuter[0], riverColOuter[1], riverColOuter[2], riverColInner[3] * (1 - f2)];

      for (let s = 0; s < 36; s++) {
        const a1 = (s / 36) * Math.PI * 2;
        const a2 = ((s + 1) / 36) * Math.PI * 2;
        const p11 = { x: Math.cos(a1) * riverR_X * f1, y: riverY, z: Math.sin(a1) * riverR_Z * f1 };
        const p12 = { x: Math.cos(a2) * riverR_X * f1, y: riverY, z: Math.sin(a2) * riverR_Z * f1 };
        const p21 = { x: Math.cos(a1) * riverR_X * f2, y: riverY, z: Math.sin(a1) * riverR_Z * f2 };
        const p22 = { x: Math.cos(a2) * riverR_X * f2, y: riverY, z: Math.sin(a2) * riverR_Z * f2 };
        alpha.addVertexColoredQuad(p11, c1, p12, c1, p22, c2, p21, c2, { x: 0, y: 1, z: 0 });
      }
    }
  }

  /**
   * 3. Thick, plush overhanging yellow-green meadow cap (#9fd35a to #b8e372)
   */
  buildGrassMeadow(solid, halfWidth, halfDepth, topY) {
    const rings = 6;
    const sectors = 72;

    const grassColA = [0.624, 0.827, 0.353, 1.0]; // #9fd35a sunlit meadow green
    const grassColB = [0.722, 0.890, 0.447, 1.0]; // #b8e372 warm yellow-green
    const lipMidCol = [0.447, 0.690, 0.220, 1.0]; // #72b038 lush grass lip
    const lipBotCol = [0.294, 0.478, 0.133, 1.0]; // #4b7a22 deep velvet moss underside

    const upNormal = { x: 0, y: 1, z: 0 };

    const getMeadowColor = (a, frac) => {
      const noise = 0.5 + 0.35 * Math.sin(3 * a + frac * 4) + 0.15 * Math.cos(5 * a);
      const t = Math.max(0, Math.min(1, noise));
      return [
        grassColA[0] * (1 - t) + grassColB[0] * t,
        grassColA[1] * (1 - t) + grassColB[1] * t,
        grassColA[2] * (1 - t) + grassColB[2] * t,
        1.0
      ];
    };

    // Flat top meadow surface at y = topY (-0.60)
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

        const c11 = getMeadowColor(a1, frac1);
        const c12 = getMeadowColor(a2, frac1);
        const c21 = getMeadowColor(a1, frac2);
        const c22 = getMeadowColor(a2, frac2);

        if (r === 0) {
          solid.addVertexColoredTriangle(pt11, c11, pt22, c22, pt21, c21, upNormal);
        } else {
          solid.addVertexColoredQuad(pt11, c11, pt12, c12, pt22, c22, pt21, c21, upNormal);
        }
      }
    }

    // Thick overhanging rounded turf lip draping over the rock rim
    const lipProfiles = [
      { scale: 1.000, dy: 0.0, col: null },
      { scale: 1.030, dy: -0.85, col: lipMidCol },
      { scale: 1.018, dy: -2.05, col: lipMidCol },
      { scale: 0.972, dy: -2.95, col: lipBotCol }
    ];

    for (let l = 0; l < lipProfiles.length - 1; l++) {
      const prof1 = lipProfiles[l];
      const prof2 = lipProfiles[l + 1];

      for (let s = 0; s < sectors; s++) {
        const a1 = (s / sectors) * Math.PI * 2;
        const a2 = ((s + 1) / sectors) * Math.PI * 2;

        const pA1 = this.getPerimeterRadius(a1, halfWidth, halfDepth);
        const pA2 = this.getPerimeterRadius(a2, halfWidth, halfDepth);

        // Slight organic undulation on the overhanging grass lip
        const wave1 = 0.25 * Math.sin(a1 * 12) + 0.15 * Math.cos(a1 * 19);
        const wave2 = 0.25 * Math.sin(a2 * 12) + 0.15 * Math.cos(a2 * 19);

        const dy1 = l === 0 ? 0 : prof1.dy + wave1;
        const dy2 = prof2.dy + wave2;

        const pt11 = { x: pA1.x * prof1.scale, y: topY + dy1, z: pA1.z * prof1.scale };
        const pt12 = { x: pA2.x * prof1.scale, y: topY + (l === 0 ? 0 : prof1.dy + wave2), z: pA2.z * prof1.scale };
        const pt21 = { x: pA1.x * prof2.scale, y: topY + dy2, z: pA1.z * prof2.scale };
        const pt22 = { x: pA2.x * prof2.scale, y: topY + dy2, z: pA2.z * prof2.scale };

        const c11 = prof1.col || getMeadowColor(a1, 1.0);
        const c12 = prof1.col || getMeadowColor(a2, 1.0);
        const c2 = prof2.col;

        solid.addVertexColoredQuad(pt11, c11, pt12, c12, pt22, c2, pt21, c2);
      }
    }
  }

  /**
   * 4. Chunky Rock Cliff Sides & Rounded Boulder Keel
   */
  buildRockCliffAndKeel(solid, halfWidth, halfDepth, topY, bottomY, rockHeight) {
    const strataCount = 8;
    const sectors = 64;

    const rockStartTopY = topY - 2.65; // Tucked neatly under overhanging turf lip
    const effectiveRockH = rockStartTopY - bottomY;

    // Warm-to-cool stone colors matching reference diorama
    const rockColTop = [0.620, 0.584, 0.545, 1.0];    // #9e958b sunlit warm stone
    const rockColMid = [0.482, 0.459, 0.431, 1.0];    // #7b756e neutral boulder gray
    const rockColBottom = [0.275, 0.263, 0.255, 1.0]; // #464341 deep underside shadow

    const strataGrid = [];

    for (let layer = 0; layer <= strataCount; layer++) {
      const vFrac = layer / strataCount;
      const curY = rockStartTopY - effectiveRockH * Math.pow(vFrac, 1.08);

      // Chunky rounded-bowl boulder profile (stays full in upper/mid body, curves inward near bottom)
      const dome = Math.sqrt(Math.max(0.02, 1.0 - Math.pow(vFrac, 1.85)));
      const keelScale = 0.975 * (0.20 + 0.80 * dome);

      const strataLedge = 1.0 + 0.036 * Math.sin(layer * 2.75);

      const ring = [];
      for (let s = 0; s < sectors; s++) {
        const angle = (s / sectors) * Math.PI * 2;
        const baseP = this.getPerimeterRadius(angle, halfWidth, halfDepth);

        const bump = 1.0 +
          0.048 * Math.cos(layer * 1.5 + angle * 7) +
          0.028 * Math.sin(layer * 3.1 - angle * 11);

        // Natural cleft fissures & gentle waterfall chute recess
        let crackOffset = 0;
        const crackAngles = [0.68, 2.52, 4.75];
        for (let k = 0; k < crackAngles.length; k++) {
          const dAngle = this.angleDiff(angle, crackAngles[k]);
          if (dAngle < 0.22) {
            crackOffset -= 0.085 * (1.0 - dAngle / 0.22);
          }
        }
        const wfDiff = this.angleDiff(angle, this.waterfallAngle);
        if (wfDiff < 0.12) {
          crackOffset -= 0.065 * (1.0 - wfDiff / 0.12);
        }

        const scaleTotal = keelScale * strataLedge * bump * (1.0 + crackOffset);
        const vx = baseP.x * scaleTotal;
        const vz = baseP.z * scaleTotal;
        const vy = curY + (layer > 0 && layer < strataCount ? 0.45 * Math.sin(layer * 2.2 + angle * 5) : 0);

        const bandMod = (layer % 2 === 0 ? 1.05 : 0.94);
        let baseCol;
        if (vFrac < 0.45) {
          const u = vFrac / 0.45;
          baseCol = [
            rockColTop[0] * (1 - u) + rockColMid[0] * u,
            rockColTop[1] * (1 - u) + rockColMid[1] * u,
            rockColTop[2] * (1 - u) + rockColMid[2] * u
          ];
        } else {
          const u = (vFrac - 0.45) / 0.55;
          baseCol = [
            rockColMid[0] * (1 - u) + rockColBottom[0] * u,
            rockColMid[1] * (1 - u) + rockColBottom[1] * u,
            rockColMid[2] * (1 - u) + rockColBottom[2] * u
          ];
        }

        const col = [
          Math.min(1.0, baseCol[0] * bandMod),
          Math.min(1.0, baseCol[1] * bandMod),
          Math.min(1.0, baseCol[2] * bandMod),
          1.0
        ];

        ring.push({ x: vx, y: vy, z: vz, col });
      }
      strataGrid.push(ring);
    }

    // Connect strata grid into sculpted rock quads
    for (let layer = 0; layer < strataCount; layer++) {
      const r1 = strataGrid[layer];
      const r2 = strataGrid[layer + 1];

      for (let s = 0; s < sectors; s++) {
        const nextS = (s + 1) % sectors;
        const p11 = r1[s];
        const p12 = r1[nextS];
        const p21 = r2[s];
        const p22 = r2[nextS];

        solid.addVertexColoredQuad(
          { x: p11.x, y: p11.y, z: p11.z }, p11.col,
          { x: p12.x, y: p12.y, z: p12.z }, p12.col,
          { x: p22.x, y: p22.y, z: p22.z }, p22.col,
          { x: p21.x, y: p21.y, z: p21.z }, p21.col
        );
      }
    }

    // Close bottom craggy keel apex
    const apexY = bottomY - 2.2;
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

    // Embedded boulders on rock cliff ledges
    this.buildEmbeddedPebbles(solid, strataGrid, halfWidth);
  }

  /**
   * Embedded rock boulders & pebbles on cliff ledges
   */
  buildEmbeddedPebbles(solid, strataGrid, halfWidth) {
    const pebbleCount = 22;
    const pebbleTopCol = [0.54, 0.51, 0.48, 1.0];
    const pebbleBotCol = [0.38, 0.35, 0.33, 1.0];
    const sectors = strataGrid[0].length;

    for (let i = 0; i < pebbleCount; i++) {
      const layer = 1 + (i % 5);
      const sector = (i * 7 + 3) % sectors;
      const angle = (sector / sectors) * Math.PI * 2;
      if (this.angleDiff(angle, this.waterfallAngle) < 0.15) continue;

      const pt = strataGrid[layer][sector];
      const rx = 1.6 + 0.7 * Math.sin(i * 2.1);
      const ry = rx * 0.65;
      this.addFlattenedPuff(solid, pt.x * 1.01, pt.y + 0.15, pt.z * 1.01, rx, ry, rx, pebbleTopCol, pebbleBotCol);
    }
  }

  /**
   * 5. Signature Cascading Waterfall & Meadow Stream Channel
   */
  buildWaterfallAndStream(solid, screens, alpha, venueBounds, halfWidth, halfDepth, topY, bottomY) {
    const wfAngle = this.waterfallAngle;
    const pCenter = this.getPerimeterRadius(wfAngle, halfWidth, halfDepth);
    const stadiumR = this.getStadiumOuterRadiusAtAngle(wfAngle, venueBounds);

    const dirX = pCenter.x / (pCenter.r || 1);
    const dirZ = pCenter.z / (pCenter.r || 1);
    const tanX = -dirZ;
    const tanZ = dirX;

    const halfStreamW = Math.max(4.5, Math.min(7.5, halfWidth * 0.048));
    const waterTopCol = [0.341, 0.788, 0.878, 1.0];  // #57c9e0 bright turquoise
    const waterMidCol = [0.251, 0.690, 0.808, 1.0];  // #40b0ce deeper cascade blue
    const foamCol = [0.910, 0.984, 1.0, 1.0];        // #e8fbff white-aqua foam
    const bankStoneCol = [0.58, 0.55, 0.51, 1.0];

    // (a) Meadow stream channel leading to the waterfall lip
    const streamStartR = Math.max(stadiumR + 2.5, pCenter.r * 0.80);
    const streamEndR = pCenter.r * 1.036;
    const streamSegs = 5;

    for (let i = 0; i < streamSegs; i++) {
      const f1 = i / streamSegs;
      const f2 = (i + 1) / streamSegs;
      const r1 = streamStartR + (streamEndR - streamStartR) * f1;
      const r2 = streamStartR + (streamEndR - streamStartR) * f2;
      const w1 = halfStreamW * (0.75 + 0.25 * f1);
      const w2 = halfStreamW * (0.75 + 0.25 * f2);

      const y1 = topY + 0.14;
      const y2 = topY + (i === streamSegs - 1 ? 0.08 : 0.14);

      const p1L = { x: dirX * r1 - tanX * w1, y: y1, z: dirZ * r1 - tanZ * w1 };
      const p1R = { x: dirX * r1 + tanX * w1, y: y1, z: dirZ * r1 + tanZ * w1 };
      const p2L = { x: dirX * r2 - tanX * w2, y: y2, z: dirZ * r2 - tanZ * w2 };
      const p2R = { x: dirX * r2 + tanX * w2, y: y2, z: dirZ * r2 + tanZ * w2 };

      solid.addQuad(p1L, p1R, p2R, p2L, waterTopCol, { x: 0, y: 1, z: 0 });

      // Smooth river stones bordering both banks
      if (i % 2 === 0 && i < streamSegs - 1) {
        solid.addBox(dirX * r1 - tanX * (w1 + 0.9), topY + 0.35, dirZ * r1 - tanZ * (w1 + 0.9), 1.6, 0.8, 1.6, bankStoneCol, i * 0.6);
        solid.addBox(dirX * r1 + tanX * (w1 + 0.9), topY + 0.35, dirZ * r1 + tanZ * (w1 + 0.9), 1.6, 0.8, 1.6, bankStoneCol, i * 0.9);
      }
    }

    // (b) Cascading waterfall curtain curving over the overhanging grass lip & down the cliff
    const fallSteps = 9;
    const fallBottomY = bottomY + 3.0;

    let prevL = null;
    let prevR = null;
    let prevCol = null;
    let prevY = 0;
    let prevRad = 0;

    for (let step = 0; step <= fallSteps; step++) {
      let curY, curR, curW, curCol;

      if (step === 0) {
        curY = topY + 0.08;
        curR = pCenter.r * 1.036;
        curW = halfStreamW;
        curCol = foamCol;
      } else if (step === 1) {
        // Arc cleanly outside the 1.030x overhanging grass lip
        curY = topY - 0.85;
        curR = pCenter.r * 1.046;
        curW = halfStreamW * 0.98;
        curCol = waterTopCol;
      } else {
        const clampedFrac = (step - 1) / (fallSteps - 1);
        curY = (topY - 0.85) - ((topY - 0.85) - fallBottomY) * Math.pow(clampedFrac, 1.05);

        const dome = Math.sqrt(Math.max(0.02, 1.0 - Math.pow(clampedFrac, 1.85)));
        const keelScale = 1.02 * (0.24 + 0.76 * dome);
        const arcOut = 2.8 * Math.sin(clampedFrac * Math.PI * 0.82) + 1.8;
        curR = pCenter.r * Math.max(0.32, keelScale) + arcOut;
        curW = halfStreamW * (1.0 - 0.25 * clampedFrac);
        curCol = step === 2 ? waterTopCol : waterMidCol;
      }

      const curL = { x: dirX * curR - tanX * curW, y: curY, z: dirZ * curR - tanZ * curW };
      const curR_pt = { x: dirX * curR + tanX * curW, y: curY, z: dirZ * curR + tanZ * curW };

      if (prevL && prevR) {
        solid.addVertexColoredQuad(prevL, prevCol, prevR, prevCol, curR_pt, curCol, curL, curCol);

        // White foam streaks aligned along the sloped waterfall segment on unlit screens buffer
        if (screens && step >= 1 && step <= fallSteps - 1) {
          const streakOffset = (step % 2 === 0 ? -0.32 : 0.28) * curW;
          const sW = 0.44;
          const rTop = prevRad + 0.30;
          const rBot = curR + 0.30;
          const sp1 = { x: dirX * rTop + tanX * (streakOffset - sW), y: prevY, z: dirZ * rTop + tanZ * (streakOffset - sW) };
          const sp2 = { x: dirX * rTop + tanX * (streakOffset + sW), y: prevY, z: dirZ * rTop + tanZ * (streakOffset + sW) };
          const sp3 = { x: dirX * rBot + tanX * (streakOffset + sW), y: curY, z: dirZ * rBot + tanZ * (streakOffset + sW) };
          const sp4 = { x: dirX * rBot + tanX * (streakOffset - sW), y: curY, z: dirZ * rBot + tanZ * (streakOffset - sW) };
          screens.addQuad(sp1, sp2, sp3, sp4, foamCol);
        }
      }

      prevL = curL;
      prevR = curR_pt;
      prevCol = curCol;
      prevY = curY;
      prevRad = curR;
    }

    // (c) Misty foam cloud puffs at the base of the waterfall + tiny falling droplet below keel
    if (alpha) {
      const mistR = pCenter.r * 0.44 + 2.0;
      const mistX = dirX * mistR;
      const mistZ = dirZ * mistR;
      const mistCol = [0.92, 0.98, 1.0, 0.55];
      this.addFlattenedPuff(alpha, mistX, fallBottomY, mistZ, halfStreamW * 1.1, 2.2, halfStreamW * 0.9, mistCol, mistCol);
    }

    // Tiny falling water droplet & delicate thread below the bottom tip (signature detail from reference image)
    const dropCol = [0.45, 0.82, 0.90, 1.0];
    const dropTopCol = [0.75, 0.94, 0.98, 1.0];
    solid.addBox(dirX * 3.0, bottomY - 3.6, dirZ * 3.0, 0.16, 2.4, 0.16, dropTopCol);
    this.addFlattenedPuff(solid, dirX * 3.0, bottomY - 5.6, dirZ * 3.0, 0.55, 0.85, 0.55, dropTopCol, dropCol);
  }

  /**
   * 6. Lush Miniature Diorama Props Around the Stadium
   * (Moss cushions, wildflowers, cobblestone pathway, miniature pine & blossom trees, warm lanterns, bench & bunny)
   */
  buildMeadowDioramaProps(solid, screens, venueBounds, halfWidth, halfDepth, topY) {
    const mossCol = [0.302, 0.486, 0.059, 1.0];       // #4d7c0f velvet moss
    const shortGrassCol = [0.518, 0.800, 0.086, 1.0]; // #84cc16 fresh blade green
    const flowerColors = [
      [1.0, 1.0, 1.0, 1.0],       // White daisy
      [0.992, 0.878, 0.278, 1.0], // Buttercup yellow
      [0.957, 0.447, 0.714, 1.0]  // Pastel pink
    ];

    // (a) Dense Meadow Edge Moss Cushions, Grass Tufts & Wildflowers
    const numEdge = 72;
    for (let i = 0; i < numEdge; i++) {
      const angle = (i / numEdge) * Math.PI * 2;
      // Keep the waterfall channel and bank stones clear
      if (this.angleDiff(angle, this.waterfallAngle) < 0.13) continue;

      const p = this.getPerimeterRadius(angle, halfWidth, halfDepth);
      const dirX = p.x / (p.r || 1);
      const dirZ = p.z / (p.r || 1);

      // Rounded moss & shrub cushions on the meadow lip
      if (i % 2 === 0) {
        const bushR = 1.4 + 0.9 * Math.abs(Math.sin(i * 2.7));
        const bx = p.x - dirX * 1.1;
        const bz = p.z - dirZ * 1.1;
        this.addFlattenedPuff(solid, bx, topY + 0.35, bz, bushR * 1.2, bushR * 0.55, bushR * 1.2, mossCol, mossCol);
      }

      // Upright grass tufts
      if (i % 3 === 0) {
        const bladeH = 1.1 + 0.6 * Math.sin(i * 4.2);
        const bladeW = 0.65;
        const bX = p.x - dirX * 0.5;
        const bZ = p.z - dirZ * 0.5;
        const v1 = { x: bX - dirZ * bladeW, y: topY, z: bZ + dirX * bladeW };
        const v2 = { x: bX + dirZ * bladeW, y: topY, z: bZ - dirX * bladeW };
        const v3 = { x: bX + dirX * 0.4, y: topY + bladeH, z: bZ + dirZ * 0.4 };
        solid.addTriangle(v1, v2, v3, shortGrassCol);
      }

      // Colorful wildflower clusters
      if (i % 3 === 1 && screens) {
        const fCol = flowerColors[i % flowerColors.length];
        const fRadius = 0.95;
        const fX = p.x - dirX * (1.4 + (i % 3) * 0.8);
        const fZ = p.z - dirZ * (1.4 + (i % 3) * 0.8);
        const fY = topY + 0.55;
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

    // (b) Warm Cobblestone Pathway & Overlook Plaza (to the right of the waterfall)
    const pathAngle = this.waterfallAngle - 0.34;
    const pPath = this.getPerimeterRadius(pathAngle, halfWidth, halfDepth);
    const stPathR = this.getStadiumOuterRadiusAtAngle(pathAngle, venueBounds);
    if (pPath.r - stPathR > 6.5) {
      const stoneA = [0.902, 0.847, 0.765, 1.0]; // #e6d8c3 warm cream stone
      const stoneB = [0.839, 0.776, 0.675, 1.0]; // #d6c6ac warm tan stone
      const dirX = pPath.x / (pPath.r || 1);
      const dirZ = pPath.z / (pPath.r || 1);
      const steps = 6;
      for (let k = 0; k < steps; k++) {
        const frac = (k + 0.5) / steps;
        const r = stPathR + 2.0 + (pPath.r - stPathR - 4.5) * frac;
        const sway = Math.sin(k * 1.1) * 1.4;
        const sx = dirX * r - dirZ * sway;
        const sz = dirZ * r + dirX * sway;
        const stoneW = 2.6 + (k === steps - 1 ? 1.8 : 0);
        solid.addBox(sx, topY + 0.08, sz, stoneW, 0.22, stoneW * 0.85, k % 2 === 0 ? stoneA : stoneB, pathAngle + k * 0.2);
      }

      // Cozy wooden bench & cute cream-white bunny on the meadow overlook (homage to reference)
      const benchR = pPath.r - 3.6;
      const bx = dirX * benchR - dirZ * 2.4;
      const bz = dirZ * benchR + dirX * 2.4;
      const woodCol = [0.62, 0.40, 0.22, 1.0];
      solid.addBox(bx, topY + 0.65, bz, 2.8, 0.35, 1.1, woodCol, pathAngle);
      solid.addBox(bx, topY + 1.15, bz, 2.8, 0.75, 0.25, woodCol, pathAngle);

      // Cute stylized cream-white bunny sitting nearby
      const bunnyR = pPath.r - 3.2;
      const rx = dirX * bunnyR + dirZ * 2.6;
      const rz = dirZ * bunnyR - dirX * 2.6;
      const bunnyCol = [0.98, 0.94, 0.86, 1.0];
      solid.addBox(rx, topY + 0.85, rz, 1.3, 1.5, 1.3, bunnyCol, pathAngle);
      solid.addBox(rx, topY + 1.85, rz, 1.0, 0.95, 1.0, bunnyCol, pathAngle);
      solid.addBox(rx - 0.25, topY + 2.75, rz, 0.28, 1.05, 0.28, bunnyCol, pathAngle);
      solid.addBox(rx + 0.25, topY + 2.75, rz, 0.28, 1.05, 0.28, bunnyCol, pathAngle);
    }

    // (c) Stylized Miniature Trees, Blossom Shrubs & Warm Glowing Lanterns in Safe Meadow Ring
    const propSlots = 24;
    for (let i = 0; i < propSlots; i++) {
      const angle = (i / propSlots) * Math.PI * 2 + 0.12;
      // Avoid waterfall and cobblestone path
      if (this.angleDiff(angle, this.waterfallAngle) < 0.14) continue;
      if (this.angleDiff(angle, pathAngle) < 0.12) continue;

      const p = this.getPerimeterRadius(angle, halfWidth, halfDepth);
      const stR = this.getStadiumOuterRadiusAtAngle(angle, venueBounds);
      const avail = p.r - stR;
      if (avail < 6.5) continue;

      const dirX = p.x / (p.r || 1);
      const dirZ = p.z / (p.r || 1);
      const rMid = stR + avail * (0.52 + 0.14 * Math.sin(i * 2.3));
      const px = dirX * rMid;
      const pz = dirZ * rMid;
      const treeScaleCap = Math.min(1.15, Math.max(0.65, (avail - 3.5) / 8.5));

      if (i % 3 === 0 && avail >= 9.0) {
        // Stylized 3-tier miniature pine / conifer tree
        this.addMiniaturePineTree(solid, px, topY, pz, Math.min(treeScaleCap, 0.9 + (i % 3) * 0.2));
      } else if (i % 3 === 1 && avail >= 8.5) {
        // Rounded blossom or lush green canopy tree
        const isBlossom = i % 2 === 1;
        this.addMiniatureCanopyTree(solid, px, topY, pz, Math.min(treeScaleCap, 0.85 + (i % 2) * 0.25), isBlossom);
      } else if (screens) {
        // Warm glowing fairy-tale garden lantern post
        this.addGlowingLantern(solid, screens, px, topY, pz);
      }
    }
  }

  /**
   * Stylized 3-tier miniature pine tree
   */
  addMiniaturePineTree(solid, x, baseY, z, scale) {
    const trunkCol = [0.46, 0.30, 0.18, 1.0];
    const pineCols = [
      [0.310, 0.561, 0.176, 1.0], // #4f8f2d
      [0.388, 0.659, 0.231, 1.0], // #63a83b
      [0.486, 0.761, 0.306, 1.0]  // #7cc24e
    ];

    const trunkH = 2.2 * scale;
    solid.addBox(x, baseY + trunkH * 0.5, z, 0.9 * scale, trunkH, 0.9 * scale, trunkCol);

    const tiers = [
      { yOff: 1.8 * scale, r: 2.8 * scale, h: 3.0 * scale, col: pineCols[0] },
      { yOff: 3.6 * scale, r: 2.2 * scale, h: 2.8 * scale, col: pineCols[1] },
      { yOff: 5.2 * scale, r: 1.5 * scale, h: 2.4 * scale, col: pineCols[2] }
    ];

    const sides = 7;
    for (let t = 0; t < tiers.length; t++) {
      const tier = tiers[t];
      const yBot = baseY + tier.yOff;
      const yTop = yBot + tier.h;
      const apex = { x, y: yTop, z };
      for (let s = 0; s < sides; s++) {
        const a1 = (s / sides) * Math.PI * 2;
        const a2 = ((s + 1) / sides) * Math.PI * 2;
        const p1 = { x: x + Math.cos(a1) * tier.r, y: yBot, z: z + Math.sin(a1) * tier.r };
        const p2 = { x: x + Math.cos(a2) * tier.r, y: yBot, z: z + Math.sin(a2) * tier.r };
        solid.addTriangle(p1, apex, p2, tier.col);
      }
    }
  }

  /**
   * Rounded miniature canopy / blossom tree
   */
  addMiniatureCanopyTree(solid, x, baseY, z, scale, isBlossom) {
    const trunkCol = [0.50, 0.34, 0.20, 1.0];
    const topCol = isBlossom ? [0.980, 0.741, 0.816, 1.0] : [0.467, 0.749, 0.278, 1.0];
    const botCol = isBlossom ? [0.922, 0.576, 0.690, 1.0] : [0.341, 0.588, 0.196, 1.0];

    const trunkH = 2.6 * scale;
    solid.addBox(x, baseY + trunkH * 0.5, z, 0.8 * scale, trunkH, 0.8 * scale, trunkCol);
    this.addFlattenedPuff(solid, x, baseY + trunkH + 1.4 * scale, z, 2.5 * scale, 2.1 * scale, 2.5 * scale, topCol, botCol);
  }

  /**
   * Warm glowing fairy-tale garden lantern post
   */
  addGlowingLantern(solid, screens, x, baseY, z) {
    const postCol = [0.24, 0.21, 0.19, 1.0];
    const glowCol = [1.0, 0.82, 0.36, 1.0]; // Warm golden lantern glow

    solid.addBox(x, baseY + 1.5, z, 0.38, 3.0, 0.38, postCol);
    solid.addBox(x, baseY + 3.55, z, 0.95, 0.25, 0.95, postCol);
    screens.addBox(x, baseY + 3.1, z, 0.78, 0.78, 0.78, glowCol);
  }

  /**
   * 7. Fluffy White Clouds floating outside the platform
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

    const cloudTopCol = [1.0, 1.0, 1.0, 1.0];
    const cloudBotCol = [0.957, 0.965, 0.980, 1.0];

    this.cloudVertexStart = solid.positions.length / 3;

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
   * Generates a flat fluffy low-poly ellipsoid puff with guaranteed non-zero outward normals
   */
  addFlattenedPuff(builder, cx, cy, cz, rx, ry, rz, topCol, botCol) {
    const latBands = 5;
    const lonBands = 8;

    const evalEllipsoidNormal = (px, py, pz) => {
      const nx = (px - cx) / (rx * rx || 1);
      const ny = (py - cy) / (ry * ry || 1);
      const nz = (pz - cz) / (rz * rz || 1);
      const len = Math.hypot(nx, ny, nz);
      if (len > 1e-6) {
        return { x: nx / len, y: ny / len, z: nz / len };
      }
      return { x: 0, y: 1, z: 0 };
    };

    for (let lat = 0; lat < latBands; lat++) {
      const theta1 = (lat / latBands) * Math.PI;
      const theta2 = ((lat + 1) / latBands) * Math.PI;

      const sinT1 = Math.sin(theta1);
      const cosT1 = Math.cos(theta1);
      const sinT2 = Math.sin(theta2);
      const cosT2 = Math.cos(theta2);

      const col1 = (cosT1 + cosT2) * 0.5 >= 0 ? topCol : botCol;

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

        if (lat === 0) {
          const norm = evalEllipsoidNormal(
            (v1.x + v3.x + v4.x) / 3,
            (v1.y + v3.y + v4.y) / 3,
            (v1.z + v3.z + v4.z) / 3
          );
          builder.addTriangle(v1, v3, v4, col1, norm);
        } else if (lat === latBands - 1) {
          const norm = evalEllipsoidNormal(
            (v1.x + v2.x + v3.x) / 3,
            (v1.y + v2.y + v3.y) / 3,
            (v1.z + v2.z + v3.z) / 3
          );
          builder.addTriangle(v1, v2, v3, col1, norm);
        } else {
          const norm = evalEllipsoidNormal(
            (v1.x + v2.x + v3.x + v4.x) * 0.25,
            (v1.y + v2.y + v3.y + v4.y) * 0.25,
            (v1.z + v2.z + v3.z + v4.z) * 0.25
          );
          builder.addQuad(v1, v2, v3, v4, col1, norm);
        }
      }
    }
  }

  /**
   * 8. Golden fairy particles floating around the scene
   */
  buildGoldenParticles(screens, halfWidth, halfDepth, topY) {
    const particleCount = 36;
    this.particleInstances = [];

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

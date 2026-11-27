/**
 * Stand Tiers, VIP Suites & Vomitory Recess Mesh Builder Mixin
 */
const {
  DEG2RAD,
  RAD2DEG,
  rotateXZ,
  evalTierPoint,
  isConcentricMorphTier,
  getTierRowsAtAngleFloat,
  getTierRowsAtAngle,
  getInfieldCornerTransitionAngles,
  getRowInwardNormal,
  computeVomitoryAngularBounds
} = require('./schema-geometry');
const { hexToSeat3D } = require('./seat-colors');

class StandMixinHolder {

  buildStandTiersMesh(solid, alpha, screens) {
    const tiers = this.venue.standTiers || [];
    const showGuardrails = !(this.venue.gridSystem && this.venue.gridSystem.showGuardrails === false);
    const showVomitories = !(this.venue.gridSystem && this.venue.gridSystem.showVomitories === false);
    const cornerAngles = getInfieldCornerTransitionAngles(this.venue);

    // 全密度单座渲染（stride = 1），避免大场馆座椅稀疏出现空隙
    const globalSeatStride = 1;

    const tierSeatColors = [
      { pan: [0.17, 0.37, 0.72, 1.0], back: [0.14, 0.31, 0.62, 1.0] }, // 1F Matte Navy-Blue
      { pan: [0.09, 0.50, 0.39, 1.0], back: [0.07, 0.42, 0.32, 1.0] }, // 2F Matte Emerald
      { pan: [0.68, 0.48, 0.16, 1.0], back: [0.56, 0.39, 0.12, 1.0] }, // 3F Matte Amber VIP
      { pan: [0.40, 0.27, 0.68, 1.0], back: [0.33, 0.22, 0.58, 1.0] }  // 4F Matte Violet
    ];
    const concreteStepCol = [0.25, 0.29, 0.36, 1.0];
    const concreteRiserCol = [0.22, 0.26, 0.33, 1.0];
    const vipFloorCol = [0.22, 0.17, 0.13, 1.0];
    const vipCarpetCol = [0.30, 0.13, 0.15, 1.0];
    const vipGoldTrimCol = [0.86, 0.70, 0.38, 1.0];
    const vipFasciaDarkCol = [0.14, 0.16, 0.21, 1.0];
    const stairStepCol = [0.24, 0.28, 0.35, 1.0];
    const handrailCol = [0.46, 0.49, 0.53, 1.0];

    // Precompute front-connected vomitory angular windows per tier using strict vom.width solver
    const frontVomWindowsByTier = tiers.map((tier, tierIndex) => {
      const windows = [];
      if (!showVomitories) return windows;
      (tier.sectors || []).forEach((sec) => {
        if (sec.isDeleted || sec.fillType === 'empty-void' || sec.fillType === 'vip-box' || sec.fillType === 'solid-wall') return;
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
      const defaultPair = tierSeatColors[(tier.level - 1) % tierSeatColors.length];
      const tierOverrideHex = this.tierColorOverrides && this.tierColorOverrides[String(tier.level)];
      const tierSchemaHex = tier.seatColor;
      const seatColPair = (tierOverrideHex && hexToSeat3D(tierOverrideHex)) ||
                          (tierSchemaHex && hexToSeat3D(tierSchemaHex)) ||
                          defaultPair;
      const sectors = tier.sectors || [];
      const activeSectors = sectors.filter(s => !s.isDeleted && s.fillType !== 'empty-void');
      const selectedIdxInTier = activeSectors.findIndex(s => s.id === this.selectedSectorId);
      const upperTierFrontVoms = frontVomWindowsByTier[tierIndex + 1] || [];
      const tierSelfMorphed = isConcentricMorphTier(tier);
      const tierHasMorph = tierSelfMorphed || prevTierMorphed;

      sectors.forEach((sec) => {
        if (sec.isDeleted || sec.fillType === 'empty-void') return;

        const isVip = (sec.fillType || tier.defaultFillType) === 'vip-box';

        // Per-floor & schema color support (user override > sector seatColor > tier seatColor > default)
        const secColPair = (tierOverrideHex && hexToSeat3D(tierOverrideHex)) ||
                           (sec.seatColor && hexToSeat3D(sec.seatColor)) ||
                           seatColPair;
        const vipOverrideHex = tierOverrideHex || (this.tierColorOverrides && this.tierColorOverrides.vip);
        const vipSchemaHex = sec.seatColor || tierSchemaHex;
        const vipPair = (vipOverrideHex && hexToSeat3D(vipOverrideHex)) ||
                        (vipSchemaHex && hexToSeat3D(vipSchemaHex)) || {
          pan: [0.72, 0.50, 0.20, 1.0],
          back: [0.56, 0.38, 0.15, 1.0]
        };
        const panCol = isVip ? vipPair.pan : secColPair.pan;
        const backCol = isVip ? vipPair.back : secColPair.back;

        const sDeg = sec.startAngleDeg;
        const eDeg = sec.endAngleDeg;
        const angularSpan = eDeg - sDeg;
        if (angularSpan <= 0.5) return;

        const rawMaxRows = sec.rows || tier.defaultRows || 22;
        const totalRows = rawMaxRows;
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
          const midVomDeg = (sDeg + eDeg) / 2;
          const vomRefRows = tierSelfMorphed
            ? getTierRowsAtAngle(this.venue, tierIndex, tier, sec, midVomDeg)
            : totalRows;
          const vomInfo = computeVomitoryAngularBounds(this.venue, tierIndex, sDeg, eDeg, vom, vomRefRows, sec.customRadialDepth);
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
        const secRailCol = handrailCol;

        if ((sec.fillType || tier.defaultFillType) === 'solid-wall') {
          // 实体山墙 / 机房：用实体块填满整个看台区域，不生成台阶与座椅
          const wallCol = [0.27, 0.30, 0.36, 1.0];
          const wallTopCol = [0.20, 0.23, 0.29, 1.0];

          for (let a = 0; a < rawAngles.length - 1; a++) {
            const deg1 = rawAngles[a];
            const deg2 = rawAngles[a + 1];
            if (deg2 - deg1 < 0.04) continue;

            const i1 = evalTierPoint(this.venue, tierIndex, deg1, 0, sec.customRadialDepth);
            const i2 = evalTierPoint(this.venue, tierIndex, deg2, 0, sec.customRadialDepth);
            const o1 = evalTierPoint(this.venue, tierIndex, deg1, 1, sec.customRadialDepth);
            const o2 = evalTierPoint(this.venue, tierIndex, deg2, 1, sec.customRadialDepth);

            // 顶面
            solid.addQuad(
              { x: i1.inX, y: topElev, z: i1.inZ },
              { x: o1.outX, y: topElev, z: o1.outZ },
              { x: o2.outX, y: topElev, z: o2.outZ },
              { x: i2.inX, y: topElev, z: i2.inZ },
              wallTopCol,
              { x: 0, y: 1, z: 0 }
            );
            // 内侧立面
            solid.addQuad(
              { x: i1.inX, y: baseElev, z: i1.inZ },
              { x: i1.inX, y: topElev, z: i1.inZ },
              { x: i2.inX, y: topElev, z: i2.inZ },
              { x: i2.inX, y: baseElev, z: i2.inZ },
              wallCol
            );
            // 外侧立面
            solid.addQuad(
              { x: o1.outX, y: baseElev, z: o1.outZ },
              { x: o2.outX, y: baseElev, z: o2.outZ },
              { x: o2.outX, y: topElev, z: o2.outZ },
              { x: o1.outX, y: topElev, z: o1.outZ },
              wallCol
            );
          }

          // 分区两端封边
          [sDeg, eDeg].forEach((endDeg) => {
            const iPt = evalTierPoint(this.venue, tierIndex, endDeg, 0, sec.customRadialDepth);
            const oPt = evalTierPoint(this.venue, tierIndex, endDeg, 1, sec.customRadialDepth);
            solid.addQuad(
              { x: iPt.inX, y: baseElev, z: iPt.inZ },
              { x: oPt.outX, y: baseElev, z: oPt.outZ },
              { x: oPt.outX, y: topElev, z: oPt.outZ },
              { x: iPt.inX, y: topElev, z: iPt.inZ },
              wallCol
            );
          });
          return;
        }

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
            // Refined VIP Suite Balcony Deck: dark-walnut hardwood + luxury lounge carpet runner + sculpted champagne-gold fascia
            const deckBot = Math.max(0, baseElev - 0.62);
            const goldBandBot = baseElev - 0.16;
            solid.addQuad(
              { x: pt1.inX, y: baseElev, z: pt1.inZ },
              { x: pt1.outX, y: baseElev, z: pt1.outZ },
              { x: pt2.outX, y: baseElev, z: pt2.outZ },
              { x: pt2.inX, y: baseElev, z: pt2.inZ },
              vipFloorCol,
              { x: 0, y: 1, z: 0 }
            );
            // Inset luxury lounge carpet runner behind the front seating apron (rowFrac 0.34 -> 0.92)
            const c1_a = { x: pt1.inX + (pt1.outX - pt1.inX) * 0.34, y: baseElev + 0.015, z: pt1.inZ + (pt1.outZ - pt1.inZ) * 0.34 };
            const c1_b = { x: pt1.inX + (pt1.outX - pt1.inX) * 0.92, y: baseElev + 0.015, z: pt1.inZ + (pt1.outZ - pt1.inZ) * 0.92 };
            const c2_b = { x: pt2.inX + (pt2.outX - pt2.inX) * 0.92, y: baseElev + 0.015, z: pt2.inZ + (pt2.outZ - pt2.inZ) * 0.92 };
            const c2_a = { x: pt2.inX + (pt2.outX - pt2.inX) * 0.34, y: baseElev + 0.015, z: pt2.inZ + (pt2.outZ - pt2.inZ) * 0.34 };
            solid.addQuad(c1_a, c1_b, c2_b, c2_a, vipCarpetCol, { x: 0, y: 1, z: 0 });

            // Underside soffit
            solid.addQuad(
              { x: pt1.outX, y: deckBot, z: pt1.outZ },
              { x: pt1.inX, y: deckBot, z: pt1.inZ },
              { x: pt2.inX, y: deckBot, z: pt2.inZ },
              { x: pt2.outX, y: deckBot, z: pt2.outZ },
              concreteRiserCol,
              { x: 0, y: -1, z: 0 }
            );
            // Sculpted two-tone front balcony fascia: architectural slate lower band + champagne-gold upper molding
            solid.addQuad(
              { x: pt1.inX, y: deckBot, z: pt1.inZ },
              { x: pt1.inX, y: goldBandBot, z: pt1.inZ },
              { x: pt2.inX, y: goldBandBot, z: pt2.inZ },
              { x: pt2.inX, y: deckBot, z: pt2.inZ },
              vipFasciaDarkCol
            );
            solid.addQuad(
              { x: pt1.inX, y: goldBandBot, z: pt1.inZ },
              { x: pt1.inX, y: baseElev + 0.04, z: pt1.inZ },
              { x: pt2.inX, y: baseElev + 0.04, z: pt2.inZ },
              { x: pt2.inX, y: goldBandBot, z: pt2.inZ },
              vipGoldTrimCol
            );
            // Subtle warm architectural under-lip accent strip (glows warmly in concert & sports modes)
            if (screens && !(this.isLightsOffScene && this.isLightsOffScene())) {
              const glowOff = 0.03;
              const n1x = -pt1.nx * glowOff, n1z = -pt1.nz * glowOff;
              const n2x = -pt2.nx * glowOff, n2z = -pt2.nz * glowOff;
              screens.addQuad(
                { x: pt1.inX + n1x, y: goldBandBot - 0.06, z: pt1.inZ + n1z },
                { x: pt1.inX + n1x, y: goldBandBot, z: pt1.inZ + n1z },
                { x: pt2.inX + n2x, y: goldBandBot, z: pt2.inZ + n2z },
                { x: pt2.inX + n2x, y: goldBandBot - 0.06, z: pt2.inZ + n2z },
                [1.0, 0.86, 0.56, 1.0]
              );
            }
          } else if (tierSelfMorphed) {
            // Constant physical tread width (rowPitch) & constant slopeDeg clipped cleanly by the concentric circle outer rim
            const depth1 = Math.max(0.5, Math.hypot(pt1.outX - pt1.inX, pt1.outZ - pt1.inZ));
            const depth2 = Math.max(0.5, Math.hypot(pt2.outX - pt2.inX, pt2.outZ - pt2.inZ));
            const floatRows1 = Math.max(2, depth1 / rowPitch);
            const floatRows2 = Math.max(2, depth2 / rowPitch);
            const yTop1 = baseElev + Math.max(0, floatRows1 - 1) * riserH;
            const yTop2 = baseElev + Math.max(0, floatRows2 - 1) * riserH;
            const maxStepCount = Math.ceil(Math.max(depth1, depth2) / rowPitch);
            const upNorm = { x: 0, y: 1, z: 0 };

            for (let rb = 0; rb < maxStepCount; rb++) {
              const rowNum = rb + 1;
              if (isVomStrip && vomEndRow >= vomStartRow && rowNum >= vomStartRow && rowNum <= vomEndRow) {
                continue;
              }

              const d0 = rb * rowPitch;
              const d1 = (rb + 1) * rowPitch;
              const in1 = d0 < depth1 - 1e-4;
              const in2 = d0 < depth2 - 1e-4;
              if (!in1 && !in2) continue;

              const treadY = baseElev + rb * riserH;
              const riserBot = rb === 0
                ? (tier.level === 1 ? 0 : Math.max(0, baseElev - 1.1))
                : (baseElev + (rb - 1) * riserH);
              const rCol = rb === 0 && tier.level === 1 ? [0.28, 0.33, 0.42, 1.0] : concreteRiserCol;

              if (in1 && in2) {
                const f1_0 = d0 / depth1;
                const f1_1 = Math.min(1, d1 / depth1);
                const f2_0 = d0 / depth2;
                const f2_1 = Math.min(1, d1 / depth2);

                const x1_in = pt1.inX + (pt1.outX - pt1.inX) * f1_0;
                const z1_in = pt1.inZ + (pt1.outZ - pt1.inZ) * f1_0;
                const x1_out = pt1.inX + (pt1.outX - pt1.inX) * f1_1;
                const z1_out = pt1.inZ + (pt1.outZ - pt1.inZ) * f1_1;

                const x2_in = pt2.inX + (pt2.outX - pt2.inX) * f2_0;
                const z2_in = pt2.inZ + (pt2.outZ - pt2.inZ) * f2_0;
                const x2_out = pt2.inX + (pt2.outX - pt2.inX) * f2_1;
                const z2_out = pt2.inZ + (pt2.outZ - pt2.inZ) * f2_1;

                if (!(rb === 0 && isVomStrip && isFrontConnected)) {
                  solid.addQuad(
                    { x: x1_in, y: riserBot, z: z1_in },
                    { x: x1_in, y: treadY, z: z1_in },
                    { x: x2_in, y: treadY, z: z2_in },
                    { x: x2_in, y: riserBot, z: z2_in },
                    rCol
                  );
                }

                solid.addQuad(
                  { x: x1_in, y: treadY, z: z1_in },
                  { x: x1_out, y: treadY, z: z1_out },
                  { x: x2_out, y: treadY, z: z2_out },
                  { x: x2_in, y: treadY, z: z2_in },
                  concreteStepCol,
                  upNorm
                );
              } else if (in1 && !in2) {
                // Row terminates smoothly against the circular outer perimeter between deg1 and deg2
                const f1_0 = d0 / depth1;
                const f1_1 = Math.min(1, d1 / depth1);
                const x1_in = pt1.inX + (pt1.outX - pt1.inX) * f1_0;
                const z1_in = pt1.inZ + (pt1.outZ - pt1.inZ) * f1_0;
                const x1_out = pt1.inX + (pt1.outX - pt1.inX) * f1_1;
                const z1_out = pt1.inZ + (pt1.outZ - pt1.inZ) * f1_1;

                const tExit = Math.max(0, Math.min(1, (depth1 - d0) / Math.max(1e-5, depth1 - depth2)));
                const exX = pt1.outX + (pt2.outX - pt1.outX) * tExit;
                const exZ = pt1.outZ + (pt2.outZ - pt1.outZ) * tExit;

                solid.addQuad(
                  { x: x1_in, y: riserBot, z: z1_in },
                  { x: x1_in, y: treadY, z: z1_in },
                  { x: exX, y: treadY, z: exZ },
                  { x: exX, y: riserBot, z: exZ },
                  rCol
                );
                solid.addTriangle(
                  { x: x1_in, y: treadY, z: z1_in },
                  { x: x1_out, y: treadY, z: z1_out },
                  { x: exX, y: treadY, z: exZ },
                  concreteStepCol,
                  upNorm
                );
              } else {
                // Row emerges smoothly from the circular outer perimeter between deg1 and deg2
                const f2_0 = d0 / depth2;
                const f2_1 = Math.min(1, d1 / depth2);
                const x2_in = pt2.inX + (pt2.outX - pt2.inX) * f2_0;
                const z2_in = pt2.inZ + (pt2.outZ - pt2.inZ) * f2_0;
                const x2_out = pt2.inX + (pt2.outX - pt2.inX) * f2_1;
                const z2_out = pt2.inZ + (pt2.outZ - pt2.inZ) * f2_1;

                const tEnter = Math.max(0, Math.min(1, (d0 - depth1) / Math.max(1e-5, depth2 - depth1)));
                const enX = pt1.outX + (pt2.outX - pt1.outX) * tEnter;
                const enZ = pt1.outZ + (pt2.outZ - pt1.outZ) * tEnter;

                solid.addQuad(
                  { x: enX, y: riserBot, z: enZ },
                  { x: enX, y: treadY, z: enZ },
                  { x: x2_in, y: treadY, z: z2_in },
                  { x: x2_in, y: riserBot, z: z2_in },
                  rCol
                );
                solid.addTriangle(
                  { x: enX, y: treadY, z: enZ },
                  { x: x2_out, y: treadY, z: z2_out },
                  { x: x2_in, y: treadY, z: z2_in },
                  concreteStepCol,
                  upNorm
                );
              }
            }

            // Continuously seal the sweeping circular outer perimeter along deg1 -> deg2
            const xTop1 = pt1.outX;
            const zTop1 = pt1.outZ;
            const xTop2 = pt2.outX;
            const zTop2 = pt2.outZ;
            const rearBot1 = Math.max(0, Math.min(baseElev, yTop1 - 1.4));
            const rearBot2 = Math.max(0, Math.min(baseElev, yTop2 - 1.4));

            solid.addQuad(
              { x: xTop1, y: yTop1, z: zTop1 },
              { x: xTop2, y: yTop2, z: zTop2 },
              { x: xTop2, y: rearBot2, z: zTop2 },
              { x: xTop1, y: rearBot1, z: zTop1 },
              concreteRiserCol
            );

            // Top Rear Guardrail smoothly tracking the sweeping circular rim (lowered & multi-material)
            if (showGuardrails && guard.rearWallEnabled !== false) {
              const rearH = Math.min(0.84, (guard.rearWallHeight || 1.2) * 0.68);
              solid.addTexturedRailingRun(
                { x: xTop1, z: zTop1 }, yTop1,
                { x: xTop2, z: zTop2 }, yTop2,
                rearH,
                {
                  capColor: secRailCol,
                  postColor: [0.32, 0.35, 0.39, 1.0],
                  midColor: [0.42, 0.45, 0.49, 1.0],
                  includeStartPost: a % 2 === 0,
                  includeEndPost: false,
                  postSpacing: 10
                }
              );
            }
          } else {
            // Exact uniform row-by-row concrete treads & risers matching seat elevations 1:1
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

            // Continuously seal the top rear perimeter of the stand across deg1 -> deg2
            const xTop1 = pt1.outX;
            const zTop1 = pt1.outZ;
            const xTop2 = pt2.outX;
            const zTop2 = pt2.outZ;

            solid.addQuad(
              { x: xTop1, y: topElev, z: zTop1 },
              { x: xTop2, y: topElev, z: zTop2 },
              { x: xTop2, y: Math.max(0, topElev - 1.2), z: zTop2 },
              { x: xTop1, y: Math.max(0, topElev - 1.2), z: zTop1 },
              concreteRiserCol
            );

            // Top Rear Guardrail / Balustrade along the stand top rim (lowered & multi-material)
            if (showGuardrails && guard.rearWallEnabled !== false) {
              const rearH = Math.min(0.84, (guard.rearWallHeight || 1.2) * 0.68);
              solid.addTexturedRailingRun(
                { x: xTop1, z: zTop1 }, topElev,
                { x: xTop2, z: zTop2 }, topElev,
                rearH,
                {
                  capColor: secRailCol,
                  postColor: [0.32, 0.35, 0.39, 1.0],
                  midColor: [0.42, 0.45, 0.49, 1.0],
                  includeStartPost: a % 2 === 0,
                  includeEndPost: false,
                  postSpacing: 10
                }
              );
            }
          }

          // Front Guardrail (OMITTED across front-connected Row-0/Row-1 vomitories!)
          // Lowered height (~0.68-0.75m) with gunmetal stanchions, base shoes, brushed-metal cap, mid-rail & glass infill
          if (showGuardrails && guard.frontRailEnabled !== false && !(isVomStrip && isFrontConnected)) {
            const rawFrontH = guard.frontRailHeight || 1.1;
            const frontH = isVip ? Math.min(0.70, rawFrontH * 0.65) : Math.min(0.74, rawFrontH * 0.66);
            const f1_bot = { x: pt1.inX, y: baseElev, z: pt1.inZ };
            const f2_bot = { x: pt2.inX, y: baseElev, z: pt2.inZ };
            const g1_top = { x: pt1.inX, y: baseElev + frontH, z: pt1.inZ };
            const g2_top = { x: pt2.inX, y: baseElev + frontH, z: pt2.inZ };
            const postCol = [0.32, 0.35, 0.39, 1.0];

            // Ergonomic brushed-metal top handrail cap
            solid.addBeam3D(g1_top, g2_top, isVip ? 0.085 : 0.095, isVip ? 0.048 : 0.052, secRailCol);
            // Gunmetal stanchion post with base anchor flange
            if (a === 0 || a % 2 === 0) {
              solid.addBox(f1_bot.x, baseElev + frontH / 2, f1_bot.z, isVip ? 0.058 : 0.068, frontH, isVip ? 0.058 : 0.068, postCol, 0);
              solid.addBox(f1_bot.x, baseElev + 0.025, f1_bot.z, 0.115, 0.05, 0.115, postCol, 0);
            }

            if (isVip) {
              // Frameless smoked tempered glass balcony balustrade + slim champagne-gold shoe channel
              alpha.addQuad(
                { x: pt1.inX, y: baseElev + 0.07, z: pt1.inZ },
                g1_top,
                g2_top,
                { x: pt2.inX, y: baseElev + 0.07, z: pt2.inZ },
                [0.64, 0.78, 0.90, 0.28]
              );
              solid.addQuad(
                f1_bot,
                { x: pt1.inX, y: baseElev + 0.07, z: pt1.inZ },
                { x: pt2.inX, y: baseElev + 0.07, z: pt2.inZ },
                f2_bot,
                vipGoldTrimCol
              );
            } else if (guard.material === 'tempered-glass' && tier.level > 1) {
              alpha.addQuad(
                { x: pt1.inX, y: baseElev + 0.05, z: pt1.inZ },
                g1_top,
                g2_top,
                { x: pt2.inX, y: baseElev + 0.05, z: pt2.inZ },
                [0.54, 0.82, 0.98, 0.28]
              );
              solid.addBeam3D(
                { x: pt1.inX, y: baseElev + 0.04, z: pt1.inZ },
                { x: pt2.inX, y: baseElev + 0.04, z: pt2.inZ },
                0.06, 0.06, postCol
              );
            } else if (guard.material === 'concrete-parapet' && tier.level > 1) {
              solid.addQuad(f1_bot, g1_top, g2_top, f2_bot, [0.42, 0.48, 0.58, 1.0]);
            } else {
              // Sleek mid-rail + slim stainless pickets + subtle tinted glass infill on upper tiers
              solid.addBeam3D(
                { x: pt1.inX, y: baseElev + frontH * 0.52, z: pt1.inZ },
                { x: pt2.inX, y: baseElev + frontH * 0.52, z: pt2.inZ },
                0.042, 0.042, [0.42, 0.45, 0.49, 1.0]
              );
              if (alpha && tier.level > 1) {
                alpha.addQuad(
                  { x: pt1.inX, y: baseElev + 0.05, z: pt1.inZ },
                  { x: pt1.inX, y: baseElev + frontH - 0.03, z: pt1.inZ },
                  { x: pt2.inX, y: baseElev + frontH - 0.03, z: pt2.inZ },
                  { x: pt2.inX, y: baseElev + 0.05, z: pt2.inZ },
                  [0.56, 0.78, 0.92, 0.18]
                );
              }
              const segLen = Math.hypot(f2_bot.x - f1_bot.x, f2_bot.z - f1_bot.z);
              const pickets = Math.max(1, Math.min(4, Math.floor(segLen / 1.1)));
              for (let p = 1; p <= pickets; p++) {
                const pt = p / (pickets + 1);
                solid.addBox(
                  f1_bot.x + (f2_bot.x - f1_bot.x) * pt,
                  baseElev + frontH / 2,
                  f1_bot.z + (f2_bot.z - f1_bot.z) * pt,
                  0.038, frontH - 0.04, 0.038, [0.56, 0.62, 0.70, 1.0], 0
                );
              }
            }
          }

          // VIP Skybox Luxury Rear Lounge Wall (warm backlit hospitality facade + dark-bronze framing + warm cove wash)
          const skipRearForPassThrough = (isVomStrip && vomEndRow >= totalRows) || isUpperBridgeStrip;
          if (isVip && guard.rearWallEnabled !== false && !skipRearForPassThrough) {
            const rearH = Math.max(2.85, guard.rearWallHeight || 2.85);
            const wainscotY = baseElev + 0.85;
            const coveBotY = baseElev + rearH - 0.38;
            // Lower dark-walnut acoustic wainscot panel
            solid.addQuad(
              { x: pt1.outX, y: baseElev, z: pt1.outZ },
              { x: pt1.outX, y: wainscotY, z: pt1.outZ },
              { x: pt2.outX, y: wainscotY, z: pt2.outZ },
              { x: pt2.outX, y: baseElev, z: pt2.outZ },
              [0.20, 0.15, 0.11, 1.0]
            );
            // Mid warm-lit hospitality lounge glass backdrop
            solid.addQuad(
              { x: pt1.outX, y: wainscotY, z: pt1.outZ },
              { x: pt1.outX, y: coveBotY, z: pt1.outZ },
              { x: pt2.outX, y: coveBotY, z: pt2.outZ },
              { x: pt2.outX, y: wainscotY, z: pt2.outZ },
              [0.36, 0.28, 0.19, 1.0]
            );
            // Upper backlit warm-gold interior hospitality frieze
            if (screens && !(this.isLightsOffScene && this.isLightsOffScene())) {
              screens.addQuad(
                { x: pt1.outX, y: coveBotY, z: pt1.outZ },
                { x: pt1.outX, y: baseElev + rearH - 0.14, z: pt1.outZ },
                { x: pt2.outX, y: baseElev + rearH - 0.14, z: pt2.outZ },
                { x: pt2.outX, y: coveBotY, z: pt2.outZ },
                [0.95, 0.80, 0.50, 1.0]
              );
            }
            // Top dark-bronze cornice trim
            solid.addQuad(
              { x: pt1.outX, y: baseElev + rearH - 0.14, z: pt1.outZ },
              { x: pt1.outX, y: baseElev + rearH, z: pt1.outZ },
              { x: pt2.outX, y: baseElev + rearH, z: pt2.outZ },
              { x: pt2.outX, y: baseElev + rearH - 0.14, z: pt2.outZ },
              [0.16, 0.14, 0.13, 1.0]
            );
          }
        }

        // 2. Radial Stair Aisle & Volumetric Inter-Stand Handrail strictly along 90° perpendicular cut
        if (!isVip && showGuardrails && guard.aisleHandrailEnabled !== false) {
          const ptEdge = evalTierPoint(this.venue, tierIndex, sDeg, 0, sec.customRadialDepth);
          const ptEdgeTop = { x: ptEdge.outX, z: ptEdge.outZ };

          const dxE = ptEdgeTop.x - ptEdge.inX;
          const dzE = ptEdgeTop.z - ptEdge.inZ;
          const lenE = Math.hypot(dxE, dzE) || 1;
          const tanX = -dzE / lenE;
          const tanZ = dxE / lenE;

          const edgeFloatRows = tierSelfMorphed ? Math.max(2, lenE / rowPitch) : totalRows;
          const edgeSteps = tierSelfMorphed ? Math.max(2, Math.ceil(edgeFloatRows)) : totalRows;
          const topElevE = baseElev + Math.max(0, edgeFloatRows - 1) * riserH;

          const hwAisle = radialAisleWidth * 0.42;
          // Stepped stair treads per row (y = treadY + 0.025) so aisle NEVER Z-fights through step noses
          for (let rb = 0; rb < edgeSteps; rb++) {
            const f0 = tierSelfMorphed ? Math.min(1, (rb * rowPitch) / lenE) : (rb / edgeSteps);
            const f1 = tierSelfMorphed ? Math.min(1, ((rb + 1) * rowPitch) / lenE) : ((rb + 1) / edgeSteps);
            if (f1 - f0 < 1e-4) continue;
            const sY = baseElev + rb * riserH + 0.025;
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

          // Lowered & textured inter-stand aisle handrail (~0.68m)
          solid.addTexturedRailingRun(
            { x: ptEdge.inX, z: ptEdge.inZ }, baseElev,
            { x: ptEdgeTop.x, z: ptEdgeTop.z }, topElevE,
            0.68,
            {
              capColor: [0.46, 0.49, 0.53, 1.0],
              postColor: [0.32, 0.35, 0.39, 1.0],
              midColor: [0.42, 0.45, 0.49, 1.0],
              postSpacing: 3.6
            },
            alpha
          );
        }

        // 3. Recessed 3D Vomitory Tunnel Cutout (with complete 3D railings)
        if (hasVom && vomStartDeg > sDeg + 0.1 && vomEndDeg < eDeg - 0.1) {
          const vomMidDeg = (vomStartDeg + vomEndDeg) / 2;
          const vomEffRowsFloat = tierSelfMorphed
            ? getTierRowsAtAngleFloat(this.venue, tierIndex, tier, sec, vomMidDeg)
            : totalRows;
          const vomMaxIntRows = tierSelfMorphed ? Math.max(2, Math.floor(vomEffRowsFloat)) : totalRows;
          if (vomStartRow < vomMaxIntRows) {
            const actualEndRow = Math.min(vomMaxIntRows, vomEndRow);
            this.buildVomitoryRecess(
              solid,
              sec,
              tierIndex,
              vomStartDeg,
              vomEndDeg,
              vomStartRow,
              actualEndRow,
              vomEffRowsFloat,
              baseElev,
              riserH,
              handrailCol,
              isFrontConnected
            );
          }
        }

        // 4. Refined Architectural VIP Luxury Suites (half-walnut/half-glass dividers, coffered ceiling, warm cove lighting & lounge furnishings)
        if (isVip) {
          this.buildVipSuiteDetails(
            solid,
            alpha,
            screens,
            sec,
            tierIndex,
            sDeg,
            eDeg,
            baseElev,
            cornerAngles,
            tierHasMorph
          );
        }

        // 5. Fill stand rows with smooth-arc 3D Seats (VIP boxes render ONLY the single frontmost row of plush armchairs!)
        const stride = isVip ? 1 : globalSeatStride;
        const rowAngles = this.buildSectorAngleList(sDeg, eDeg, cornerAngles, null, tierHasMorph, tierIndex);
        const margin = isVip ? 0.55 : (radialAisleWidth * 0.55);
        const stepUnitW = isVip ? Math.max(0.72, seatSpacing * 1.25) : (seatSpacing * stride);
        let vipFrontFrac = 0.20;
        if (isVip) {
          const vipMidEdge = evalTierPoint(this.venue, tierIndex, (sDeg + eDeg) / 2, 0, sec.customRadialDepth);
          const vipDepth = Math.hypot(vipMidEdge.outX - vipMidEdge.inX, vipMidEdge.outZ - vipMidEdge.inZ);
          vipFrontFrac = Math.max(0.08, Math.min(0.28, 0.92 / Math.max(1.5, vipDepth)));
        }

        const isConcentricSeats = !isVip && tierSelfMorphed;
        const rowAngleEdges = isConcentricSeats
          ? rowAngles.map((deg) => {
            const p = evalTierPoint(this.venue, tierIndex, deg, 0, sec.customRadialDepth);
            const depth = Math.max(0.5, Math.hypot(p.outX - p.inX, p.outZ - p.inZ));
            return {
              deg,
              inX: p.inX,
              inZ: p.inZ,
              outX: p.outX,
              outZ: p.outZ,
              depth,
              maxRows: Math.max(2, Math.floor(depth / rowPitch + 0.35))
            };
          })
          : null;

        let seatRowCount = isVip ? 1 : rawMaxRows;
        if (isConcentricSeats && rowAngleEdges) {
          seatRowCount = 0;
          for (let i = 0; i < rowAngleEdges.length; i++) {
            if (rowAngleEdges[i].maxRows > seatRowCount) seatRowCount = rowAngleEdges[i].maxRows;
          }
        }

        const placeSeatsAlongRun = (r, runPts, runMarginStart, runMarginEnd) => {
          if (runPts.length < 2) return;
          const cumLen = [0];
          for (let k = 1; k < runPts.length; k++) {
            cumLen.push(cumLen[k - 1] + Math.hypot(runPts[k].x - runPts[k - 1].x, runPts[k].z - runPts[k - 1].z));
          }
          const totalArc = cumLen[cumLen.length - 1];
          const usableArc = totalArc - runMarginStart - runMarginEnd;
          if (usableArc <= 0.35) return;

          const seatsInRow = Math.max(1, Math.floor(usableArc / stepUnitW));
          const seatWFactor = 0.98;
          const seatDepthM = Math.min(0.48, rowPitch * 0.56);
          const seatRowElev = isVip ? baseElev : (baseElev + (r - 1) * riserH);

          let segIdx = 0;
          let cachedSegIdx = -1;
          let cachedSegNx = 0;
          let cachedSegNz = 0;
          let cachedSegHasNorm = false;

          for (let si = 0; si < seatsInRow; si++) {
            const targetS = runMarginStart + ((si + 0.5) / seatsInRow) * usableArc;
            while (segIdx < cumLen.length - 2 && cumLen[segIdx + 1] < targetS) {
              segIdx++;
            }
            const segLen = Math.max(1e-5, cumLen[segIdx + 1] - cumLen[segIdx]);
            const localT = Math.max(0, Math.min(1, (targetS - cumLen[segIdx]) / segLen));
            const pA = runPts[segIdx];
            const pB = runPts[segIdx + 1];
            const seatDeg = pA.deg + (pB.deg - pA.deg) * localT;

            // Skip seats inside carved Vomitory opening
            if (hasVom && vomEndRow >= vomStartRow && r >= vomStartRow && r <= vomEndRow && seatDeg >= vomStartDeg && seatDeg <= vomEndDeg) {
              continue;
            }

            let seatX, seatZ, ptNx, ptNz;
            if (isVip) {
              const exactPt = evalTierPoint(this.venue, tierIndex, seatDeg, vipFrontFrac, sec.customRadialDepth);
              seatX = exactPt.x;
              seatZ = exactPt.z;
              ptNx = exactPt.nx;
              ptNz = exactPt.nz;
            } else if (isConcentricSeats) {
              const ePt = evalTierPoint(this.venue, tierIndex, seatDeg, 0, sec.customRadialDepth);
              const eDepth = Math.max(0.5, Math.hypot(ePt.outX - ePt.inX, ePt.outZ - ePt.inZ));
              if ((r - 0.35) * rowPitch > eDepth) continue;
              const seatRowFrac = Math.min(0.98, ((r - 0.5) * rowPitch) / eDepth);
              seatX = ePt.inX + (ePt.outX - ePt.inX) * seatRowFrac;
              seatZ = ePt.inZ + (ePt.outZ - ePt.inZ) * seatRowFrac;
              ptNx = ePt.nx;
              ptNz = ePt.nz;
            } else {
              const seatRowFrac = totalRows > 1 ? (r - 0.5) / totalRows : 0.5;
              const exactPt = evalTierPoint(this.venue, tierIndex, seatDeg, seatRowFrac, sec.customRadialDepth);
              seatX = exactPt.x;
              seatZ = exactPt.z;
              ptNx = exactPt.nx;
              ptNz = exactPt.nz;
            }

            let fx, fz;
            if (!tierHasMorph && ((Math.abs(ptNx) > 0.999 && Math.abs(ptNz) < 1e-3) || (Math.abs(ptNz) > 0.999 && Math.abs(ptNx) < 1e-3))) {
              fx = -ptNx;
              fz = -ptNz;
            } else {
              if (cachedSegIdx !== segIdx) {
                cachedSegIdx = segIdx;
                const tdx = pB.x - pA.x;
                const tdz = pB.z - pA.z;
                const tLen = Math.hypot(tdx, tdz);
                if (tLen > 1e-4) {
                  let n1x = tdz / tLen;
                  let n1z = -tdx / tLen;
                  if (n1x * (-ptNx) + n1z * (-ptNz) < 0) {
                    n1x = -n1x;
                    n1z = -n1z;
                  }
                  cachedSegNx = n1x;
                  cachedSegNz = n1z;
                  cachedSegHasNorm = true;
                } else {
                  cachedSegHasNorm = false;
                }
              }
              if (cachedSegHasNorm) {
                fx = cachedSegNx;
                fz = cachedSegNz;
              } else {
                const inward = getRowInwardNormal(this.venue, tierIndex, seatDeg, 0.5, sec.customRadialDepth);
                fx = inward.x;
                fz = inward.z;
              }
            }

            if (isVip) {
              solid.addVipSeat3D(
                seatX,
                seatRowElev,
                seatZ,
                Math.min(0.68, stepUnitW * 0.88),
                0.58,
                fx,
                fz,
                panCol,
                backCol
              );
            } else {
              solid.addSeat3D(
                seatX,
                seatRowElev,
                seatZ,
                seatSpacing * seatWFactor,
                seatDepthM,
                fx,
                fz,
                panCol,
                backCol
              );
            }
          }
        };

        for (let r = 1; r <= seatRowCount; r++) {
          if (isConcentricSeats && rowAngleEdges) {
            const rowDistCenter = (r - 0.5) * rowPitch;
            const reqDepth = (r - 0.35) * rowPitch;
            let runPts = [];
            let runStartsAtEdge = true;
            for (let i = 0; i < rowAngleEdges.length; i++) {
              const e = rowAngleEdges[i];
              const inside = e.depth >= reqDepth;
              if (i > 0) {
                const prev = rowAngleEdges[i - 1];
                const prevInside = prev.depth >= reqDepth;
                if (inside !== prevInside) {
                  const t = Math.max(0, Math.min(1, (reqDepth - prev.depth) / (e.depth - prev.depth)));
                  const bDeg = prev.deg + (e.deg - prev.deg) * t;
                  const bPt = evalTierPoint(this.venue, tierIndex, bDeg, Math.min(0.98, rowDistCenter / Math.max(0.5, reqDepth)), sec.customRadialDepth);
                  if (prevInside) {
                    runPts.push({ deg: bDeg, x: bPt.x, z: bPt.z });
                    placeSeatsAlongRun(r, runPts, runStartsAtEdge ? margin : 0.35, 0.35);
                    runPts = [];
                  } else {
                    runStartsAtEdge = false;
                    runPts = [{ deg: bDeg, x: bPt.x, z: bPt.z }];
                  }
                }
              }
              if (inside) {
                if (runPts.length === 0) runStartsAtEdge = (i === 0);
                const f = Math.min(0.98, rowDistCenter / e.depth);
                runPts.push({
                  deg: e.deg,
                  x: e.inX + (e.outX - e.inX) * f,
                  z: e.inZ + (e.outZ - e.inZ) * f
                });
              }
            }
            if (runPts.length >= 2) {
              placeSeatsAlongRun(r, runPts, runStartsAtEdge ? margin : 0.35, margin);
            }
          } else {
            const rowFrac = isVip ? vipFrontFrac : (totalRows > 1 ? (r - 0.5) / totalRows : 0.5);
            const rowPts = rowAngles.map((deg) => {
              const p = evalTierPoint(this.venue, tierIndex, deg, rowFrac, sec.customRadialDepth);
              return { deg, x: p.x, z: p.z };
            });
            placeSeatsAlongRun(r, rowPts, margin, margin);
          }
        }
      });
      prevTierMorphed = tierSelfMorphed;
    });
  }

  buildVipSuiteDetails(solid, alpha, screens, sec, tierIndex, sDeg, eDeg, baseElev, cornerAngles, tierHasMorph) {
    const angularSpan = eDeg - sDeg;
    const pStart = evalTierPoint(this.venue, tierIndex, sDeg, 0, sec.customRadialDepth);
    const pEnd = evalTierPoint(this.venue, tierIndex, eDeg, 0, sec.customRadialDepth);
    const approxChord = Math.hypot(pEnd.inX - pStart.inX, pEnd.inZ - pStart.inZ);
    const rooms = (sec.vipBoxRooms && sec.vipBoxRooms > 0)
      ? sec.vipBoxRooms
      : Math.max(1, Math.min(6, Math.round(approxChord / 7.5)));

    const suiteH = 2.85;
    const walnutCol = [0.24, 0.17, 0.12, 1.0];
    const goldCol = [0.88, 0.72, 0.38, 1.0];
    const marbleCol = [0.82, 0.80, 0.76, 1.0];
    const sofaCol = [0.36, 0.24, 0.18, 1.0];
    const soffitCol = [0.58, 0.49, 0.36, 1.0];
    const roofTopCol = [0.16, 0.18, 0.24, 1.0];
    const warmCoveCol = [1.0, 0.89, 0.64, 1.0];

    // 1. Half-Walnut / Half-Smoked-Glass Suite Partition Walls with Champagne-Gold Mullions
    for (let rm = 0; rm <= rooms; rm++) {
      const rDeg = sDeg + (rm / rooms) * angularSpan;
      const ptR = evalTierPoint(this.venue, tierIndex, rDeg, 0, sec.customRadialDepth);
      const dxR = ptR.outX - ptR.inX;
      const dzR = ptR.outZ - ptR.inZ;
      const depthR = Math.hypot(dxR, dzR);
      if (depthR < 0.8) continue;
      const rotR = Math.atan2(dxR, dzR);

      // Rear solid walnut acoustic suite divider (40% -> 100% depth, full height)
      const splitFrac = 0.38;
      const rearLen = depthR * (1 - splitFrac);
      const rearMidFrac = (splitFrac + 1) * 0.5;
      solid.addBox(
        ptR.inX + dxR * rearMidFrac,
        baseElev + suiteH * 0.5,
        ptR.inZ + dzR * rearMidFrac,
        0.18,
        suiteH,
        rearLen,
        walnutCol,
        rotR
      );

      // Champagne-gold structural mullion pillar at balcony transition
      const pSplitX = ptR.inX + dxR * splitFrac;
      const pSplitZ = ptR.inZ + dzR * splitFrac;
      solid.addBox(pSplitX, baseElev + suiteH * 0.5, pSplitZ, 0.12, suiteH, 0.14, goldCol, rotR);

      // Front balcony stepped low walnut credenza + smoked glass privacy panel (3% -> 38% depth)
      const frontLen = depthR * (splitFrac - 0.03);
      const frontMidFrac = (0.03 + splitFrac) * 0.5;
      solid.addBox(
        ptR.inX + dxR * frontMidFrac,
        baseElev + 0.56,
        ptR.inZ + dzR * frontMidFrac,
        0.14,
        1.12,
        frontLen,
        walnutCol,
        rotR
      );
      if (alpha) {
        const g1 = { x: ptR.inX + dxR * 0.04, y: baseElev + 1.12, z: ptR.inZ + dzR * 0.04 };
        const g2 = { x: ptR.inX + dxR * splitFrac, y: baseElev + 1.12, z: ptR.inZ + dzR * splitFrac };
        const g3 = { x: g2.x, y: baseElev + 2.25, z: g2.z };
        const g4 = { x: g1.x, y: baseElev + 2.25, z: g1.z };
        alpha.addQuad(g1, g2, g3, g4, [0.72, 0.80, 0.88, 0.28]);
        solid.addBeam3D(g4, g3, 0.06, 0.06, goldCol);
      }
    }

    // 2. Interior Luxury Hospitality Furnishings (per suite room, behind front armchair row)
    for (let rm = 0; rm < rooms; rm++) {
      const midDeg = sDeg + ((rm + 0.5) / rooms) * angularSpan;
      const pA = evalTierPoint(this.venue, tierIndex, sDeg + (rm / rooms) * angularSpan, 0.55, sec.customRadialDepth);
      const pB = evalTierPoint(this.venue, tierIndex, sDeg + ((rm + 1) / rooms) * angularSpan, 0.55, sec.customRadialDepth);
      const roomW = Math.hypot(pB.x - pA.x, pB.z - pA.z);
      const ptMid = evalTierPoint(this.venue, tierIndex, midDeg, 0, sec.customRadialDepth);
      const dxM = ptMid.outX - ptMid.inX;
      const dzM = ptMid.outZ - ptMid.inZ;
      const depthM = Math.hypot(dxM, dzM);
      if (depthM < 2.4 || roomW < 2.2) continue;

      const rotM = Math.atan2(-dxM, -dzM);
      const barW = Math.min(roomW * 0.58, 3.4);

      // Sleek walnut & cream-marble hospitality bar counter behind front armchairs
      const barFrac = 0.54;
      const bx = ptMid.inX + dxM * barFrac;
      const bz = ptMid.inZ + dzM * barFrac;
      solid.addBox(bx, baseElev + 0.48, bz, barW, 0.94, 0.56, walnutCol, rotM);
      solid.addBox(bx, baseElev + 0.98, bz, barW + 0.08, 0.07, 0.64, marbleCol, rotM);

      // Plush rear lounge sofa + low marble coffee table when suite has comfortable lounge depth
      if (depthM >= 3.4) {
        const sofaFrac = 0.84;
        const sx = ptMid.inX + dxM * sofaFrac;
        const sz = ptMid.inZ + dzM * sofaFrac;
        const sofaW = Math.min(roomW * 0.62, 3.6);
        solid.addBox(sx, baseElev + 0.28, sz, sofaW, 0.44, 0.78, sofaCol, rotM);
        const dirLen = depthM || 1;
        const outNx = dxM / dirLen;
        const outNz = dzM / dirLen;
        solid.addBox(sx + outNx * 0.30, baseElev + 0.62, sz + outNz * 0.30, sofaW, 0.42, 0.20, sofaCol, rotM);
      }
    }

    // 3. Thick Coffered Overhead Canopy, Champagne-Gold Front Fascia & Glowing Warm Ceiling Cove Strip
    const vipAngles = this.buildSectorAngleList(sDeg, eDeg, cornerAngles, null, tierHasMorph, tierIndex);
    const canopyY = baseElev + suiteH;
    const roofTopY = canopyY + 0.34;
    for (let va = 0; va < vipAngles.length - 1; va++) {
      const pt1 = evalTierPoint(this.venue, tierIndex, vipAngles[va], 0, sec.customRadialDepth);
      const pt2 = evalTierPoint(this.venue, tierIndex, vipAngles[va + 1], 0, sec.customRadialDepth);
      const d1 = Math.hypot(pt1.outX - pt1.inX, pt1.outZ - pt1.inZ) || 1;
      const d2 = Math.hypot(pt2.outX - pt2.inX, pt2.outZ - pt2.inZ) || 1;
      const lip1 = Math.min(0.32, d1 * 0.10) / d1;
      const lip2 = Math.min(0.32, d2 * 0.10) / d2;

      const f1x = pt1.inX + (pt1.outX - pt1.inX) * lip1;
      const f1z = pt1.inZ + (pt1.outZ - pt1.inZ) * lip1;
      const f2x = pt2.inX + (pt2.outX - pt2.inX) * lip2;
      const f2z = pt2.inZ + (pt2.outZ - pt2.inZ) * lip2;

      // Warm coffered acoustic soffit ceiling
      solid.addQuad(
        { x: f1x, y: canopyY, z: f1z },
        { x: pt1.outX, y: canopyY, z: pt1.outZ },
        { x: pt2.outX, y: canopyY, z: pt2.outZ },
        { x: f2x, y: canopyY, z: f2z },
        soffitCol,
        { x: 0, y: -1, z: 0 }
      );
      // Charcoal exterior canopy roof slab
      solid.addQuad(
        { x: pt1.outX, y: roofTopY, z: pt1.outZ },
        { x: f1x, y: roofTopY, z: f1z },
        { x: f2x, y: roofTopY, z: f2z },
        { x: pt2.outX, y: roofTopY, z: pt2.outZ },
        roofTopCol,
        { x: 0, y: 1, z: 0 }
      );
      // Champagne-gold sculpted front canopy fascia beam
      solid.addQuad(
        { x: f1x, y: canopyY, z: f1z },
        { x: f1x, y: roofTopY, z: f1z },
        { x: f2x, y: roofTopY, z: f2z },
        { x: f2x, y: canopyY, z: f2z },
        goldCol
      );

      // Continuous recessed warm LED cove lighting strip tucked inside ceiling soffit
      if (screens && !(this.isLightsOffScene && this.isLightsOffScene())) {
        const coveIn1 = Math.min(0.55, d1 * 0.20) / d1;
        const coveOut1 = Math.min(0.82, d1 * 0.30) / d1;
        const coveIn2 = Math.min(0.55, d2 * 0.20) / d2;
        const coveOut2 = Math.min(0.82, d2 * 0.30) / d2;
        screens.addQuad(
          { x: pt1.inX + (pt1.outX - pt1.inX) * coveIn1, y: canopyY - 0.03, z: pt1.inZ + (pt1.outZ - pt1.inZ) * coveIn1 },
          { x: pt1.inX + (pt1.outX - pt1.inX) * coveOut1, y: canopyY - 0.03, z: pt1.inZ + (pt1.outZ - pt1.inZ) * coveOut1 },
          { x: pt2.inX + (pt2.outX - pt2.inX) * coveOut2, y: canopyY - 0.03, z: pt2.inZ + (pt2.outZ - pt2.inZ) * coveOut2 },
          { x: pt2.inX + (pt2.outX - pt2.inX) * coveIn2, y: canopyY - 0.03, z: pt2.inZ + (pt2.outZ - pt2.inZ) * coveIn2 },
          warmCoveCol,
          { x: 0, y: -1, z: 0 }
        );
      }
    }
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
        // Lowered & textured side safety rails on bridge (front & back open)
        const addRailRun = (pA, yA, pB, yB) => {
          solid.addTexturedRailingRun(pA, yA, pB, yB, 0.68, {
            capColor: [0.46, 0.49, 0.53, 1.0],
            postColor: [0.32, 0.35, 0.39, 1.0],
            midColor: [0.42, 0.45, 0.49, 1.0],
            postSpacing: 2.6
          });
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

      // Lowered & textured corridor side railings + upper portal edge guardrail (front exit remains 100% open!)
      const addCorridorRail = (pA, yA, pB, yB) => {
        solid.addTexturedRailingRun(pA, yA, pB, yB, 0.68, {
          capColor: [0.46, 0.49, 0.53, 1.0],
          postColor: [0.32, 0.35, 0.39, 1.0],
          midColor: [0.42, 0.45, 0.49, 1.0],
          postSpacing: 2.4
        });
      };
      addCorridorRail({ x: ptL0.inX, z: ptL0.inZ }, baseElev, ptL1, yBack);
      addCorridorRail({ x: ptR0.inX, z: ptR0.inZ }, baseElev, ptR1, yBack);
      if (vomEndRow < totalRows) {
        addCorridorRail(ptL1, yBack, ptR1, yBack);
      }
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
    // Lower exit mouth opens smoothly toward stand rows; recessed floor slopes down toward upper/back portal
    const floorFrontY = Math.max(0.15, yFront - 0.15);
    const floorBackY = Math.max(0.15, yFront - 1.55);

    // Sunken floor quad sloping down into the upper/back tunnel doorway
    solid.addQuad(
      { x: ptL_in.x, y: floorFrontY, z: ptL_in.z },
      { x: ptL_out.x, y: floorBackY, z: ptL_out.z },
      { x: ptR_out.x, y: floorBackY, z: ptR_out.z },
      { x: ptR_in.x, y: floorFrontY, z: ptR_in.z },
      pitFloorCol,
      { x: 0, y: 1, z: 0 }
    );

    // Smooth front threshold riser connecting lower row mouth down to passage floor
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

    // Lowered & textured 3-sided guardrail around recessed vomitory: Left, Right, and UPPER portal rim (exit mouth ptL_in->ptR_in stays 100% OPEN!)
    const addPitRail = (pA, yA, pB, yB) => {
      solid.addTexturedRailingRun(pA, yA, pB, yB, 0.68, {
        capColor: [0.46, 0.49, 0.53, 1.0],
        postColor: [0.32, 0.35, 0.39, 1.0],
        midColor: [0.42, 0.45, 0.49, 1.0],
        postSpacing: 2.2
      });
    };
    addPitRail(ptL_in, yFront, ptL_out, yBack);
    addPitRail(ptR_in, yFront, ptR_out, yBack);
    addPitRail(ptL_out, yBack, ptR_out, yBack);
  }

}
const StandMixin = {};
Object.getOwnPropertyNames(StandMixinHolder.prototype).forEach(k => {
  if (k !== 'constructor') StandMixin[k] = StandMixinHolder.prototype[k];
});
module.exports = { StandMixin };


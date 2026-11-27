/**
 * Concert Stage, Screen & Truss Mesh Builder Mixin
 */
const { DEG2RAD, rotateXZ, getStageTransform } = require('./schema-geometry');

class StageMixinHolder {
  buildConcertStageMesh(solid, screens, beams) {
    const infield = this.venue.infield;
    const stage = infield && infield.stageConfig;
    if (!stage) return;

    const st = getStageTransform(this.venue);
    const rotDeg = st.rotFromSouthDeg || 0;
    const rotRad = -rotDeg * DEG2RAD;

    const addStageBox = (lx, cy, lz, w, h, d, color, localRotYRad, targetBuilder) => {
      const wp = rotateXZ(lx, lz, rotDeg);
      (targetBuilder || solid).addBox(wp.x, cy, wp.z, w, h, d, color, (localRotYRad || 0) + rotRad);
    };
    const glowTarget = screens || solid;
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

    // Full-screen 100%-lit flowing aurora LED wall (unlit self-luminous vertex-colored surface)
    const evalAuroraColor = (u, v, phase) => {
      const ph = phase || 0;
      const band1 = 0.5 + 0.5 * Math.sin(u * 5.2 + v * 3.1 + ph);
      const band2 = 0.5 + 0.5 * Math.cos(u * 7.8 - v * 4.4 + ph * 1.35);
      const wave = 0.5 + 0.5 * Math.sin((u - 0.5) * 4.2 + Math.sin(v * 3.5 + ph) * 1.4);
      const ribbon = Math.pow(0.5 + 0.5 * Math.sin(u * 6.5 - v * 5.0 + ph * 0.8), 1.4);

      const r = Math.min(1.0, 0.24 + 0.44 * band2 + 0.34 * ribbon);
      const g = Math.min(1.0, 0.34 + 0.46 * band1 + 0.22 * wave);
      const b = Math.min(1.0, 0.68 + 0.32 * (1.0 - band2 * 0.45) + 0.18 * band1);
      return [r, g, b, 1.0];
    };

    const addDetailedLEDWall = (cx, baseY, cz, totalW, totalH, colsGrid, rowsGrid, localRotYRad, phaseOffset) => {
      const cosR = Math.cos(localRotYRad || 0);
      const sinR = Math.sin(localRotYRad || 0);
      const toLocal = (px, py, pz) => ({
        lx: cx + px * cosR + pz * sinR,
        y: baseY + totalH / 2 + py,
        lz: cz - px * sinR + pz * cosR
      });

      const blackFrame = [0.035, 0.04, 0.052, 1.0];
      const bezelCol = [0.10, 0.11, 0.14, 1.0];

      // Slim black structural LED cabinet housing & outer trim behind the luminous surface
      addStageBox(cx, baseY + totalH / 2, cz, totalW + 0.7, totalH + 0.6, 0.95, blackFrame, localRotYRad);
      addStageBox(cx, baseY + totalH + 0.20, cz, totalW + 0.9, 0.28, 1.15, bezelCol, localRotYRad);
      addStageBox(cx, baseY + 0.12, cz, totalW + 0.9, 0.24, 1.15, bezelCol, localRotYRad);

      // 100%-lit seamless flowing aurora canvas filling the entire LED surface edge-to-edge
      const faceZ = 0.54;
      const gCols = Math.max(8, colsGrid || 20);
      const gRows = Math.max(4, rowsGrid || 8);
      const gridPts = [];
      const gridCols = [];

      for (let r = 0; r <= gRows; r++) {
        const v = r / gRows;
        const py = (v - 0.5) * totalH;
        const rowPts = [];
        const rowCols = [];
        for (let c = 0; c <= gCols; c++) {
          const u = c / gCols;
          const px = (u - 0.5) * totalW;
          const lp = toLocal(px, py, faceZ);
          rowPts.push(rotPt(lp.lx, lp.y, lp.lz));
          rowCols.push(evalAuroraColor(u, v, phaseOffset));
        }
        gridPts.push(rowPts);
        gridCols.push(rowCols);
      }

      const normLocal = toLocal(0, 0, faceZ + 1);
      const normBase = toLocal(0, 0, faceZ);
      const wn1 = rotPt(normBase.lx, normBase.y, normBase.lz);
      const wn2 = rotPt(normLocal.lx, normLocal.y, normLocal.lz);
      const nVec = { x: wn2.x - wn1.x, y: wn2.y - wn1.y, z: wn2.z - wn1.z };

      for (let r = 0; r < gRows; r++) {
        for (let c = 0; c < gCols; c++) {
          screens.addVertexColoredQuad(
            gridPts[r][c], gridCols[r][c],
            gridPts[r][c + 1], gridCols[r][c + 1],
            gridPts[r + 1][c + 1], gridCols[r + 1][c + 1],
            gridPts[r + 1][c], gridCols[r + 1][c],
            nVec
          );
        }
      }
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
    const edgeStripMatteGray = [0.46, 0.49, 0.53, 1.0];

    const stageX = st.stageLocalX || 0;

    if (stage.type === 'center-stage') {
      const stageZ = st.stageLocalZ || 0;
      // Matte-black central stage + recessed matte-gray edge trim
      addStageBox(stageX, sh / 2, stageZ, sw, sh, sd, stageBlack, 0);
      addStageBox(stageX, sh + 0.04, stageZ, sw - 0.8, 0.08, sd - 0.8, stageDeckTop, 0);
      addStageBox(stageX, sh + 0.09, stageZ - sd / 2 + 0.22, sw, 0.08, 0.18, edgeStripMatteGray, 0, solid);
      addStageBox(stageX, sh + 0.09, stageZ + sd / 2 - 0.22, sw, 0.08, 0.18, edgeStripMatteGray, 0, solid);

      const clZ = st.catwalkLength || 0;
      const clX = st.catwalkLengthX || 0;
      if (clZ > 0.5) {
        addStageBox(stageX, sh / 2, stageZ - sd / 2 - clZ / 2, cw, sh, clZ, stageBlack, 0);
        addStageBox(stageX, sh / 2, stageZ + sd / 2 + clZ / 2, cw, sh, clZ, stageBlack, 0);
        addStageBox(stageX - cw / 2 + 0.1, sh + 0.05, stageZ - sd / 2 - clZ / 2, 0.12, 0.08, clZ, edgeStripMatteGray, 0, solid);
        addStageBox(stageX + cw / 2 - 0.1, sh + 0.05, stageZ - sd / 2 - clZ / 2, 0.12, 0.08, clZ, edgeStripMatteGray, 0, solid);
        addStageBox(stageX - cw / 2 + 0.1, sh + 0.05, stageZ + sd / 2 + clZ / 2, 0.12, 0.08, clZ, edgeStripMatteGray, 0, solid);
        addStageBox(stageX + cw / 2 - 0.1, sh + 0.05, stageZ + sd / 2 + clZ / 2, 0.12, 0.08, clZ, edgeStripMatteGray, 0, solid);
      }
      if (clX > 1.5) {
        addStageBox(stageX - sw / 2 - clX / 2, sh / 2, stageZ, clX, sh, cw, stageBlack, 0);
        addStageBox(stageX + sw / 2 + clX / 2, sh / 2, stageZ, clX, sh, cw, stageBlack, 0);
      }

      // Overhead matte-black truss rig & 4-sided glowing aurora LED cube
      const rigY = sh + backH * 0.78;
      const cubeW = sw * 0.56;
      const cubeH = backH * 0.52;
      const cubeD = sd * 0.56;
      addStageBox(stageX, rigY + cubeH + 0.6, stageZ, sw * 0.84, 0.9, sd * 0.84, trussBlack, 0);
      addStageBox(stageX, rigY + cubeH / 2, stageZ, cubeW, cubeH, cubeD, stageBlack, 0);
      addDetailedLEDWall(stageX, rigY, stageZ + cubeD / 2, cubeW * 0.94, cubeH * 0.92, 12, 6, 0, 0.2);
      addDetailedLEDWall(stageX, rigY, stageZ - cubeD / 2, cubeW * 0.94, cubeH * 0.92, 12, 6, Math.PI, 1.4);
      addDetailedLEDWall(stageX + cubeW / 2, rigY, stageZ, cubeD * 0.94, cubeH * 0.92, 12, 6, Math.PI / 2, 0.8);
      addDetailedLEDWall(stageX - cubeW / 2, rigY, stageZ, cubeD * 0.94, cubeH * 0.92, 12, 6, -Math.PI / 2, 2.0);

      const beamColors = [
        [0.35, 0.78, 1.0, 0.12],
        [1.0, 0.76, 0.36, 0.12],
        [0.62, 0.42, 0.98, 0.12]
      ];
      for (let i = 0; i < 12; i++) {
        const ang = (i / 12) * Math.PI * 2;
        const bx = stageX + Math.cos(ang) * (sw * 0.36);
        const bz = stageZ + Math.sin(ang) * (sd * 0.36);
        const tx = stageX + Math.cos(ang) * (sw * 0.95);
        const tz = stageZ + Math.sin(ang) * (sd * 0.95);
        addStageBox(bx, rigY + cubeH + 0.1, bz, 0.55, 0.55, 0.55, trussBrace, 0);
        addRefinedBeam(bx, rigY + cubeH, bz, tx, sh + 0.15, tz, 2.2, beamColors[i % beamColors.length]);
      }
      return;
    }

    // End-Stage or Festival-Stage: Strictly positioned per getStageTransform schema bounds
    const stageZ = st.stageLocalZ;
    const cl = st.catwalkLength || 0;

    // 1. Matte-black stage deck, recessed apron skirt & subtle dark trim
    addStageBox(stageX, sh / 2, stageZ, sw, sh, sd, stageBlack, 0);
    addStageBox(stageX, sh + 0.04, stageZ, sw - 0.8, 0.08, sd - 0.8, stageDeckTop, 0);
    addStageBox(stageX, sh + 0.06, stageZ + sd / 2 - 0.18, sw, 0.10, 0.24, stageTrim, 0);

    // Subtle matte-gray front stage trim & stage access stairs on left/right wings
    addStageBox(stageX, sh + 0.11, stageZ + sd / 2 - 0.16, sw * 0.88, 0.06, 0.10, edgeStripMatteGray, 0, solid);
    addStageBox(stageX - sw / 2 - 1.2, sh * 0.38, stageZ + sd * 0.2, 2.4, sh * 0.76, 3.6, stageBlack, 0);
    addStageBox(stageX + sw / 2 + 1.2, sh * 0.38, stageZ + sd * 0.2, 2.4, sh * 0.76, 3.6, stageBlack, 0);

    // 2. Matte-black Catwalk & B-Stage strictly bounded within st.catwalkLength (omitted when catwalkLength === 0)
    const bStageD = cl > 0.5 ? Math.min(5.2, cl * 0.35) : 0;
    const bStageZ = cl > 0.5 ? (stageZ + sd / 2 + cl - bStageD / 2) : (stageZ + sd * 0.65);
    if (cl > 0.5) {
      const catZ = stageZ + sd / 2 + cl / 2;
      addStageBox(stageX, sh / 2, catZ, cw, sh, cl, stageBlack, 0);
      addStageBox(stageX, sh + 0.04, catZ, cw - 0.4, 0.08, cl, stageDeckTop, 0);
      addStageBox(stageX - cw / 2 + 0.10, sh + 0.09, catZ, 0.12, 0.06, cl, edgeStripMatteGray, 0, solid);
      addStageBox(stageX + cw / 2 - 0.10, sh + 0.09, catZ, 0.12, 0.06, cl, edgeStripMatteGray, 0, solid);

      addStageBox(stageX, sh / 2, bStageZ, cw * 2.2, sh, bStageD, stageBlack, 0);
      addStageBox(stageX, sh + 0.04, bStageZ, cw * 2.0, 0.08, Math.max(1.2, bStageD - 0.4), stageDeckTop, 0);
      addStageBox(stageX, sh + 0.09, bStageZ + bStageD / 2 - 0.08, cw * 2.1, 0.06, 0.12, edgeStripMatteGray, 0, solid);
    }

    // 3. Full-Lit Flowing Aurora Main LED Backdrop & Angled Side IMAG Wing Screens
    const screenZ = stageZ - sd / 2 + 2.0;
    addDetailedLEDWall(stageX, sh + 0.4, screenZ, sw * 0.90, backH * 0.94, 24, 10, 0, 0.35);

    const wingW = sw * 0.34;
    const wingH = backH * 0.82;
    addDetailedLEDWall(stageX - sw * 0.66, sh + 0.8, screenZ + 4.2, wingW, wingH, 12, 8, 0.38, 1.55);
    addDetailedLEDWall(stageX + sw * 0.66, sh + 0.8, screenZ + 4.2, wingW, wingH, 12, 8, -0.38, 2.75);

    // 4. Matte-Black Overhead Box Truss Rig, Vertical Towers & Hanging PA Line-Array Speakers
    const trussH = sh + backH + 1.4;
    const frontTrussZ = stageZ + sd * 0.42;
    const midTrussZ = stageZ;
    const backTrussZ = stageZ - sd * 0.42;

    addStageBox(stageX - sw * 0.48, trussH / 2, backTrussZ, 1.0, trussH, 1.0, trussBlack, 0);
    addStageBox(stageX + sw * 0.48, trussH / 2, backTrussZ, 1.0, trussH, 1.0, trussBlack, 0);
    addStageBox(stageX - sw * 0.48, trussH / 2, frontTrussZ, 1.0, trussH, 1.0, trussBlack, 0);
    addStageBox(stageX + sw * 0.48, trussH / 2, frontTrussZ, 1.0, trussH, 1.0, trussBlack, 0);

    addStageBeam(stageX - sw * 0.50, trussH, frontTrussZ, stageX + sw * 0.50, trussH, frontTrussZ, 0.75, 0.95, trussBlack);
    addStageBeam(stageX - sw * 0.50, trussH, midTrussZ, stageX + sw * 0.50, trussH, midTrussZ, 0.65, 0.85, trussBlack);
    addStageBeam(stageX - sw * 0.50, trussH, backTrussZ, stageX + sw * 0.50, trussH, backTrussZ, 0.75, 0.95, trussBlack);
    addStageBeam(stageX - sw * 0.48, trussH, backTrussZ, stageX - sw * 0.48, trussH, frontTrussZ, 0.75, 0.95, trussBlack);
    addStageBeam(stageX + sw * 0.48, trussH, backTrussZ, stageX + sw * 0.48, trussH, frontTrussZ, 0.75, 0.95, trussBlack);
    addStageBeam(stageX, trussH, backTrussZ, stageX, trussH, frontTrussZ, 0.55, 0.75, trussBrace);
    addStageBeam(stageX - sw * 0.48, trussH - 0.5, backTrussZ + 1.5, stageX - sw * 0.66, sh + wingH + 1.0, screenZ + 4.2, 0.55, 0.65, trussBlack);
    addStageBeam(stageX + sw * 0.48, trussH - 0.5, backTrussZ + 1.5, stageX + sw * 0.66, sh + wingH + 1.0, screenZ + 4.2, 0.55, 0.65, trussBlack);

    // Curved matte-black PA Line-Array Speaker Hangs flanking main stage front
    [-sw * 0.44, sw * 0.44].forEach((sx) => {
      for (let k = 0; k < 5; k++) {
        addStageBox(stageX + sx, trussH - 1.4 - k * 0.72, frontTrussZ + 0.6 + k * 0.14, 1.8, 0.58, 1.1, speakerCol, k * 0.04);
      }
    });

    // 5. Matte-Black FOH Sound & Lighting Control Tower at schema fohDistance
    if (stage.fohEnabled) {
      const fohZ = st.fohLocalZ;
      const fw = stage.fohWidth || 8;
      const fd = stage.fohDepth || 5;
      addStageBox(stageX, 1.3, fohZ, fw, 2.6, fd, stageBlack, 0);
      addStageBox(stageX, 2.75, fohZ, fw * 0.85, 0.35, fd * 0.45, trussBrace, 0);
      addStageBox(stageX, 3.05, fohZ - fd * 0.15, fw * 0.55, 0.28, 0.45, [0.16, 0.62, 0.92, 1.0], 0);
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

    const frontPods = 9;
    for (let i = 0; i < frontPods; i++) {
      const frac = (i / (frontPods - 1)) - 0.5;
      const fx = stageX + frac * sw * 0.84;
      const podY = trussH - 0.65;
      addStageBox(fx, podY, frontTrussZ, 0.55, 0.55, 0.55, trussBrace, 0);
      addStageBox(fx, podY - 0.32, frontTrussZ + 0.1, 0.32, 0.18, 0.32, lensPalette[i % lensPalette.length], 0, glowTarget);

      const targetZ = (i % 3 === 1) ? bStageZ : (stageZ + sd * 0.55 + (i % 2) * 8);
      const targetX = stageX + frac * sw * 0.95;
      addRefinedBeam(fx, podY - 0.35, frontTrussZ + 0.1, targetX, sh + 0.15, targetZ, 2.1, beamPalette[i % beamPalette.length]);
    }

    const sidePods = 4;
    for (let i = 0; i < sidePods; i++) {
      const frac = (i / (sidePods - 1)) - 0.5;
      const bx = stageX + frac * sw * 0.72;
      const podY = trussH - 0.55;
      addStageBox(bx, podY, midTrussZ, 0.50, 0.48, 0.50, trussBrace, 0);
      addStageBox(bx, podY - 0.28, midTrussZ, 0.28, 0.16, 0.28, lensPalette[(i + 1) % lensPalette.length], 0, glowTarget);
      addRefinedBeam(bx, podY - 0.3, midTrussZ, stageX - (bx - stageX) * 0.6, sh + 0.15, stageZ + sd * 0.25, 2.4, beamPalette[(i + 1) % beamPalette.length]);
    }
  }
}
const StageMixin = {};
Object.getOwnPropertyNames(StageMixinHolder.prototype).forEach(k => {
  if (k !== 'constructor') StageMixin[k] = StageMixinHolder.prototype[k];
});
module.exports = { StageMixin };


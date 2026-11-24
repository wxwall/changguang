/**
 * 3D Stadium Angular Discretization Mixin
 */
const { getInfieldCornerTransitionAngles, evalTierPoint } = require('./schema-geometry');

class AngleMixinHolder {
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
        const inf = this.venue.infield;
        if (inf && inf.shape === 'ellipse') {
          isCurved = true; // 椭圆周界处处弯曲，不按直边稀疏采样
        } else {
          const pMid = evalTierPoint(this.venue, tIdx, (a + b) / 2, 0.5);
          // Straight infield edges have exact axis-aligned normals (±1, 0) or (0, ±1)
          const onStraight = (Math.abs(pMid.nx) > 0.999 && Math.abs(pMid.nz) < 1e-3) ||
                             (Math.abs(pMid.nz) > 0.999 && Math.abs(pMid.nx) < 1e-3);
          isCurved = !onStraight;
        }
      }
      const stepSize = isCurved ? 1.5 : 8.0;
      const nSub = Math.max(isCurved ? 2 : 1, Math.ceil(subSpan / stepSize));
      for (let k = 1; k <= nSub; k++) {
        out.push(a + subSpan * (k / nSub));
      }
    }
    return out;
  }
}
const AngleMixin = {};
Object.getOwnPropertyNames(AngleMixinHolder.prototype).forEach(k => {
  if (k !== 'constructor') AngleMixin[k] = AngleMixinHolder.prototype[k];
});
module.exports = { AngleMixin };


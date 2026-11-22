/**
 * STADIACAD Per-Tier Stadium Seat Color Palette & Conversion Utilities
 * Pure CommonJS for WeChat Mini Program (shared by Renderer3D, Renderer2D & Page UI)
 */

const DEFAULT_TIER_HEX = {
  '1': '#2B5EB8',
  '2': '#178063',
  '3': '#AD7A29',
  '4': '#6645AD',
  vip: '#B8842E',
  floor: '#2E6BC2'
};

const SEAT_COLOR_SWATCHES = [
  { name: '皇家蓝', hex: '#2B5EB8' },
  { name: '中国红', hex: '#C82834' },
  { name: '翡翠绿', hex: '#178063' },
  { name: '琥珀金', hex: '#B87D28' },
  { name: '极光紫', hex: '#6645AD' },
  { name: '宝石青', hex: '#0E7490' },
  { name: '落日橙', hex: '#D95B26' },
  { name: '玫瑰红', hex: '#BE3B6E' },
  { name: '尊享酒红', hex: '#7F1D3A' },
  { name: '深空灰', hex: '#475569' },
  { name: '钛银灰', hex: '#8899AE' },
  { name: '曜石黑', hex: '#263244' }
];

const SEAT_THEME_PRESETS = [
  {
    id: 'default',
    name: '经典分区',
    colors: {}
  },
  {
    id: 'china-red',
    name: '中国红',
    colors: {
      '1': '#C82834',
      '2': '#9E1F2A',
      '3': '#D4383E',
      '4': '#7F1D3A',
      vip: '#B87D28',
      floor: '#2B5EB8'
    }
  },
  {
    id: 'royal-blue',
    name: '欧冠蓝金',
    colors: {
      '1': '#1D4ED8',
      '2': '#2B5EB8',
      '3': '#B87D28',
      '4': '#0E7490',
      vip: '#B87D28',
      floor: '#0E7490'
    }
  },
  {
    id: 'emerald',
    name: '翡翠森林',
    colors: {
      '1': '#178063',
      '2': '#0E7490',
      '3': '#15803D',
      '4': '#475569',
      vip: '#B87D28',
      floor: '#178063'
    }
  }
];

function parseHexRgb(hex) {
  if (typeof hex !== 'string') return null;
  const clean = hex.trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return null;
  const num = parseInt(clean, 16);
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255
  };
}

function rgbToHex(r, g, b) {
  const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
  const toHex = (v) => clamp(v).toString(16).padStart(2, '0').toUpperCase();
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Converts hex color to matte 3D seat pan & slightly darker backrest RGBA vectors.
 */
function hexToSeat3D(hex) {
  const rgb = parseHexRgb(hex);
  if (!rgb) return null;
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  return {
    pan: [r, g, b, 1.0],
    back: [r * 0.80, g * 0.80, b * 0.80, 1.0]
  };
}

/**
 * Converts hex color to harmonious 2D seatmap fill, crisp lighter border & label color.
 */
function hexToSeat2D(hex) {
  const rgb = parseHexRgb(hex);
  if (!rgb) return null;
  const base = rgbToHex(rgb.r * 0.82, rgb.g * 0.82, rgb.b * 0.82);
  const stroke = rgbToHex(
    rgb.r + (255 - rgb.r) * 0.42,
    rgb.g + (255 - rgb.g) * 0.42,
    rgb.b + (255 - rgb.b) * 0.42
  );
  return {
    base,
    stroke,
    label: '#F8FAFC'
  };
}

function getDefaultHexForTarget(key, isVipTier) {
  if (isVipTier) return DEFAULT_TIER_HEX.vip;
  if (DEFAULT_TIER_HEX[String(key)]) return DEFAULT_TIER_HEX[String(key)];
  const idx = ((Number(key) || 1) - 1) % 4;
  return DEFAULT_TIER_HEX[String(idx + 1)] || DEFAULT_TIER_HEX['1'];
}

module.exports = {
  DEFAULT_TIER_HEX,
  SEAT_COLOR_SWATCHES,
  SEAT_THEME_PRESETS,
  parseHexRgb,
  hexToSeat3D,
  hexToSeat2D,
  getDefaultHexForTarget
};

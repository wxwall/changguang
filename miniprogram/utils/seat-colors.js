/**
 * 场馆看台、地面、外墙、屋顶与天空全维度配色系统与转换工具
 * Pure CommonJS for WeChat Mini Program (shared by Renderer3D, Renderer2D & Page UI)
 */

const DEFAULT_TIER_HEX = {
  '1': '#2B5EB8',
  '2': '#178063',
  '3': '#AD7A29',
  '4': '#6645AD',
  vip: '#B8842E',
  floor: '#2E6BC2',
  sky: '#0A0F1D',       // 天空：支持纯黑(#000000)及浅色系，浅色为主
  roof: '#1E293B',      // 屋顶：深色为主
  wall: '#CBD5E1',      // 外墙：浅色为主
  ground: '#0F172A'     // 地面：深色为主
};

// 维度专属定制色板：实物以颜色深为主，天空外墙以浅色为主，天空增加纯黑选项
const TARGET_COLOR_SWATCHES = {
  sky: [
    { name: '纯黑夜空', hex: '#000000' },
    { name: '晨曦浅蓝', hex: '#BAE6FD' },
    { name: '晴空浅青', hex: '#7DD3FC' },
    { name: '柔光天蓝', hex: '#E0F2FE' },
    { name: '象牙暖白', hex: '#F8FAFC' },
    { name: '极地浅灰', hex: '#CBD5E1' },
    { name: '暮霞浅粉', hex: '#FCE7F3' },
    { name: '暮紫浅霞', hex: '#E9D5FF' },
    { name: '薄荷浅青', hex: '#A7F3D0' },
    { name: '深邃夜空', hex: '#0A0F1D' }
  ],
  wall: [
    { name: '纯净象牙', hex: '#F8FAFC' },
    { name: '钛金浅灰', hex: '#E2E8F0' },
    { name: '浅银铝板', hex: '#CBD5E1' },
    { name: '清水浅灰', hex: '#94A3B8' },
    { name: '浅香槟金', hex: '#FEF3C7' },
    { name: '暖砂浅米', hex: '#F5F5F4' },
    { name: '科技淡蓝', hex: '#E0E7FF' },
    { name: '极光淡青', hex: '#CCFBF1' },
    { name: '曜石深灰', hex: '#334155' },
    { name: '沉稳玄武', hex: '#1E293B' }
  ],
  roof: [
    { name: '曜石玄黑', hex: '#0F172A' },
    { name: '碳素深灰', hex: '#1E293B' },
    { name: '钛金深灰', hex: '#334155' },
    { name: '工业铁灰', hex: '#475569' },
    { name: '深海绀蓝', hex: '#1E3A5F' },
    { name: '哑光暗红', hex: '#4C1D24' },
    { name: '深林墨绿', hex: '#143528' },
    { name: '玄武暗灰', hex: '#27272A' },
    { name: '铝镁中灰', hex: '#64748B' },
    { name: '金属银白', hex: '#CBD5E1' }
  ],
  ground: [
    { name: '曜石暗夜', hex: '#0B0F19' },
    { name: '沥青玄黑', hex: '#111827' },
    { name: '沉稳深灰', hex: '#1E293B' },
    { name: '墨夜暗蓝', hex: '#0F172A' },
    { name: '玄武铁灰', hex: '#334155' },
    { name: '墨绿草坪', hex: '#132A22' },
    { name: '暗砖红坪', hex: '#2E1418' },
    { name: '斑驳冷灰', hex: '#475569' },
    { name: '石板青灰', hex: '#1F2937' },
    { name: '广场暖灰', hex: '#64748B' }
  ],
  seats: [
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
  ]
};

const SEAT_COLOR_SWATCHES = TARGET_COLOR_SWATCHES.seats;

function getSwatchesForTarget(key) {
  if (TARGET_COLOR_SWATCHES[key]) {
    return TARGET_COLOR_SWATCHES[key];
  }
  return TARGET_COLOR_SWATCHES.seats;
}

const SEAT_THEME_PRESETS = [
  {
    id: 'default',
    name: '经典分区',
    colors: {}
  },
  {
    id: 'pure-black-sky',
    name: '纯黑夜空',
    colors: {
      sky: '#000000',
      roof: '#0F172A',
      wall: '#E2E8F0',
      ground: '#0B0F19'
    }
  },
  {
    id: 'daylight',
    name: '晨曦晴空',
    colors: {
      sky: '#BAE6FD',
      roof: '#334155',
      wall: '#F8FAFC',
      ground: '#1E293B'
    }
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
      floor: '#2B5EB8',
      sky: '#0A0F1D',
      roof: '#4C1D24',
      wall: '#F1F5F9',
      ground: '#181216'
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
      floor: '#0E7490',
      sky: '#0A0F1D',
      roof: '#1E3A5F',
      wall: '#E2E8F0',
      ground: '#0F172A'
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
      floor: '#178063',
      sky: '#0A0F1D',
      roof: '#143528',
      wall: '#F8FAFC',
      ground: '#0B1412'
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
  TARGET_COLOR_SWATCHES,
  SEAT_COLOR_SWATCHES,
  SEAT_THEME_PRESETS,
  getSwatchesForTarget,
  parseHexRgb,
  rgbToHex,
  hexToSeat3D,
  hexToSeat2D,
  getDefaultHexForTarget
};

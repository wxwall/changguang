/**
 * 微信云开发数据库场馆服务
 * 集合名称: stadiumProjects
 */

const { normalizeVenueCoordinates } = require('../utils/schema-geometry');

const MAX_PAGE_LIMIT = 20;
const VENUE_CACHE_TTL_MS = 60 * 1000;
let _cachedVenues = null;
let _cachedAt = 0;
let _allVenuesCached = false;
let _cachedVenueList = null;
let _cachedListAt = 0;

const SUMMARY_FIELDS = {
  _id: true,
  id: true,
  name: true,
  shortLabel: true,
  capLabel: true,
  code: true,
  city: true,
  cityName: true,
  province: true,
  region: true,
  location: true,
  address: true,
  description: true,
  tierCount: true,
  engineeringSummary: true,
  updatedAt: true,
  'schema.id': true,
  'schema.name': true,
  'schema.shortLabel': true,
  'schema.capLabel': true,
  'schema.code': true,
  'schema.city': true,
  'schema.cityName': true,
  'schema.province': true,
  'schema.region': true,
  'schema.location': true,
  'schema.address': true,
  'schema.tierCount': true,
  'schema.engineeringSummary': true,
  'data.id': true,
  'data.name': true,
  'data.shortLabel': true,
  'data.code': true,
  'data.city': true,
  'data.engineeringSummary': true,
  'project.id': true,
  'project.name': true,
  'project.shortLabel': true,
  'project.code': true,
  'project.city': true,
  'project.engineeringSummary': true
};

const KNOWN_CITIES = [
  '呼和浩特', '乌鲁木齐', '齐齐哈尔', '克拉玛依', '鄂尔多斯',
  '石家庄', '秦皇岛', '张家口', '连云港', '景德镇', '马鞍山', '攀枝花', '六盘水', '日喀则', '佳木斯', '牡丹江', '哈尔滨',
  '北京', '上海', '广州', '深圳', '杭州', '成都', '重庆', '武汉', '西安', '南京', '苏州', '天津', '长沙', '郑州',
  '济南', '青岛', '大连', '沈阳', '长春', '福州', '厦门', '合肥', '南昌', '昆明', '贵阳', '南宁', '海口', '三亚',
  '兰州', '银川', '西宁', '太原', '拉萨', '香港', '澳门', '台北',
  '佛山', '东莞', '珠海', '中山', '惠州', '江门', '湛江', '茂名', '肇庆', '梅州', '清远',
  '无锡', '常州', '徐州', '南通', '扬州', '镇江', '盐城', '泰州',
  '宁波', '温州', '绍兴', '嘉兴', '湖州', '金华', '台州', '丽水', '衢州', '舟山',
  '泉州', '漳州', '莆田', '龙岩', '烟台', '潍坊', '临沂', '淄博', '济宁', '威海', '泰安',
  '洛阳', '开封', '南阳', '宜昌', '襄阳', '荆州', '岳阳', '常德', '衡阳', '株洲', '湘潭',
  '绵阳', '宜宾', '泸州', '南充', '遵义', '柳州', '桂林', '北海', '芜湖', '安庆', '赣州', '九江', '上饶',
  '保定', '唐山', '廊坊', '邯郸', '沧州', '大同', '包头', '鞍山', '抚顺', '吉林', '延吉', '大庆',
  '咸阳', '宝鸡', '榆林', '天水'
];

const CODE_CITY_PREFIX_MAP = {
  BJ: '北京',
  SH: '上海',
  GZ: '广州',
  SZ: '深圳',
  HZ: '杭州',
  CD: '成都',
  CQ: '重庆',
  WH: '武汉',
  XA: '西安',
  NJ: '南京',
  TJ: '天津',
  CS: '长沙',
  ZZ: '郑州'
};

const LANDMARK_CITY_MAP = {
  '鸟巢': '北京',
  '水立方': '北京',
  '工体': '北京',
  '五棵松': '北京',
  '大莲花': '杭州',
  '凤凰山': '成都',
  '大运中心': '深圳',
  '八万人': '上海',
  '虹口': '上海',
  '梅奔': '上海'
};

function normalizeCityName(rawCity) {
  if (!rawCity || typeof rawCity !== 'string') return '';
  let trimmed = rawCity.trim();
  if (!trimmed) return '';
  if (trimmed.length > 2 && trimmed.endsWith('市')) {
    trimmed = trimmed.slice(0, -1);
  }
  return trimmed;
}

function extractCityFromVenue(raw) {
  if (!raw || typeof raw !== 'object') return '其他';

  const directCandidates = [
    raw.city,
    raw.cityName,
    raw.location && typeof raw.location === 'object' ? raw.location.city : '',
    raw.address && typeof raw.address === 'object' ? raw.address.city : ''
  ];
  for (const cand of directCandidates) {
    const normalized = normalizeCityName(cand);
    if (normalized) return normalized;
  }

  const provinceCity = normalizeCityName(raw.province || raw.region);
  if (['北京', '上海', '天津', '重庆', '香港', '澳门'].includes(provinceCity)) {
    return provinceCity;
  }

  const textPool = [
    raw.name,
    raw.shortLabel,
    typeof raw.address === 'string' ? raw.address : '',
    typeof raw.location === 'string' ? raw.location : '',
    raw.description
  ].filter(Boolean).join(' ');

  for (const city of KNOWN_CITIES) {
    if (textPool.includes(city)) {
      return city;
    }
  }

  for (const landmark of Object.keys(LANDMARK_CITY_MAP)) {
    if (textPool.includes(landmark)) {
      return LANDMARK_CITY_MAP[landmark];
    }
  }

  const code = String(raw.code || '').trim().toUpperCase();
  const prefix = code.split(/[-_]/)[0];
  if (prefix && CODE_CITY_PREFIX_MAP[prefix]) {
    return CODE_CITY_PREFIX_MAP[prefix];
  }

  return '其他';
}

/**
 * 尝试将字符串解析为 JSON 对象，若非 JSON 字符串则返回原值
 */
function parseIfJson(val) {
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        return JSON.parse(trimmed);
      } catch (e) {
        return null;
      }
    }
  }
  return val;
}

/**
 * 规范化看台数组：支持原生数组、JSON 字符串、或键为索引的对象格式
 */
function normalizeTiers(val) {
  val = parseIfJson(val);
  if (Array.isArray(val)) return val;
  if (val && typeof val === 'object') {
    const vals = Object.values(val);
    if (vals.length > 0 && typeof vals[0] === 'object') {
      return vals;
    }
  }
  return null;
}

/**
 * 从云文档中智能解析出真实的场馆数据对象
 * 支持直接存储、嵌套在 schema/project/data/content/projectData/stadiumData/venue 字段
 * 且兼顾对象或 JSON 字符串序列化存储形式
 */
function resolveRawVenue(doc) {
  if (!doc || typeof doc !== 'object') return null;

  const candidates = [
    parseIfJson(doc.schema),
    parseIfJson(doc.project),
    parseIfJson(doc.data),
    parseIfJson(doc.content),
    parseIfJson(doc.projectData),
    parseIfJson(doc.stadiumData),
    parseIfJson(doc.venue),
    doc.data && typeof doc.data === 'object' && parseIfJson(doc.data.schema),
    doc.project && typeof doc.project === 'object' && parseIfJson(doc.project.schema),
    doc
  ];

  // 1. 第一优先级：寻找包含非空看台（standTiers / stands / tiers / stand_tiers）的完整场馆模型
  for (const c of candidates) {
    if (c && typeof c === 'object') {
      const tiers = normalizeTiers(c.standTiers) ||
                    normalizeTiers(c.stands) ||
                    normalizeTiers(c.tiers) ||
                    normalizeTiers(c.stand_tiers);
      if (tiers && tiers.length > 0) {
        return {
          ...doc,
          ...c,
          standTiers: tiers,
          infield: parseIfJson(c.infield) || parseIfJson(doc.infield),
          engineeringSummary: c.engineeringSummary || doc.engineeringSummary,
          _id: doc._id
        };
      }
    }
  }

  // 2. 第二优先级：包含有效内场的候选对象
  for (const c of candidates) {
    if (c && typeof c === 'object') {
      const inf = parseIfJson(c.infield);
      if (inf && typeof inf === 'object') {
        const tiers = normalizeTiers(c.standTiers) ||
                      normalizeTiers(c.stands) ||
                      normalizeTiers(c.tiers) ||
                      normalizeTiers(c.stand_tiers) || [];
        return {
          ...doc,
          ...c,
          infield: inf,
          standTiers: tiers,
          _id: doc._id
        };
      }
    }
  }

  // 3. 兜底
  return { ...doc, _id: doc._id };
}

/**
 * 提取并规范化云数据库文档中的场馆数据
 */
function extractVenueDoc(doc) {
  if (!doc || typeof doc !== 'object') return null;

  const raw = resolveRawVenue(doc);
  if (!raw) {
    console.warn('[DEBUG-stadium-cloud] 跳过无效或空项目文档:', doc._id, Object.keys(doc));
    return null;
  }

  // 确保具备有效 id
  const venueId = raw.id || doc.id || doc._id;
  if (!venueId && !raw.name) {
    return null;
  }

  // 确保具备基础 infield 结构，防止由于内场字段缺失导致几何与视线计算崩溃
  if (!raw.infield || typeof raw.infield !== 'object') {
    raw.infield = {
      shape: 'rounded-rect',
      length: 105,
      width: 68,
      cornerRadius: 15,
      stageConfig: {}
    };
  } else if (!raw.infield.stageConfig || typeof raw.infield.stageConfig !== 'object') {
    raw.infield.stageConfig = {};
  }

  // 确保 standTiers 为数组
  if (!Array.isArray(raw.standTiers)) {
    raw.standTiers = normalizeTiers(raw.standTiers) || [];
  }

  // 坐标系归一化换算（使舞台与区块坐标适配引擎）
  const normalized = normalizeVenueCoordinates(raw);

  // 提取容量及代号用于顶部 Tab 胶囊展示
  let totalCap = normalized.engineeringSummary && normalized.engineeringSummary.totalCapacity;
  if (!totalCap && Array.isArray(normalized.standTiers)) {
    // 若 engineeringSummary 缺失，自动统计看台总座位数
    totalCap = normalized.standTiers.reduce((acc, tier) => {
      const secRows = (tier.sectors || []).reduce((sAcc, sec) => sAcc + (sec.rows || tier.defaultRows || 20) * (sec.seatSpacing ? Math.round(18 / sec.seatSpacing) : 25), 0);
      return acc + secRows;
    }, 0);
  }

  const capText = typeof totalCap === 'number' && totalCap > 0
    ? `${(totalCap / 1000).toFixed(1)}k座`
    : '场馆';
  const codeText = normalized.code || (venueId ? String(venueId).toUpperCase() : '');
  const shortLabel = (normalized.name || '场馆').split(' ')[0];
  const capLabel = codeText ? `${codeText} · ${capText}` : capText;

  return {
    ...normalized,
    id: venueId,
    _id: doc._id || venueId,
    shortLabel,
    capLabel,
    city: extractCityFromVenue(normalized)
  };
}

/**
 * 提取轻量场馆摘要（不包含 standTiers/infield 等全量 Schema）
 */
function extractVenueSummary(doc) {
  if (!doc || typeof doc !== 'object') return null;

  const nested = [doc.schema, doc.project, doc.data, doc.venue].find(
    item => item && typeof item === 'object' && !Array.isArray(item)
  );
  const raw = nested ? { ...nested, ...doc } : doc;

  const venueId = raw.id || doc.id || doc._id;
  if (!venueId && !raw.name) {
    return null;
  }

  let totalCap = raw.engineeringSummary && raw.engineeringSummary.totalCapacity;
  if (!totalCap && Array.isArray(raw.standTiers)) {
    totalCap = raw.standTiers.reduce((acc, tier) => {
      const secRows = (tier.sectors || []).reduce((sAcc, sec) => sAcc + (sec.rows || tier.defaultRows || 20) * (sec.seatSpacing ? Math.round(18 / sec.seatSpacing) : 25), 0);
      return acc + secRows;
    }, 0);
  }

  const capText = typeof totalCap === 'number' && totalCap > 0
    ? `${(totalCap / 1000).toFixed(1)}k座`
    : '场馆';
  const codeText = raw.code || (venueId ? String(venueId).toUpperCase() : '');
  const name = raw.name || raw.shortLabel || '未命名场馆';
  const shortLabel = raw.shortLabel || name.split(' ')[0];
  const capLabel = raw.capLabel || (codeText ? `${codeText} · ${capText}` : capText);
  const tierCount = typeof raw.tierCount === 'number'
    ? raw.tierCount
    : (Array.isArray(raw.standTiers) ? raw.standTiers.length : 0);
  const city = extractCityFromVenue(raw);

  return {
    id: venueId,
    _id: doc._id || venueId,
    name,
    shortLabel,
    capLabel,
    code: raw.code || '',
    city,
    tierCount,
    isSummaryOnly: true
  };
}

/**
 * 初始化微信云环境（安全兜底）
 */
function ensureCloudInit() {
  if (typeof wx === 'undefined' || !wx.cloud) {
    throw new Error('当前微信环境不支持云开发能力 (wx.cloud 不存在)');
  }
  try {
    wx.cloud.init({ traceUser: true });
  } catch (e) {
    // 若已在 app.js 初始化过，则忽略
  }
}

function hasCloudFunctionSupport() {
  return typeof wx !== 'undefined' && wx.cloud && typeof wx.cloud.callFunction === 'function';
}

const OBFS_KEY = 'SC_2026_VENUE_RENDER_KEY_V1';
const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function base64ToBytes(b64) {
  const clean = String(b64 || '').replace(/[^A-Za-z0-9+/=]/g, '');
  const len = clean.length;
  const pad = clean.endsWith('==') ? 2 : (clean.endsWith('=') ? 1 : 0);
  const byteLen = ((len * 3) >> 2) - pad;
  const bytes = new Uint8Array(byteLen);
  let p = 0;
  for (let i = 0; i < len; i += 4) {
    const e1 = B64_CHARS.indexOf(clean[i]);
    const e2 = B64_CHARS.indexOf(clean[i + 1]);
    const e3 = B64_CHARS.indexOf(clean[i + 2]);
    const e4 = B64_CHARS.indexOf(clean[i + 3]);
    const n = (e1 << 18) | (e2 << 12) | ((e3 & 63) << 6) | (e4 & 63);
    if (p < byteLen) bytes[p++] = (n >> 16) & 0xff;
    if (p < byteLen) bytes[p++] = (n >> 8) & 0xff;
    if (p < byteLen) bytes[p++] = n & 0xff;
  }
  return bytes;
}

function utf8Decode(bytes) {
  const chunks = [];
  let i = 0;
  while (i < bytes.length) {
    const b0 = bytes[i++];
    if (b0 < 0x80) {
      chunks.push(String.fromCharCode(b0));
    } else if (b0 < 0xe0) {
      const b1 = bytes[i++] & 0x3f;
      chunks.push(String.fromCharCode(((b0 & 0x1f) << 6) | b1));
    } else if (b0 < 0xf0) {
      const b1 = bytes[i++] & 0x3f;
      const b2 = bytes[i++] & 0x3f;
      chunks.push(String.fromCharCode(((b0 & 0x0f) << 12) | (b1 << 6) | b2));
    } else {
      const b1 = bytes[i++] & 0x3f;
      const b2 = bytes[i++] & 0x3f;
      const b3 = bytes[i++] & 0x3f;
      const cp = (((b0 & 0x07) << 18) | (b1 << 12) | (b2 << 6) | b3) - 0x10000;
      chunks.push(String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff)));
    }
  }
  return chunks.join('');
}

function decodePayload(b64) {
  const raw = base64ToBytes(b64);
  if (raw.length < 4) {
    throw new Error('无效的编码响应');
  }
  const salt0 = raw[0], salt1 = raw[1], salt2 = raw[2], salt3 = raw[3];
  const salts = [salt0, salt1, salt2, salt3];
  const out = new Uint8Array(raw.length - 4);
  const keyLen = OBFS_KEY.length;
  for (let i = 0; i < out.length; i++) {
    const k = OBFS_KEY.charCodeAt(i % keyLen) ^ salts[i & 3] ^ ((i * 13 + 7) & 0xff);
    const shifted = (raw[4 + i] - (salts[(i + 1) & 3] & 0x1f) + 256) & 0xff;
    out[i] = shifted ^ k;
  }
  return JSON.parse(utf8Decode(out));
}

async function callStadiumProxy(payload) {
  const res = await wx.cloud.callFunction({
    name: 'stadiumProxy',
    data: payload
  });
  const result = res && res.result;
  if (!result || !result.ok) {
    const msg = (result && result.message) || '云函数 stadiumProxy 调用失败';
    const err = new Error(msg);
    err.code = (result && result.code) || 'CLOUD_PROXY_ERROR';
    throw err;
  }
  if (result.encoded && typeof result.payload === 'string') {
    return decodePayload(result.payload);
  }
  return result.data;
}

/**
 * 尝试从本地内置数据中加载场馆（作为离线或云端异常兜底）
 */
function getLocalFallbackVenues() {
  try {
    const localMod = require('../data/venues');
    const list = (localMod && typeof localMod.getAllVenues === 'function' ? localMod.getAllVenues() : (localMod && localMod.VENUES)) || [];
    if (Array.isArray(list) && list.length > 0) {
      console.log('[DEBUG-stadium-cloud] 从本地内置数据兜底加载到场馆数:', list.length);
      return list.map(v => extractVenueDoc(v)).filter(Boolean);
    }
  } catch (e) {
    // 若本地 venues 被 packOptions 忽略或不存在，则静默忽略
  }
  return [];
}

function getLocalFallbackVenueList() {
  try {
    const localMod = require('../data/venues');
    const list = (localMod && typeof localMod.getAllVenues === 'function' ? localMod.getAllVenues() : (localMod && localMod.VENUES)) || [];
    if (Array.isArray(list) && list.length > 0) {
      return list.map(v => extractVenueSummary(v)).filter(Boolean);
    }
  } catch (e) {
    // 若本地 venues 被 packOptions 忽略或不存在，则静默忽略
  }
  return [];
}

/**
 * 仅拉取场馆轻量摘要列表（不包含 schema / standTiers / infield 等大字段，显著降低首屏与列表加载流量）
 */
async function loadStadiumProjectList(options = {}) {
  if (
    !(options && options.forceRefresh) &&
    _cachedVenueList &&
    _cachedVenueList.length > 0 &&
    (Date.now() - _cachedListAt < VENUE_CACHE_TTL_MS)
  ) {
    return _cachedVenueList;
  }

  try {
    ensureCloudInit();

    let rawDocs = [];
    if (hasCloudFunctionSupport()) {
      const proxyData = await callStadiumProxy({ action: 'list' });
      rawDocs = Array.isArray(proxyData) ? proxyData : [];
    } else {
      const db = wx.cloud.database();
      const collection = db.collection('stadiumProjects');

      let total = null;
      try {
        const countRes = await collection.count();
        if (countRes && typeof countRes.total === 'number') {
          total = countRes.total;
        }
      } catch (countErr) {
        // Fallback to cursor probing
      }

      if (total !== null) {
        for (let offset = 0; offset < total; offset += MAX_PAGE_LIMIT) {
          const pageSize = Math.min(MAX_PAGE_LIMIT, total - offset);
          try {
            const res = await collection.skip(offset).limit(pageSize).field(SUMMARY_FIELDS).get();
            if (res && Array.isArray(res.data)) {
              rawDocs.push(...res.data);
            }
          } catch (pageErr) {
            for (let i = offset; i < offset + pageSize; i++) {
              try {
                const singleRes = await collection.skip(i).limit(1).field(SUMMARY_FIELDS).get();
                if (singleRes && Array.isArray(singleRes.data) && singleRes.data.length > 0) {
                  rawDocs.push(singleRes.data[0]);
                }
              } catch (singleErr) {
                // Skip failed item
              }
            }
          }
        }
      } else {
        const maxPages = 10;
        for (let page = 0; page < maxPages; page++) {
          const offset = page * MAX_PAGE_LIMIT;
          try {
            const res = await collection.skip(offset).limit(MAX_PAGE_LIMIT).field(SUMMARY_FIELDS).get();
            const batch = (res && Array.isArray(res.data)) ? res.data : [];
            rawDocs.push(...batch);
            if (batch.length < MAX_PAGE_LIMIT) break;
          } catch (probeErr) {
            break;
          }
        }
      }
    }

    const summaries = rawDocs.map(doc => extractVenueSummary(doc)).filter(Boolean);
    if (summaries.length === 0) {
      const fallback = getLocalFallbackVenueList();
      if (fallback.length > 0) {
        return fallback;
      }
    }

    if (summaries.length > 0) {
      _cachedVenueList = summaries;
      _cachedListAt = Date.now();
    }
    return summaries;
  } catch (topErr) {
    console.error('[DEBUG-stadium-cloud] 加载场馆摘要列表异常，执行降级保护:', topErr);
    const fallback = getLocalFallbackVenueList();
    if (fallback.length > 0) {
      return fallback;
    }
    throw topErr;
  }
}

/**
 * 安全拉取单条文档（防止单次网络包体积超出小程序端 1MB 限制）
 */
async function fetchSingleDocSafe(collection, skipIndex) {
  try {
    const res = await collection.skip(skipIndex).limit(1).get();
    if (res && Array.isArray(res.data) && res.data.length > 0) {
      return res.data[0];
    }
  } catch (err) {
    console.warn(`[DEBUG-stadium-cloud] 无法直接拉取索引 ${skipIndex} 文档:`, err && (err.errMsg || err.message));
    // 若因单条文档内部包含大量冗余历史字段导致超过 1MB，尝试排除已知无关大字段
    try {
      const resFallback = await collection.skip(skipIndex).limit(1).field({
        history: false,
        snapshots: false,
        versions: false,
        rawCad: false,
        cadFile: false,
        previewImage: false
      }).get();
      if (resFallback && Array.isArray(resFallback.data) && resFallback.data.length > 0) {
        return resFallback.data[0];
      }
    } catch (fallbackErr) {
      console.warn(`[DEBUG-stadium-cloud] 索引 ${skipIndex} 文档排除大字段后仍超限或失败，跳过该文档`);
    }
  }
  return null;
}

/**
 * 并发控制拉取全部单条文档（默认最大并发数 4，避免触发网络并发或请求风暴）
 */
async function fetchAllDocsWithConcurrency(collection, totalCount, concurrency = 4) {
  const docs = new Array(totalCount);
  let currentIndex = 0;

  async function worker() {
    while (currentIndex < totalCount) {
      const idx = currentIndex++;
      const doc = await fetchSingleDocSafe(collection, idx);
      docs[idx] = doc;
    }
  }

  const workers = [];
  const workerCount = Math.min(concurrency, totalCount);
  for (let i = 0; i < workerCount; i++) {
    workers.push(worker());
  }

  await Promise.all(workers);
  return docs.filter(Boolean);
}

/**
 * 从云数据库集合 stadiumProjects 加载所有场馆数据
 * 采用单文档安全分批 + 并发池策略，彻底杜绝微信 -602001 response size exceeded 1MB 报错
 */
async function loadAllStadiumProjects(options = {}) {
  if (
    !(options && options.forceRefresh) &&
    _allVenuesCached &&
    _cachedVenues &&
    _cachedVenues.length > 0 &&
    (Date.now() - _cachedAt < VENUE_CACHE_TTL_MS)
  ) {
    return _cachedVenues;
  }

  try {
    ensureCloudInit();

    const db = wx.cloud.database();
    const collection = db.collection('stadiumProjects');

    let rawDocs = [];

    // 1. 优先通过 count() 获取集合总数（count 仅返回数字，绝不会超 1MB）
    let total = null;
    try {
      const countRes = await collection.count();
      if (countRes && typeof countRes.total === 'number') {
        total = countRes.total;
        console.log('[DEBUG-stadium-cloud] 云数据库 stadiumProjects 总文档数:', total);
      }
    } catch (countErr) {
      console.warn('[DEBUG-stadium-cloud] 获取文档总数失败，将采用游标探测模式:', countErr);
    }

    if (total !== null) {
      if (total > 0) {
        // 使用单条分批 + 并发控制拉取，彻底规避多文档累计超出 1MB 的问题
        rawDocs = await fetchAllDocsWithConcurrency(collection, total, 4);
      }
    } else {
      // 若 count() 权限受限，采用逐条游标探测（最多拉取 50 条）
      const maxProbes = 50;
      for (let i = 0; i < maxProbes; i++) {
        const doc = await fetchSingleDocSafe(collection, i);
        if (!doc) {
          // 连续探测若未返回数据则结束
          break;
        }
        rawDocs.push(doc);
      }
    }

    console.log('[DEBUG-stadium-cloud] 成功拉取到云文档数:', rawDocs.length);

    // 2. 规范化并清洗文档
    const venues = [];
    for (const doc of rawDocs) {
      const formatted = extractVenueDoc(doc);
      if (formatted) {
        venues.push(formatted);
        const isBn = formatted.code === 'BJ-NST-2008-01' ||
          String(formatted.id || '').indexOf('bird-nest') >= 0 ||
          String(formatted.name || '').indexOf('鸟巢') >= 0;
        if (isBn) {
          console.log('[DEBUG-stadium-cloud] 已匹配鸟巢体育馆数据:', formatted.name);
          (formatted.standTiers || []).forEach((t, i) => {
            console.log(`[DEBUG-stadium-cloud] 鸟巢看台 [${i + 1}F - ${t.name || t.id}] baseElevation: ${t.baseElevation}m, morphMode: ${t.morphMode || 'infield-shape'}, concentricMorph: ${t.concentricMorph || 0}`);
          });
        }
      }
    }

    // 3. 若云端未能成功解析出任何有效场馆，尝试本地内置数据兜底
    if (venues.length === 0) {
      console.warn('[DEBUG-stadium-cloud] 云数据库无有效场馆，尝试回退本地数据');
      const fallback = getLocalFallbackVenues();
      if (fallback.length > 0) {
        return fallback;
      }
    }

    console.log('[DEBUG-stadium-cloud] 规范化完成，有效场馆数:', venues.length);
    if (venues.length > 0) {
      _cachedVenues = venues;
      _cachedAt = Date.now();
      _allVenuesCached = true;
    }
    return venues;
  } catch (topErr) {
    console.error('[DEBUG-stadium-cloud] 云数据库查询异常，执行降级保护:', topErr);
    const fallback = getLocalFallbackVenues();
    if (fallback.length > 0) {
      return fallback;
    }
    throw topErr;
  }
}

/**
 * 根据场馆 id 或云文档 _id 直接从服务器加载单个场馆的完整 Schema
 */
async function loadStadiumProjectById(venueId, docId) {
  if (_cachedVenues && _cachedVenues.length > 0 && (Date.now() - _cachedAt < VENUE_CACHE_TTL_MS)) {
    const cachedHit = _cachedVenues.find(
      v => (v.id === venueId || v._id === venueId || (docId && v._id === docId)) &&
           Array.isArray(v.standTiers) && v.standTiers.length > 0
    );
    if (cachedHit) {
      return cachedHit;
    }
  }

  try {
    ensureCloudInit();
    let doc = null;

    if (hasCloudFunctionSupport()) {
      doc = await callStadiumProxy({ action: 'detail', venueId, docId });
    } else {
      const db = wx.cloud.database();
      const collection = db.collection('stadiumProjects');
      const excludeLargeFields = {
        history: false,
        snapshots: false,
        versions: false,
        rawCad: false,
        cadFile: false,
        previewImage: false
      };

      if (docId) {
        try {
          const res = await collection.doc(docId).get();
          if (res && res.data) {
            doc = res.data;
          }
        } catch (err) {
          try {
            const resFallback = await collection.doc(docId).field(excludeLargeFields).get();
            if (resFallback && resFallback.data) {
              doc = resFallback.data;
            }
          } catch (fbErr) {
            // Ignore fallback error
          }
        }
      }

      if (!doc && venueId) {
        try {
          const _ = db.command;
          const res = await collection.where(_.or([
            { _id: venueId },
            { id: venueId }
          ])).limit(1).get();
          if (res && Array.isArray(res.data) && res.data.length > 0) {
            doc = res.data[0];
          }
        } catch (whereErr) {
          try {
            const _ = db.command;
            const resFallback = await collection.where(_.or([
              { _id: venueId },
              { id: venueId }
            ])).limit(1).field(excludeLargeFields).get();
            if (resFallback && Array.isArray(resFallback.data) && resFallback.data.length > 0) {
              doc = resFallback.data[0];
            }
          } catch (whereFbErr) {
            // Ignore fallback error
          }
        }
      }
    }

    if (doc) {
      const formatted = extractVenueDoc(doc);
      if (formatted) {
        if (!Array.isArray(_cachedVenues)) {
          _cachedVenues = [];
        }
        const idx = _cachedVenues.findIndex(v => v.id === formatted.id || v._id === formatted._id);
        if (idx >= 0) _cachedVenues[idx] = formatted;
        else _cachedVenues.push(formatted);
        _cachedAt = Date.now();
        return formatted;
      }
    }
  } catch (topErr) {
    console.warn('[DEBUG-stadium-cloud] 从服务器加载单个场馆 Schema 异常，尝试本地兜底:', topErr);
  }

  const fallback = getLocalFallbackVenues();
  const matched = fallback.find(v => v.id === venueId || v._id === venueId || (docId && (v._id === docId || v.id === docId)));
  return matched || null;
}

module.exports = {
  parseIfJson,
  normalizeTiers,
  resolveRawVenue,
  extractVenueDoc,
  extractVenueSummary,
  extractCityFromVenue,
  normalizeCityName,
  loadStadiumProjectList,
  loadAllStadiumProjects,
  loadStadiumProjectById
};

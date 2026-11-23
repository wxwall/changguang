/**
 * 微信云开发数据库场馆服务
 * 集合名称: stadiumProjects
 */

const { normalizeVenueCoordinates } = require('../utils/schema-geometry');

const MAX_PAGE_LIMIT = 20;

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

  console.log(`[DEBUG-stadium-cloud] 成功解析场馆: [${venueId}] ${shortLabel}, 看台层数: ${normalized.standTiers.length}`);

  return {
    ...normalized,
    id: venueId,
    _id: doc._id || venueId,
    shortLabel,
    capLabel
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
async function loadAllStadiumProjects() {
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

module.exports = {
  parseIfJson,
  normalizeTiers,
  resolveRawVenue,
  extractVenueDoc,
  loadAllStadiumProjects
};

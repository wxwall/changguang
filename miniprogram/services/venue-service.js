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
 * 从云数据库集合 stadiumProjects 加载所有场馆数据
 * 自动处理分页逻辑（小程序端单次最多 20 条）
 */
async function loadAllStadiumProjects() {
  ensureCloudInit();

  const db = wx.cloud.database();
  const collection = db.collection('stadiumProjects');

  // 1. 首批获取前 20 条数据
  const firstBatchRes = await collection.limit(MAX_PAGE_LIMIT).get();
  let rawDocs = (firstBatchRes && firstBatchRes.data) || [];

  console.log('[DEBUG-stadium-cloud] 首批拉取到文档数:', rawDocs.length);
  if (rawDocs.length > 0) {
    console.log('[DEBUG-stadium-cloud] 首个文档 _id:', rawDocs[0]._id, 'keys:', Object.keys(rawDocs[0]));
  }

  // 2. 若首批正好满 20 条，说明可能存在后续分页，尝试 count() 并发拉取后续数据
  if (rawDocs.length === MAX_PAGE_LIMIT) {
    try {
      const countRes = await collection.count();
      const total = countRes && countRes.total ? countRes.total : 0;
      if (total > MAX_PAGE_LIMIT) {
        const batchTimes = Math.ceil(total / MAX_PAGE_LIMIT);
        const tasks = [];
        for (let i = 1; i < batchTimes; i++) {
          tasks.push(collection.skip(i * MAX_PAGE_LIMIT).limit(MAX_PAGE_LIMIT).get());
        }
        const restBatches = await Promise.all(tasks);
        for (const batch of restBatches) {
          if (batch && Array.isArray(batch.data)) {
            rawDocs = rawDocs.concat(batch.data);
          }
        }
      }
    } catch (countErr) {
      console.warn('[DEBUG-stadium-cloud] 获取总数或分页失败，将仅使用已获取的数据:', countErr);
    }
  }

  // 3. 规范化并清洗文档
  const venues = [];
  for (const doc of rawDocs) {
    const formatted = extractVenueDoc(doc);
    if (formatted) {
      venues.push(formatted);
    }
  }

  console.log('[DEBUG-stadium-cloud] 规范化完成，有效场馆数:', venues.length);
  return venues;
}

module.exports = {
  parseIfJson,
  normalizeTiers,
  resolveRawVenue,
  extractVenueDoc,
  loadAllStadiumProjects
};

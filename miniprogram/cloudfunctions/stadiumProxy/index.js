const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const _ = db.command;
const COLLECTION = 'stadiumProjects';
const MAX_PAGE_LIMIT = 20;
const OBFS_KEY = 'SC_2026_VENUE_RENDER_KEY_V1';

function utf8Encode(str) {
  const bytes = [];
  for (let i = 0; i < str.length; i++) {
    let c = str.charCodeAt(i);
    if (c < 0x80) {
      bytes.push(c);
    } else if (c < 0x800) {
      bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
      const c2 = str.charCodeAt(++i);
      const cp = 0x10000 + (((c & 0x3ff) << 10) | (c2 & 0x3ff));
      bytes.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f)
      );
    } else {
      bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    }
  }
  return Uint8Array.from(bytes);
}

function encodePayload(obj) {
  const jsonBytes = utf8Encode(JSON.stringify(obj));
  const salt = new Uint8Array([
    (Math.random() * 256) | 0,
    (Math.random() * 256) | 0,
    (Math.random() * 256) | 0,
    (Math.random() * 256) | 0
  ]);
  const out = Buffer.allocUnsafe(4 + jsonBytes.length);
  out[0] = salt[0];
  out[1] = salt[1];
  out[2] = salt[2];
  out[3] = salt[3];
  const keyLen = OBFS_KEY.length;
  for (let i = 0; i < jsonBytes.length; i++) {
    const k = OBFS_KEY.charCodeAt(i % keyLen) ^ salt[i & 3] ^ ((i * 13 + 7) & 0xff);
    out[4 + i] = ((jsonBytes[i] ^ k) + (salt[(i + 1) & 3] & 0x1f)) & 0xff;
  }
  return out.toString('base64');
}

// In-memory per-instance rate limiter (mitigates scripted scraping)
const rateBuckets = new Map();
function checkRateLimit(openid, action, maxPerMin) {
  const now = Date.now();
  const key = `${openid}:${action}`;
  const bucket = rateBuckets.get(key);
  if (!bucket || now - bucket.windowStart > 60 * 1000) {
    rateBuckets.set(key, { windowStart: now, count: 1 });
    return true;
  }
  if (bucket.count >= maxPerMin) {
    return false;
  }
  bucket.count += 1;
  return true;
}

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

// Whitelist of fields required for 3D/2D rendering; strips rawCad, cadFile, history, snapshots, internal notes, etc.
const RENDER_ALLOWED_KEYS = [
  '_id', 'id', 'name', 'shortLabel', 'capLabel', 'code',
  'city', 'cityName', 'province', 'region', 'location', 'address', 'description',
  'tierCount', 'engineeringSummary',
  'standTiers', 'stands', 'tiers', 'stand_tiers',
  'infield', 'facade', 'roof', 'updatedAt'
];

function sanitizeContainer(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
  const out = {};
  for (const key of RENDER_ALLOWED_KEYS) {
    if (obj[key] !== undefined) {
      out[key] = obj[key];
    }
  }
  return out;
}

function sanitizeVenueDoc(doc) {
  if (!doc || typeof doc !== 'object') return null;
  const clean = sanitizeContainer(doc);
  for (const nestedKey of ['schema', 'data', 'project', 'venue']) {
    if (doc[nestedKey] !== undefined) {
      if (typeof doc[nestedKey] === 'string') {
        try {
          const parsed = JSON.parse(doc[nestedKey]);
          clean[nestedKey] = sanitizeContainer(parsed);
        } catch (e) {
          // Ignore malformed JSON string
        }
      } else if (doc[nestedKey] && typeof doc[nestedKey] === 'object') {
        clean[nestedKey] = sanitizeContainer(doc[nestedKey]);
      }
    }
  }
  return clean;
}

async function handleList() {
  const collection = db.collection(COLLECTION);
  const countRes = await collection.count();
  const total = (countRes && typeof countRes.total === 'number') ? countRes.total : 0;
  const docs = [];

  for (let offset = 0; offset < total; offset += MAX_PAGE_LIMIT) {
    const pageSize = Math.min(MAX_PAGE_LIMIT, total - offset);
    const res = await collection.skip(offset).limit(pageSize).field(SUMMARY_FIELDS).get();
    if (res && Array.isArray(res.data)) {
      docs.push(...res.data);
    }
  }

  return { ok: true, encoded: true, payload: encodePayload(docs) };
}

async function handleDetail(event) {
  const docId = event.docId ? String(event.docId).trim() : '';
  const venueId = event.venueId ? String(event.venueId).trim() : '';
  if (!docId && !venueId) {
    return { ok: false, code: 'INVALID_PARAMS', message: '缺少场馆标识' };
  }

  const collection = db.collection(COLLECTION);
  const excludeLargeFields = {
    history: false,
    snapshots: false,
    versions: false,
    rawCad: false,
    cadFile: false,
    previewImage: false
  };

  let doc = null;
  if (docId) {
    try {
      const res = await collection.doc(docId).field(excludeLargeFields).get();
      if (res && res.data) doc = res.data;
    } catch (e) {
      // Fall through to where query
    }
  }

  if (!doc && venueId) {
    const res = await collection
      .where(_.or([{ _id: venueId }, { id: venueId }]))
      .limit(1)
      .field(excludeLargeFields)
      .get();
    if (res && Array.isArray(res.data) && res.data.length > 0) {
      doc = res.data[0];
    }
  }

  if (!doc) {
    return { ok: false, code: 'NOT_FOUND', message: '未找到场馆数据' };
  }

  return { ok: true, encoded: true, payload: encodePayload(sanitizeVenueDoc(doc)) };
}

exports.main = async (event = {}) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext && wxContext.OPENID;
  if (!openid) {
    return { ok: false, code: 'UNAUTHORIZED', message: '仅限合法微信小程序用户访问' };
  }

  const action = event.action;
  if (action === 'list') {
    if (!checkRateLimit(openid, 'list', 20)) {
      return { ok: false, code: 'RATE_LIMITED', message: '请求过于频繁，请稍后再试' };
    }
    return handleList();
  }

  if (action === 'detail') {
    if (!checkRateLimit(openid, 'detail', 30)) {
      return { ok: false, code: 'RATE_LIMITED', message: '请求过于频繁，请稍后再试' };
    }
    return handleDetail(event);
  }

  // Explicitly reject any other or write-like actions
  return { ok: false, code: 'FORBIDDEN_ACTION', message: '不支持的操作' };
};

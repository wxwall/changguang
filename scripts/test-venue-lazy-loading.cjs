const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');

function createMockWx(cloudDocs) {
  const calls = {
    listQueries: [],
    docGets: [],
    whereGets: [],
    loadingShown: [],
    loadingHidden: 0,
    toasts: [],
    navBacks: 0,
    storage: {}
  };

  const mockCollection = {
    count: async () => ({ total: cloudDocs.length }),
    skip: (s) => ({
      limit: (l) => ({
        field: (f) => ({
          get: async () => {
            calls.listQueries.push({ skip: s, limit: l, field: f });
            const slice = cloudDocs.slice(s, s + l).map((doc) => {
              const projected = {};
              for (const key of Object.keys(f)) {
                if (f[key] !== true) continue;
                if (key.includes('.')) {
                  const parts = key.split('.');
                  let src = doc;
                  for (let i = 0; i < parts.length; i++) {
                    if (src && typeof src === 'object') src = src[parts[i]];
                    else { src = undefined; break; }
                  }
                  if (src !== undefined) {
                    let dst = projected;
                    for (let i = 0; i < parts.length - 1; i++) {
                      if (!dst[parts[i]] || typeof dst[parts[i]] !== 'object') dst[parts[i]] = {};
                      dst = dst[parts[i]];
                    }
                    dst[parts[parts.length - 1]] = src;
                  }
                } else if (doc[key] !== undefined) {
                  projected[key] = doc[key];
                }
              }
              return projected;
            });
            return { data: slice };
          }
        }),
        get: async () => ({ data: cloudDocs.slice(s, s + l) })
      })
    }),
    doc: (docId) => ({
      get: async () => {
        calls.docGets.push(docId);
        const found = cloudDocs.find((d) => d._id === docId);
        return { data: found || null };
      },
      field: () => ({
        get: async () => {
          calls.docGets.push(docId);
          const found = cloudDocs.find((d) => d._id === docId);
          return { data: found || null };
        }
      })
    }),
    where: (cond) => ({
      limit: () => ({
        get: async () => {
          calls.whereGets.push(cond);
          return { data: [] };
        }
      })
    })
  };

  const wx = {
    cloud: {
      init: () => {},
      database: () => ({
        collection: () => mockCollection,
        command: { or: (arr) => ({ $or: arr }) }
      })
    },
    showLoading: (opts) => calls.loadingShown.push(opts),
    hideLoading: () => { calls.loadingHidden += 1; },
    showToast: (opts) => calls.toasts.push(opts),
    getStorageSync: (k) => calls.storage[k] || '',
    setStorageSync: (k, v) => { calls.storage[k] = v; },
    navigateBack: () => { calls.navBacks += 1; },
    navigateTo: () => {},
    getSystemInfoSync: () => ({ pixelRatio: 2 }),
    createSelectorQuery: () => ({
      in: () => ({
        select: () => ({
          fields: () => ({ exec: () => {} })
        })
      })
    })
  };

  return { wx, calls };
}

function loadCommonJsModule(filePath, customMocks = {}, cache = {}) {
  const absPath = path.resolve(filePath);
  if (cache[absPath]) return cache[absPath].exports;

  const src = fs.readFileSync(absPath, 'utf8');
  const mod = { exports: {} };
  cache[absPath] = mod;

  const localRequire = (reqId) => {
    if (customMocks[reqId]) return customMocks[reqId];
    if (reqId.startsWith('.')) {
      let resolved = path.resolve(path.dirname(absPath), reqId);
      if (!resolved.endsWith('.js') && fs.existsSync(resolved + '.js')) {
        resolved += '.js';
      }
      return loadCommonJsModule(resolved, customMocks, cache);
    }
    return require(reqId);
  };

  const fn = new Function('module', 'exports', 'require', '__dirname', '__filename', src);
  fn(mod, mod.exports, localRequire, path.dirname(absPath), absPath);
  return mod.exports;
}

function loadPageWithMocks(pageFilePath, mockRequireMap) {
  let capturedConfig = null;
  global.Page = (cfg) => {
    capturedConfig = cfg;
  };
  global.getCurrentPages = () => [];

  loadCommonJsModule(pageFilePath, mockRequireMap);

  const instance = {
    ...capturedConfig,
    data: JSON.parse(JSON.stringify(capturedConfig.data || {})),
    setData(patch, cb) {
      Object.assign(this.data, patch);
      if (typeof cb === 'function') cb();
    }
  };
  return instance;
}

async function runTests() {
  const sampleDocs = [
    {
      _id: 'doc-gz-1',
      id: 'gz-tianhe',
      name: '广州天河体育场',
      code: 'GZ-TH-01',
      engineeringSummary: { totalCapacity: 54856 },
      schema: {
        id: 'gz-tianhe',
        name: '广州天河体育场',
        infield: { shape: 'rounded-rect', length: 105, width: 68, stageConfig: {} },
        standTiers: [{ id: 'tier-1', level: 1, sectors: [{ id: '1F-E', startAngleDeg: 60, endAngleDeg: 120, rows: 20 }] }]
      }
    },
    {
      _id: 'doc-bj-1',
      id: 'bj-bird-nest',
      name: '国家体育场（鸟巢）',
      city: '北京市',
      code: 'BJ-NST-2008-01',
      engineeringSummary: { totalCapacity: 91000 },
      schema: {
        id: 'bj-bird-nest',
        name: '国家体育场（鸟巢）',
        infield: { shape: 'ellipse', length: 105, width: 68, stageConfig: {} },
        standTiers: [{ id: 'tier-1', level: 1, sectors: [{ id: '1F-E', startAngleDeg: 60, endAngleDeg: 120, rows: 25 }] }]
      }
    },
    {
      _id: 'doc-bj-2',
      id: 'bj-gongti',
      name: '北京工人体育场',
      code: 'BJ-GT-02',
      engineeringSummary: { totalCapacity: 68000 },
      schema: {
        id: 'bj-gongti',
        name: '北京工人体育场',
        infield: { shape: 'rounded-rect', length: 105, width: 68, stageConfig: {} },
        standTiers: [{ id: 'tier-1', level: 1, sectors: [{ id: '1F-E', startAngleDeg: 60, endAngleDeg: 120, rows: 22 }] }]
      }
    },
    {
      _id: 'doc-other',
      id: 'mystery-arena',
      name: '星际体育中心',
      code: 'XX-01',
      schema: {
        id: 'mystery-arena',
        name: '星际体育中心',
        infield: { shape: 'rounded-rect', length: 105, width: 68, stageConfig: {} },
        standTiers: [{ id: 'tier-1', level: 1, sectors: [{ id: '1F-E', startAngleDeg: 60, endAngleDeg: 120, rows: 15 }] }]
      }
    }
  ];

  const { wx, calls } = createMockWx(sampleDocs);
  global.wx = wx;

  const servicePath = path.resolve(__dirname, '../miniprogram/services/venue-service.js');
  const venueService = loadCommonJsModule(servicePath);

  console.log('--- 1. Testing city extraction & normalization ---');
  assert.strictEqual(venueService.extractCityFromVenue({ name: '广州天河体育场' }), '广州');
  assert.strictEqual(venueService.extractCityFromVenue({ city: '北京市', name: '未知' }), '北京');
  assert.strictEqual(venueService.extractCityFromVenue({ location: { city: '上海市' }, name: '未知' }), '上海');
  assert.strictEqual(venueService.extractCityFromVenue({ name: '国家体育场（鸟巢）' }), '北京');
  assert.strictEqual(venueService.extractCityFromVenue({ code: 'CD-FHS-01', name: '凤凰山' }), '成都');
  assert.strictEqual(venueService.extractCityFromVenue({ name: '星际体育中心', code: 'XX-01' }), '其他');
  console.log('✓ City extraction passed.');

  console.log('--- 2. Testing loadStadiumProjectList (lightweight) & on-demand loadStadiumProjectById ---');
  const summaries = await venueService.loadStadiumProjectList({ forceRefresh: true });
  assert.strictEqual(summaries.length, 4);
  assert.strictEqual(calls.listQueries.length, 1, 'Should batch-fetch summaries in 1 request');
  assert.strictEqual(calls.listQueries[0].field.schema, undefined, 'Must NOT request heavy schema field in list query');
  assert.strictEqual(calls.listQueries[0].field.standTiers, undefined, 'Must NOT request standTiers in list query');
  assert.strictEqual(summaries[0].city, '广州');
  assert.strictEqual(summaries[0].isSummaryOnly, true);
  assert.strictEqual(summaries[0].standTiers, undefined);
  assert.strictEqual(calls.docGets.length, 0, 'No full doc should be fetched yet');

  // Now load 1 venue full schema on demand
  const fullBj = await venueService.loadStadiumProjectById('bj-bird-nest', 'doc-bj-1');
  assert.strictEqual(calls.docGets.length, 1);
  assert.strictEqual(calls.docGets[0], 'doc-bj-1');
  assert.ok(Array.isArray(fullBj.standTiers) && fullBj.standTiers.length === 1);

  // Second call for same venue should hit cache
  const fullBjCached = await venueService.loadStadiumProjectById('bj-bird-nest', 'doc-bj-1');
  assert.strictEqual(calls.docGets.length, 1, 'Second load of same venue should hit full-schema cache');
  assert.strictEqual(fullBjCached.id, 'bj-bird-nest');

  // Nested schema-only doc summary extraction (without top-level name/city)
  const nestedSummary = venueService.extractVenueSummary({
    _id: 'doc-nested-1',
    schema: {
      id: 'hz-lotus',
      name: '杭州奥体中心体育场',
      city: '杭州市',
      engineeringSummary: { totalCapacity: 80800 }
    }
  });
  assert.strictEqual(nestedSummary.name, '杭州奥体中心体育场');
  assert.strictEqual(nestedSummary.city, '杭州');
  assert.strictEqual(nestedSummary.standTiers, undefined);

  // Calling loadAllStadiumProjects after loadStadiumProjectById must still fetch all docs, not return the 1-item partial cache
  const allLoaded = await venueService.loadAllStadiumProjects();
  assert.strictEqual(allLoaded.length, 4, 'loadAllStadiumProjects must not be poisoned by single-venue cache');
  console.log('✓ Lightweight list + on-demand full schema loading passed.');

  console.log('--- 3. Testing venues.js (left city groups + right venue picker) ---');
  const venuesPagePath = path.resolve(__dirname, '../miniprogram/pages/venues/venues.js');
  const venuesPage = loadPageWithMocks(venuesPagePath, {
    '../../services/venue-service': venueService
  });

  venuesPage.onLoad({ currentId: 'bj-bird-nest' });
  await new Promise((r) => setTimeout(r, 20));

  assert.strictEqual(venuesPage.data.loading, false);
  assert.strictEqual(venuesPage.data.cityGroups.length, 3);
  assert.strictEqual(venuesPage.data.cityGroups[0].city, '广州');
  assert.strictEqual(venuesPage.data.cityGroups[1].city, '北京');
  assert.strictEqual(venuesPage.data.cityGroups[1].count, 2);
  assert.strictEqual(venuesPage.data.cityGroups[2].city, '其他', '其他 should be placed at the end');
  assert.strictEqual(venuesPage.data.activeCity, '北京', 'Should default activeCity to current venue city');
  assert.strictEqual(venuesPage.data.currentCityVenues.length, 2);

  // Switch city to 广州
  const prevScrollTop = venuesPage.data.rightScrollTop;
  venuesPage.onSelectCity({ currentTarget: { dataset: { city: '广州' } } });
  assert.strictEqual(venuesPage.data.activeCity, '广州');
  assert.strictEqual(venuesPage.data.currentCityVenues.length, 1);
  assert.strictEqual(venuesPage.data.currentCityVenues[0].id, 'gz-tianhe');
  assert.notStrictEqual(venuesPage.data.rightScrollTop, prevScrollTop, 'Switching city should update rightScrollTop to reset scroll');

  // Search keyword '工人'
  venuesPage.onSearchInput({ detail: { value: '工人' } });
  assert.strictEqual(venuesPage.data.cityGroups.length, 1);
  assert.strictEqual(venuesPage.data.activeCity, '北京');
  assert.strictEqual(venuesPage.data.currentCityVenues.length, 1);
  assert.strictEqual(venuesPage.data.currentCityVenues[0].id, 'bj-gongti');

  // Search keyword with no match
  venuesPage.onSearchInput({ detail: { value: '不存在的场馆' } });
  assert.strictEqual(venuesPage.data.cityGroups.length, 0);
  assert.strictEqual(venuesPage.data.currentCityVenues.length, 0);

  // Clear search
  venuesPage.onClearSearch();
  assert.strictEqual(venuesPage.data.totalFilteredCount, 4);

  // Pick venue emits selectVenue and navigates back
  let emittedPayload = null;
  venuesPage.getOpenerEventChannel = () => ({
    emit: (evt, payload) => {
      if (evt === 'selectVenue') emittedPayload = payload;
    }
  });
  venuesPage.onPickVenue({ currentTarget: { dataset: { id: 'gz-tianhe', docId: 'doc-gz-1', name: '广州天河体育场' } } });
  assert.deepStrictEqual(emittedPayload, { id: 'gz-tianhe', docId: 'doc-gz-1', name: '广州天河体育场' });
  assert.strictEqual(wx.calls ? wx.calls.navBacks : calls.navBacks, 1);
  console.log('✓ venues.js city grouping, search, and selection passed.');

  console.log('--- 4. Testing index.js initial load & on-demand venue switch ---');
  // Reset docGets counter with fresh service instance
  const fresh = createMockWx(sampleDocs);
  global.wx = fresh.wx;
  const freshService = loadCommonJsModule(servicePath);

  const indexPagePath = path.resolve(__dirname, '../miniprogram/pages/index/index.js');
  const indexPage = loadPageWithMocks(indexPagePath, {
    '../../services/venue-service': freshService,
    '../../utils/renderer-2d': { Renderer2D: function () {} },
    '../../utils/renderer-3d': { Renderer3D: function () {} }
  });

  await indexPage.loadVenuesData();
  assert.strictEqual(fresh.calls.listQueries.length, 1, 'Index should fetch lightweight list once');
  assert.strictEqual(fresh.calls.docGets.length, 1, 'Index should fetch ONLY 1 full schema on startup');
  assert.strictEqual(fresh.calls.docGets[0], 'doc-gz-1');
  assert.strictEqual(indexPage.data.homeVenues.length, 4);
  assert.strictEqual(indexPage.data.currentVenue.id, 'gz-tianhe');

  // Switch to bj-gongti via top chip -> should fetch doc-bj-2 on demand
  await indexPage.loadAndSwitchVenue('bj-gongti', 'doc-bj-2', '北京工人体育场');
  assert.strictEqual(fresh.calls.docGets.length, 2, 'Switching to uncached venue should fetch its full schema');
  assert.strictEqual(fresh.calls.docGets[1], 'doc-bj-2');
  assert.strictEqual(indexPage.data.currentVenue.id, 'bj-gongti');
  indexPage.clearAutoFlyTimer();
  console.log('✓ index.js lazy initial load & on-demand switch passed.');

  console.log('\nALL LAZY LOADING & CITY GROUPING TESTS PASSED!');
}

runTests().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});

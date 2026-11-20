# changguang

## 导航

- 场馆几何（舞台变换、内场区块、视线计算）：`miniprogram/utils/schema-geometry.js`
- 2D / 3D 渲染：`miniprogram/utils/renderer-2d.js`、`miniprogram/utils/renderer-3d.js`
- 场馆数据：已接入微信云开发数据库集合 `stadiumProjects`，由 `miniprogram/services/venue-service.js` 统一封装读取与分页拉取；不再依赖本地 `miniprogram/data/venues.js`
- 坐标约定见 `docs/venue-schema.md`，离线校验使用 `npm run check:venues`

## 加载约定

小程序的 JS 模块是 CommonJS，而根 `package.json` 声明了 `"type": "module"`。加载这些模块时用 `new Function('module', 'exports', 'require', src)` 包装，或把脚本写成 `.cjs`（参考 `scripts/check-venues.cjs`）。

## 排查习惯

- 查提交历史先 `git show --stat`，再按文件取 diff
- 大文件按行区间读取，生成文件用脚本查询字段

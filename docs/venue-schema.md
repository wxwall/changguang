# 场馆数据格式（venues.js）

## 来源

`miniprogram/data/venues.js` 由 STADIACAD 2.0.0 导出生成，约 12000 行，不要手工编辑。查询字段时用脚本按 key 取值，不要整文件阅读：

```js
// 注意：根 package.json 是 "type": "module"，小程序模块是 CommonJS，
// 用 Function 包装加载（见 scripts/check-venues.cjs）。
```

`public/assets/aistudio/*.json` 是更早的导出源文件，坐标采用旧的世界坐标格式。

## 坐标约定（关键）

导出文件里的平面坐标与本仓库渲染引擎的世界坐标**相差 90°**：

| | 导出文件 | 渲染引擎（世界坐标） |
|---|---|---|
| 第一个轴 | `x` = 内场长轴 | `x` = 内场短轴 |
| 第二个轴 | `y` = 内场短轴 | `z` = 内场长轴 |
| 模块旋转 | `rotationDeg` | `rotationDeg + 90°` |

加载时由 `schema-geometry.normalizeVenueCoordinates(venue)` 统一换算：

```
worldX = y
worldZ = -x
rotationDeg = (rotationDeg + 90) % 360
```

该函数只在数据进入页面的三个入口调用一次（`onLoad`、`onSelectVenue` 兜底、自定义 Schema 导入）。**不要重复调用**，否则会再转 90°。

角度约定（`orientationDeg`）在导出与世界坐标中一致：0°=北、90°=东、180°=南、270°=西。

## infield

| 字段 | 说明 |
|---|---|
| `shape` | `rounded-rect`（默认）/ `ellipse`（`cornerRadius` 忽略） |
| `length` / `width` | 长轴（南北）、短轴（东西）尺寸（米） |
| `cornerRadius` | 圆角半径 |
| `coreMode` | `sports` / `stage` |
| `pitchLength` / `pitchWidth` | 球场尺寸，用于赛场模式 |
| `surfaceType` | `natural-turf` / `hardwood-court` 等 |
| `stageConfig` | 舞台配置，见下 |

## infield.stageConfig

| 字段 | 说明 |
|---|---|
| `type` | `end-stage` / `center-stage` / `festival-stage` |
| `x` / `y` | 导出坐标系下的舞台中心（长轴、短轴）；换算后成为世界 `x` / `z` |
| `orientationDeg` | 舞台朝向，0=北（朝观众） |
| `width` / `depth` / `height` | 舞台台面尺寸 |
| `catwalkLength` / `catwalkWidth` | T 台长度、宽度 |
| `fohEnabled` / `fohDistance` / `fohWidth` / `fohDepth` | 调音台（FOH） |
| `backdropHeight` | 背景屏高度 |
| `screenClearanceHeight` | 屏幕离地高度 |

未提供 `x` / `y` 时，`getStageTransform` 按内场边界自动摆放舞台。

## infieldModules[]

内场平地座椅模块。`x` / `y` 与 `rotationDeg` 使用导出坐标约定，加载时统一换算；`width` / `depth` / `rows` / `rowPitch` / `seatSpacing` / `slopeDeg` / `baseElevation` 不受影响。

## standTiers[]

极坐标角度看台（`startAngleDeg` / `endAngleDeg`、排数、坡度等）。角度是 0=北 的绝对角度，**不参与坐标换算**。

分区 `fillType` 支持：

| 值 | 渲染 | 可否选座 |
|---|---|---|
| `standard` | 台阶 + 座椅 | 是 |
| `vip-box` | 平台包厢 | 是 |
| `empty-void` | 不渲染 | 否 |
| `solid-wall` | 实体山墙 / 机房（实体块，2D 灰色斜纹） | 否 |

## 校验

```
npm run check:venues
```

检查每个场馆的舞台中心与四角、自动生成的内场区块是否都在内场周界内（支持圆角矩形与椭圆），鸟巢罩棚是否保持马鞍形，越界或失效时以非 0 退出码失败。数据自带的内场模块按外接矩形检查。

/* =====================================================================
   params.js —— 所有可调参数 + 归属（美术 / 程序）+ 面板结构
   归属这件事是这场分享的重点：面板上每一组都明确标出来归谁。
   ===================================================================== */

const DEFAULTS = {
  /* --- 第 1 层：基础光照。diffuse / specular / bounce 三份独立 --- */
  exposure   : 1.00,
  keyInt     : 6.5,
  keyCol     : [1.00, 0.86, 0.66],
  diffAmt    : 1.00,
  specAmt    : 1.00,
  specExp    : 42.0,
  bounceInt  : 0.35,
  bounceCol  : [0.36, 0.50, 0.60],
  ambient    : 0.28,
  skyCol     : [0.42, 0.55, 0.66],
  rimInt     : 0.40,
  rimCol     : [0.52, 0.72, 0.86],
  bgLow      : [0.020, 0.030, 0.040],
  bgHigh     : [0.115, 0.150, 0.180],

  /* --- 第 2 层：体积雾 --- */
  fogDensity : 0.060,
  fogCol     : [0.72, 0.83, 0.92],
  fogHeight  : 0.16,
  fogBase    : 0.20,
  fogCenterX : -0.4,
  fogCenterY : 2.6,
  fogCenterZ : -6.0,
  fogRadius  : 11.0,
  fogG       : 0.62,
  fogAmb     : 0.18,
  fogShadow  : 1,

  /* --- 第 3 层：解析 AO --- */
  aoAmt      : 0.90,
  aoShow     : 0,
  aoSel      : 0,

  /* --- 第 4 层：SSR --- */
  wet        : 0.75,
  ssrAmt     : 1.00,
  ssrEdge    : 1,
  ssrFallback: 0.55,

  /* --- 第 5 层：抖动 --- */
  levels     : 40,
  ramp       : 0,
  rampA      : 0.16,
  rampB      : 0.26,
  magZoom    : 5.0,
  magR       : 0.20,

  /* --- 演示 / 性能 --- */
  charAnim   : 1,
  charX      : 0.0,
  quality    : 1,
  cam        : 0
};

/* AO 几何体：xyz 半径 强度 跟随角色。这就是美术那支“在 3D 里画阴影的笔” */
const AO_DEFAULT = [
  { ax:  0.00, ay: 0.10, az: -2.00, bx:  0.00, by: 0.10, bz: -2.00, r: 0.62, s: 1.00, follow: 1, name: '角色脚下（跟随）' },
  { ax:  2.35, ay: 0.16, az: -3.60, bx:  2.35, by: 0.16, bz: -3.60, r: 1.00, s: 0.85, follow: 0, name: '木箱底' },
  { ax: -3.60, ay: 0.20, az: -6.40, bx: -3.60, by: 0.20, bz: -6.40, r: 1.35, s: 0.90, follow: 0, name: '大箱底' },
  { ax: -7.30, ay: 1.05, az: -3.20, bx: -3.80, by: 1.05, bz: -3.20, r: 0.85, s: 0.80, follow: 0, name: '平台下（胶囊）' },
  { ax:  0.00, ay: 0.30, az: -12.0, bx:  0.00, by: 0.30, bz: -12.0, r: 3.20, s: 0.55, follow: 0, name: '墙脚接缝' },
  { ax:  6.90, ay: 0.30, az: -9.50, bx:  6.90, by: 0.30, bz: -9.50, r: 1.10, s: 0.70, follow: 0, name: '柱脚' }
];
const AO_BUDGET = 8;   // 一屏最多几个 —— 程序给的预算，美术在预算内随便花

/* 固定机位（讲稿里说了：演示途中不要动机位） */
const CAMS = [
  { name: '全景',        pos: [ 0.4, 2.55,  9.6], tgt: [ 0.0, 2.05, -4.0], fov: 33 },
  { name: '剪影近景',    pos: [ 1.5, 1.60,  4.4], tgt: [ 0.5, 1.25, -2.2], fov: 35 },
  { name: '渐变 / 光柱', pos: [-1.2, 3.30,  6.2], tgt: [-0.9, 4.00, -8.0], fov: 31 }
];

/* 画质：直接决定几个循环的步数 */
const QUALITY = [
  { name: '低（投影仪保平安）', scale: 0.60, march: 96,  fog: 20, fogSh: 10, ssr: 24, fogScale: 0.42 },
  { name: '中（默认）',        scale: 0.80, march: 128, fog: 26, fogSh: 14, ssr: 32, fogScale: 0.50 },
  { name: '高（独显）',        scale: 1.00, march: 160, fog: 40, fogSh: 20, ssr: 48, fogScale: 0.50 }
];

/* ---------------------------------------------------------------------
   面板结构。owner: 'art' = 归美术，'tech' = 归程序
   --------------------------------------------------------------------- */
const SCHEMA = [
  {
    layer: 'base', num: '01', title: '基础光照', owner: 'art',
    note: 'INSIDE 的做法：把 diffuse / specular / bounce 拆成三个互不相干的旋钮。' +
          '物理上它们是同一次计算，这里不是。把高光调到物理上不可能的强度，而漫反射一点不动 —— 这就是他们赢的地方。',
    items: [
      { k: 'diffAmt',   t: 'range', label: 'diffuse 漫反射', min: 0, max: 2.5, step: .01 },
      { k: 'specAmt',   t: 'range', label: 'specular 高光',  min: 0, max: 4.0, step: .01, hint: '拉到 3 以上就是物理上的“错”，但画面上可能是对的' },
      { k: 'specExp',   t: 'range', label: '高光收紧',        min: 4, max: 160, step: 1 },
      { k: 'bounceInt', t: 'range', label: 'bounce 反弹光',   min: 0, max: 2.0, step: .01 },
      { k: 'bounceCol', t: 'color', label: '反弹光颜色' },
      { k: 'ambient',   t: 'range', label: '天光强度',        min: 0, max: 2.0, step: .01 },
      { k: 'skyCol',    t: 'color', label: '天光颜色' },
      { k: 'keyInt',    t: 'range', label: '主光强度',        min: 0, max: 80,  step: .5 },
      { k: 'keyCol',    t: 'color', label: '主光颜色' },
      { k: 'rimInt',    t: 'range', label: '轮廓光',          min: 0, max: 2.5, step: .01, hint: '角色和背景分不开的时候，先动这个' },
      { k: 'rimCol',    t: 'color', label: '轮廓光颜色' },
      { k: 'bgLow',     t: 'color', label: '背景 · 下' },
      { k: 'bgHigh',    t: 'color', label: '背景 · 上' },
      { k: 'exposure',  t: 'range', label: '曝光',            min: .2, max: 4, step: .01 }
    ]
  },
  {
    layer: 'fog', num: '02', title: '体积雾 volumetrics', owner: 'art',
    note: '局部的、会被物体挡出阴影的体积雾。它不是氛围特效，是功能件：负责纵深，也负责让玩家一眼找到角色。' +
          '相当于舞台的干冰机加背光。',
    items: [
      { k: 'fogDensity', t: 'range', label: '浓度',        min: 0, max: 0.4, step: .001 },
      { k: 'fogCol',     t: 'color', label: '颜色' },
      { k: 'fogHeight',  t: 'range', label: '高度衰减',    min: 0, max: 1.2, step: .01 },
      { k: 'fogBase',    t: 'range', label: '起始高度',    min: -2, max: 5, step: .05 },
      { k: 'fogCenterX', t: 'range', label: '位置 X',      min: -12, max: 12, step: .1 },
      { k: 'fogCenterY', t: 'range', label: '位置 Y',      min: 0, max: 8, step: .1 },
      { k: 'fogCenterZ', t: 'range', label: '位置 Z',      min: -20, max: 6, step: .1 },
      { k: 'fogRadius',  t: 'range', label: '范围',        min: 2, max: 24, step: .1, hint: '“局部”的意思：不是全场一层雾，是你在需要的地方放一团' },
      { k: 'fogG',       t: 'range', label: '前向散射',    min: -0.4, max: 0.92, step: .01 },
      { k: 'fogAmb',     t: 'range', label: '环境散射',    min: 0, max: 1.5, step: .01 },
      { k: 'fogShadow',  t: 'toggle', label: '被物体遮挡', owner: 'tech',
        hint: '关掉它 → 光柱消失、雾变成一层平糊。“带阴影”这三个字的全部价值都在这里' }
    ]
  },
  {
    layer: 'ao', num: '03', title: '解析 AO（手摆几何体）', owner: 'art',
    note: '不是屏幕空间自动算的，是美术手动摆球体和胶囊体：摆在哪儿，哪儿就暗，而且跟着角色动。' +
          '用法不是“物理上哪儿该暗”，是“你想让玩家的眼睛落在哪儿，就把周围压暗”。它是构图工具。',
    items: [
      { k: 'aoAmt',  t: 'range',  label: '整体强度', min: 0, max: 1.6, step: .01 },
      { k: 'aoShow', t: 'toggle', label: '显示几何体', hint: '打开后在画面里直接拖动就能挪；这就是那支笔' }
    ],
    custom: 'ao'
  },
  {
    layer: 'ssr', num: '04', title: '屏幕空间反射 SSR', owner: 'art',
    note: '它便宜，因为它只反射“屏幕上已经画出来的东西”。画面外的东西不会出现在反射里 —— 这是它的破绽，' +
          '但固定机位的横版游戏几乎看不出来。它的价值不是真实，是让地面变成一个能讲故事的表面。',
    items: [
      { k: 'wet',         t: 'range',  label: '地面湿度',   min: 0, max: 1, step: .01, hint: '湿地面 = 刚下过雨 / 有管子在漏 / 这地方没人管' },
      { k: 'ssrAmt',      t: 'range',  label: '反射强度',   min: 0, max: 1.5, step: .01 },
      { k: 'ssrFallback', t: 'range',  label: '未命中回退', min: 0, max: 1.5, step: .01, owner: 'tech' },
      { k: 'ssrEdge',     t: 'toggle', label: '边缘淡出',   owner: 'tech',
        hint: '关掉它，屏幕边上的反射会硬切 —— 那就是 SSR 的破绽本体' }
    ]
  },
  {
    layer: 'dither', num: '05', title: '抖动 dither', owner: 'tech',
    note: '每通道只有 256 级，长渐变塞进去就出台阶（banding）。做法只有一句：输出前加一层极细的噪声，' +
          '把台阶边界打碎。跟胶片颗粒、录音底噪是同一个原理。极简单、极便宜，所以没有理由带着色带断层发版。',
    items: [
      { k: 'levels',  t: 'range',  label: '量化级数', min: 8, max: 256, step: 1,
        hint: '把它拉到 40 以下 → 台阶暴增（投影仪上才看得见）。256 = 正常 8bit 输出' },
      { k: 'ramp',    t: 'range',  label: '渐变测试条', min: 0, max: 1, step: 1, hint: 'G 键。底部那条极缓的斜坡，专门用来现形' },
      { k: 'rampA',   t: 'range',  label: '斜坡起点', min: 0, max: 1, step: .005 },
      { k: 'rampB',   t: 'range',  label: '斜坡终点', min: 0, max: 1, step: .005 },
      { k: 'magZoom', t: 'range',  label: '放大倍数', min: 2, max: 14, step: .5 },
      { k: 'magR',    t: 'range',  label: '放大镜大小', min: .06, max: .45, step: .01 }
    ]
  },
  {
    layer: 'sys', num: '—', title: '演示 / 性能', owner: 'tech',
    note: '',
    items: [
      { k: 'charAnim', t: 'toggle', label: '角色走动',  hint: 'C 键。走过光柱时能同时看到 雾的遮挡阴影 和 AO 跟着动' },
      { k: 'charX',    t: 'range',  label: '角色位置',  min: -6, max: 6, step: .05 },
      { k: 'quality',  t: 'select', label: '画质',      options: QUALITY.map((q, i) => [i, q.name]) },
      { k: 'cam',      t: 'select', label: '机位',      options: CAMS.map((c, i) => [i, c.name]),
        hint: '演示过程中不要动机位 —— 一动，对比就废了' }
    ]
  }
];

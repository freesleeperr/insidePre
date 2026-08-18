/* =====================================================================
   main.js —— 状态 / 渲染循环 / 交互
   ===================================================================== */

const ST = {
  P: JSON.parse(JSON.stringify(DEFAULTS)),
  ao: JSON.parse(JSON.stringify(AO_DEFAULT)),
  layers:  { fog: 0, ao: 0, ssr: 0, dither: 0 },   // 右侧（当前状态）
  layersL: { fog: 0, ao: 0, ssr: 0, dither: 0 },   // 左侧（分屏对比状态）
  wipe: false, wipeX: 0.5,
  mag: false, magUV: [0.5, 0.5],
  hide: { panel: false, notes: false, clean: false },
  step: 2,
  charT: 0, charX: 0, charPh: 0, charAmp: 0,
  mouse: [0.5, 0.5], drag: null
};

const App = {
  gl: null, canvas: null,
  prog: {}, fboScene: null, fboFog: null, fboComp: null,
  W: 0, H: 0, sw: 0, sh: 0, fw: 0, fh: 0,
  cam: { pos: [0, 0, 0], R: [1, 0, 0], U: [0, 1, 0], F: [0, 0, -1], tanHalf: 0.3 },
  last: 0, fpsAcc: 0, fpsN: 0,

  /* ---------------- 启动 ---------------- */
  init(){
    /* 支持 index.html?q=0 直接指定画质、?cam=1 指定机位、?step=4 直接跳到某一步 */
    const qs = new URLSearchParams(location.search);
    if(qs.has('q'))   ST.P.quality = Math.max(0, Math.min(2, +qs.get('q') | 0));
    if(qs.has('cam')) ST.P.cam     = Math.max(0, Math.min(CAMS.length - 1, +qs.get('cam') | 0));
    if(qs.get('ui') === '0') ST.hide.clean = true;                     // 纯画面

    this.canvas = document.getElementById('gl');
    this.gl = GLU.init(this.canvas);
    if(!this.gl) return;

    try{
      this.prog.scene   = GLU.program(SH.sceneFS,   'scene');
      this.prog.fog     = GLU.program(SH.fogFS,     'fog');
      this.prog.comp    = GLU.program(SH.compFS,    'comp');
      this.prog.present = GLU.program(SH.presentFS, 'present');
    }catch(e){ return; }

    if(!GLU.floatOK){
      console.warn('没有 EXT_color_buffer_float，退回 8bit 中间缓冲：SSR 会稍糙。');
    }

    UI.init();
    this.setStep(qs.has('step') ? +qs.get('step') | 0 : 2);
    this.bindMouse();
    window.addEventListener('resize', () => this.resize());
    this.resize();
    requestAnimationFrame(t => this.frame(t));
  },

  onStructuralChange(){ this.resize(); },

  resize(){
    const gl = this.gl, dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const W = Math.max(320, Math.round(this.canvas.clientWidth  * dpr));
    const H = Math.max(240, Math.round(this.canvas.clientHeight * dpr));
    this.canvas.width = W; this.canvas.height = H;
    this.W = W; this.H = H;

    const q = QUALITY[ST.P.quality] || QUALITY[1];
    this.sw = Math.max(160, Math.round(W * q.scale));
    this.sh = Math.max(120, Math.round(H * q.scale));
    this.fw = Math.max(80,  Math.round(this.sw * q.fogScale));
    this.fh = Math.max(60,  Math.round(this.sh * q.fogScale));

    this.fboScene = GLU.fbo(this.sw, this.sh, 2, true,  gl.LINEAR);
    this.fboFog   = GLU.fbo(this.fw, this.fh, 1, true,  gl.LINEAR);
    this.fboComp  = GLU.fbo(this.sw, this.sh, 1, true,  gl.LINEAR);

    if(!this.fboScene.ok) GLU.fatal('创建浮点 FBO 失败（显卡/驱动不支持 RGBA16F 渲染）。');
    UI.el.resInfo.textContent = this.sw + '×' + this.sh + '  雾 ' + this.fw + '×' + this.fh;
  },

  /* ---------------- 相机 ---------------- */
  updateCam(){
    const c = CAMS[ST.P.cam] || CAMS[0];
    const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const norm = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const F = norm(sub(c.tgt, c.pos));
    const R = norm(cross(F, [0, 1, 0]));
    const U = cross(R, F);
    this.cam = { pos: c.pos.slice(), R, U, F, tanHalf: Math.tan(c.fov * Math.PI / 360) };
  },

  /* 屏幕 uv → 世界射线 */
  ray(uv){
    const c = this.cam, asp = this.W / this.H;
    const sx = (uv[0] * 2 - 1) * asp * c.tanHalf, sy = (uv[1] * 2 - 1) * c.tanHalf;
    const d = [c.F[0] + c.R[0] * sx + c.U[0] * sy,
               c.F[1] + c.R[1] * sx + c.U[1] * sy,
               c.F[2] + c.R[2] * sx + c.U[2] * sy];
    const l = Math.hypot(d[0], d[1], d[2]);
    return [d[0] / l, d[1] / l, d[2] / l];
  },

  frontPoint(){
    const c = this.cam;
    return [c.pos[0] + c.F[0] * 9, Math.max(0.3, c.pos[1] + c.F[1] * 9), c.pos[2] + c.F[2] * 9];
  },

  /* ---------------- 每帧 ---------------- */
  frame(t){
    const dt = Math.min(0.05, (t - this.last) / 1000 || 0.016);
    this.last = t;
    this.fpsAcc += dt; this.fpsN++;
    if(this.fpsAcc > 0.5){
      UI.el.fps.textContent = Math.round(this.fpsN / this.fpsAcc) + ' fps';
      this.fpsAcc = 0; this.fpsN = 0;
    }

    const P = ST.P;
    if(P.charAnim){
      ST.charT += dt;
      ST.charX = -1.0 + 2.8 * Math.sin(ST.charT * 0.24);
      ST.charPh = ST.charT * 3.4;
      ST.charAmp = Math.abs(Math.cos(ST.charT * 0.24));
      P.charX = ST.charX;
    }else{
      ST.charX = P.charX; ST.charPh = 0; ST.charAmp = 0;
    }

    this.updateCam();
    this.render(t / 1000);
    requestAnimationFrame(x => this.frame(x));
  },

  /* 公共 uniform（四个 pass 共用一套） */
  setCommon(p, resW, resH){
    const P = ST.P, c = this.cam;
    GLU.v2(p, 'uRes', resW, resH);
    GLU.v3(p, 'uCamPos', c.pos); GLU.v3(p, 'uCamR', c.R); GLU.v3(p, 'uCamU', c.U); GLU.v3(p, 'uCamF', c.F);
    GLU.f(p, 'uTanHalf', c.tanHalf);
    GLU.f(p, 'uAspect', this.W / this.H);
    GLU.f(p, 'uTime', performance.now() / 1000);

    GLU.f(p, 'uWipeOn', ST.wipe ? 1 : 0);
    GLU.f(p, 'uWipeX', ST.wipeX);
    const L = ST.layersL, R = ST.layers;
    GLU.v4(p, 'uLayL', L.fog, L.ao, L.ssr, L.dither);
    GLU.v4(p, 'uLayR', R.fog, R.ao, R.ssr, R.dither);

    GLU.v3(p, 'uKeyPos', [0.0, 8.6, -6.2]);
    GLU.v3(p, 'uKeyCol', P.keyCol);      GLU.f(p, 'uKeyInt', P.keyInt);
    GLU.v3(p, 'uRimDir', [0.15, -0.25, 0.96]);
    GLU.v3(p, 'uRimCol', P.rimCol);      GLU.f(p, 'uRimInt', P.rimInt);
    GLU.v3(p, 'uBounceCol', P.bounceCol); GLU.f(p, 'uBounceInt', P.bounceInt);
    GLU.v3(p, 'uSkyCol', P.skyCol);      GLU.f(p, 'uAmb', P.ambient);
    GLU.f(p, 'uDiffAmt', P.diffAmt);     GLU.f(p, 'uSpecAmt', P.specAmt);
    GLU.f(p, 'uSpecExp', P.specExp);
    GLU.v3(p, 'uBgLow', P.bgLow);        GLU.v3(p, 'uBgHigh', P.bgHigh);
    GLU.f(p, 'uAOAmt', P.aoAmt);         GLU.f(p, 'uWet', P.wet);

    const A = new Float32Array(32), B = new Float32Array(32);
    const n = Math.min(ST.ao.length, 8);
    for(let i = 0; i < n; i++){
      const a = ST.ao[i], off = a.follow ? ST.charX : 0;
      A[i * 4] = a.ax + off; A[i * 4 + 1] = a.ay; A[i * 4 + 2] = a.az; A[i * 4 + 3] = a.r;
      B[i * 4] = a.bx + off; B[i * 4 + 1] = a.by; B[i * 4 + 2] = a.bz; B[i * 4 + 3] = a.s;
    }
    GLU.v4a(p, 'uAOA[0]', A); GLU.v4a(p, 'uAOB[0]', B); GLU.i(p, 'uAON', n);

    GLU.f(p, 'uCharX', ST.charX); GLU.f(p, 'uCharPh', ST.charPh); GLU.f(p, 'uCharAmp', ST.charAmp);
    GLU.i(p, 'uMarchSteps', (QUALITY[P.quality] || QUALITY[1]).march);
  },

  render(){
    const gl = this.gl, P = ST.P, q = QUALITY[P.quality] || QUALITY[1];

    /* A · 场景 */
    let p = this.prog.scene;
    gl.useProgram(p);
    GLU.bind(this.fboScene);
    this.setCommon(p, this.sw, this.sh);
    GLU.draw();

    /* B · 体积雾（半分辨率） */
    p = this.prog.fog;
    gl.useProgram(p);
    GLU.bind(this.fboFog);
    this.setCommon(p, this.fw, this.fh);
    GLU.samp(p, 'uGBuf', this.fboScene.tex[1], 0);
    GLU.v3(p, 'uFogCol', P.fogCol);
    GLU.v3(p, 'uFogCenter', [P.fogCenterX, P.fogCenterY, P.fogCenterZ]);
    GLU.f(p, 'uFogDensity', P.fogDensity); GLU.f(p, 'uFogHeight', P.fogHeight);
    GLU.f(p, 'uFogBase', P.fogBase);       GLU.f(p, 'uFogRadius', P.fogRadius);
    GLU.f(p, 'uFogG', P.fogG);             GLU.f(p, 'uFogAmb', P.fogAmb);
    GLU.f(p, 'uFogShadow', P.fogShadow ? 1 : 0);
    GLU.i(p, 'uFogSteps', q.fog); GLU.i(p, 'uFogShSteps', q.fogSh);
    GLU.draw();

    /* C · SSR + 合成 */
    p = this.prog.comp;
    gl.useProgram(p);
    GLU.bind(this.fboComp);
    this.setCommon(p, this.sw, this.sh);
    GLU.samp(p, 'uScene',  this.fboScene.tex[0], 0);
    GLU.samp(p, 'uGBuf',   this.fboScene.tex[1], 1);
    GLU.samp(p, 'uFogTex', this.fboFog.tex[0],   2);
    GLU.f(p, 'uSSRAmt', P.ssrAmt); GLU.f(p, 'uSSREdge', P.ssrEdge ? 1 : 0);
    GLU.f(p, 'uSSRFallback', P.ssrFallback);
    GLU.i(p, 'uSSRSteps', q.ssr);
    GLU.f(p, 'uExposure', P.exposure);
    GLU.f(p, 'uAOShow', P.aoShow ? 1 : 0);
    GLU.draw();

    /* D · 放大镜 + 抖动 + 量化 */
    p = this.prog.present;
    gl.useProgram(p);
    GLU.bind(null);
    this.setCommon(p, this.W, this.H);
    GLU.samp(p, 'uComp', this.fboComp.tex[0], 0);
    GLU.f(p, 'uLevels', P.levels);
    GLU.f(p, 'uMagOn', ST.mag ? 1 : 0);
    GLU.v2(p, 'uMagUV', ST.magUV[0], ST.magUV[1]);
    GLU.f(p, 'uMagR', P.magR); GLU.f(p, 'uMagZoom', P.magZoom);
    GLU.f(p, 'uRamp', P.ramp); GLU.f(p, 'uRampA', P.rampA); GLU.f(p, 'uRampB', P.rampB);
    GLU.draw();
  },

  /* ---------------- 交互 ---------------- */
  bindMouse(){
    const cv = this.canvas;
    const uvOf = e => {
      const r = cv.getBoundingClientRect();
      return [(e.clientX - r.left) / r.width, 1 - (e.clientY - r.top) / r.height];
    };

    cv.addEventListener('mousedown', e => {
      const uv = uvOf(e);
      if(ST.P.aoShow){
        const hit = this.pickAO(uv);
        if(hit >= 0){
          ST.P.aoSel = hit;
          const a = ST.ao[hit];
          const off = a.follow ? ST.charX : 0;
          const ctr = [(a.ax + a.bx) / 2 + off, (a.ay + a.by) / 2, (a.az + a.bz) / 2];
          const v = [ctr[0] - this.cam.pos[0], ctr[1] - this.cam.pos[1], ctr[2] - this.cam.pos[2]];
          const depth = v[0] * this.cam.F[0] + v[1] * this.cam.F[1] + v[2] * this.cam.F[2];
          ST.drag = { i: hit, depth, last: this.planePoint(uv, depth), shift: e.shiftKey };
          UI.refreshAO();
          e.preventDefault();
        }
      }
    });

    window.addEventListener('mousemove', e => {
      const uv = uvOf(e);
      ST.mouse = uv;
      if(ST.mag) ST.magUV = uv;

      if(ST.drag){
        const a = ST.ao[ST.drag.i];
        const pt = this.planePoint(uv, ST.drag.depth);
        let d = [pt[0] - ST.drag.last[0], pt[1] - ST.drag.last[1], pt[2] - ST.drag.last[2]];
        if(e.shiftKey){                       // Shift = 沿视线推远/拉近
          const k = d[1] * 6;
          d = [this.cam.F[0] * k, this.cam.F[1] * k, this.cam.F[2] * k];
        }
        a.ax += d[0]; a.ay += d[1]; a.az += d[2];
        a.bx += d[0]; a.by += d[1]; a.bz += d[2];
        ST.drag.last = pt;
      }
    });

    window.addEventListener('mouseup', () => {
      if(ST.drag){ ST.drag = null; UI.refreshAO(); }
    });

    cv.addEventListener('wheel', e => {
      if(!ST.P.aoShow) return;
      const a = ST.ao[ST.P.aoSel];
      if(!a) return;
      a.r = Math.max(0.1, Math.min(5, a.r * (e.deltaY > 0 ? 0.94 : 1.064)));
      UI.refreshAO();
      e.preventDefault();
    }, { passive: false });

    /* 分屏手柄 */
    const hd = UI.el.wipeHandle;
    let dragW = false;
    hd.addEventListener('mousedown', e => { dragW = true; e.preventDefault(); });
    window.addEventListener('mousemove', e => {
      if(!dragW) return;
      const r = cv.getBoundingClientRect();
      ST.wipeX = Math.max(0.02, Math.min(0.98, (e.clientX - r.left) / r.width));
      hd.style.left = (ST.wipeX * 100) + '%';
    });
    window.addEventListener('mouseup', () => { dragW = false; });
  },

  /* 与相机成像平面平行、过给定景深的平面上的点 */
  planePoint(uv, depth){
    const rd = this.ray(uv), c = this.cam;
    const dz = rd[0] * c.F[0] + rd[1] * c.F[1] + rd[2] * c.F[2];
    const t = depth / Math.max(dz, 1e-3);
    return [c.pos[0] + rd[0] * t, c.pos[1] + rd[1] * t, c.pos[2] + rd[2] * t];
  },

  /* 射线选中最近的 AO 几何体 */
  pickAO(uv){
    const rd = this.ray(uv), ro = this.cam.pos;
    let best = -1, bt = 1e9;
    ST.ao.forEach((a, i) => {
      const off = a.follow ? ST.charX : 0;
      for(let j = 0; j < 3; j++){
        const k = j * 0.5;
        const c = [a.ax + (a.bx - a.ax) * k + off, a.ay + (a.by - a.ay) * k, a.az + (a.bz - a.az) * k];
        const oc = [ro[0] - c[0], ro[1] - c[1], ro[2] - c[2]];
        const b = oc[0] * rd[0] + oc[1] * rd[1] + oc[2] * rd[2];
        const cc = oc[0] * oc[0] + oc[1] * oc[1] + oc[2] * oc[2] - a.r * a.r;
        const h = b * b - cc;
        if(h > 0){
          const t = -b - Math.sqrt(h);
          if(t > 0 && t < bt){ bt = t; best = i; }
        }
      }
    });
    return best;
  },

  /* ---------------- 状态操作 ---------------- */
  setLayers(o){ Object.assign(ST.layers, o); },

  setStep(i){
    ST.step = Math.max(0, Math.min(STEPS.length - 1, i));
    const s = STEPS[ST.step];
    Object.assign(ST.layers, s.layers);
    if(s.apply){
      Object.keys(s.apply).forEach(k => {
        if(k === 'magOn') ST.mag = !!s.apply[k];
        else ST.P[k] = s.apply[k];
      });
    }
    UI.showStep(ST.step);
    UI.syncAll();
  },

  toggle(k){
    if(k === 'wipe') ST.wipe = !ST.wipe;
    else if(k === 'mag'){ ST.mag = !ST.mag; if(ST.mag) ST.magUV = ST.mouse; }
    else ST.hide[k] = !ST.hide[k];
    UI.syncAll();
  },

  reset(){
    ST.P = JSON.parse(JSON.stringify(DEFAULTS));
    ST.ao = JSON.parse(JSON.stringify(AO_DEFAULT));
    UI.buildPanel();
    this.resize();
    UI.syncAll();
  }
};

window.addEventListener('DOMContentLoaded', () => App.init());

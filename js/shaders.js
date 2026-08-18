/* =====================================================================
   shaders.js —— 全部 GLSL（WebGL2 / GLSL ES 3.00）
   管线：
     pass A  scene    : SDF raymarch 出 基础光照 + 解析AO  → color(+反射率) / gbuf(法线+深度)
     pass B  fog      : 半分辨率 体积雾（带阴影）           → 内散射 + 透射率
     pass C  comp     : SSR + 雾合成 + 曝光/tonemap        → 线性显示图
     pass D  present  : 放大镜 + 抖动 + 量化 + 分屏线       → 屏幕
   分屏(wipe)：每一层的开关都是 per-pixel 的 mix(左状态, 右状态)，
              所以左右两半各自只算自己那一份，几乎不额外花钱。
   ===================================================================== */
const SH = {};

/* ---------------- 全屏三角形 ---------------- */
SH.vert = `#version 300 es
precision highp float;
out vec2 vUV;
void main(){
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUV = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

/* ---------------- 公共：相机 / 分层开关 / 灯光 / 噪声 ---------------- */
SH.common = `
uniform vec2  uRes;
uniform vec3  uCamPos, uCamR, uCamU, uCamF;
uniform float uTanHalf, uAspect, uTime;

uniform float uWipeOn, uWipeX;
uniform vec4  uLayL, uLayR;          // x=雾 y=AO z=SSR w=抖动

uniform vec3  uKeyPos, uKeyCol;  uniform float uKeyInt;
uniform vec3  uRimDir, uRimCol;  uniform float uRimInt;
uniform vec3  uBounceCol, uSkyCol;
uniform float uBounceInt, uAmb, uDiffAmt, uSpecAmt, uSpecExp;
uniform vec3  uBgLow, uBgHigh;
uniform float uAOAmt, uWet;

uniform vec4  uAOA[8];               // xyz=A点  w=半径
uniform vec4  uAOB[8];               // xyz=B点  w=强度
uniform int   uAON;

uniform float uCharX, uCharPh, uCharAmp;
uniform int   uMarchSteps;

const float FAR = 64.0;

float sideAt(vec2 uv){ return (uWipeOn > 0.5) ? step(uWipeX, uv.x) : 1.0; }
vec4  layersAt(vec2 uv){ return mix(uLayL, uLayR, sideAt(uv)); }

vec3 rayDir(vec2 uv){
  vec2 s = uv * 2.0 - 1.0;
  return normalize(uCamF + uCamR * (s.x * uAspect * uTanHalf) + uCamU * (s.y * uTanHalf));
}

float hash12(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

/* ---- 背景：一大片非常平滑的渐变（第 5 层 banding 就靠它现形）---- */
vec3 background(vec3 rd){
  float h = clamp(rd.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 c = mix(uBgLow, uBgHigh, pow(h, 1.35));
  vec3 kd = normalize(uKeyPos - uCamPos);
  c += uKeyCol * uKeyInt * pow(max(dot(rd, kd), 0.0), 16.0) * 0.020;
  return c;
}
`;

/* ---------------- 公共：SDF 场景 / 材质 / 光照 / 解析AO ---------------- */
SH.sdf = `
float sdBox(vec3 p, vec3 b){ vec3 q = abs(p) - b; return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0); }
float sdRBox(vec3 p, vec3 b, float r){ return sdBox(p, b - vec3(r)) - r; }
float sdCap(vec3 p, vec3 a, vec3 b, float r){
  vec3 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - r;
}
vec2 opU(vec2 a, vec2 b){ return (a.x < b.x) ? a : b; }

/* 角色：胶囊拼的剪影（材质 0 = 近乎全黑） */
vec2 mapChar(vec3 p){
  vec3 q = p - vec3(uCharX, 0.0, -2.0);
  q.y -= uCharAmp * 0.035 * sin(uCharPh * 2.0);
  float sw = uCharAmp * 0.30 * sin(uCharPh);
  float d = sdCap(q, vec3(0.0, 0.52, 0.0), vec3(0.0, 1.10, 0.0), 0.185);
  d = min(d, length(q - vec3(0.02, 1.38, 0.0)) - 0.185);
  d = min(d, sdCap(q, vec3(-0.06, 0.55, 0.0), vec3(-0.06 + sw, 0.09, 0.0), 0.082));
  d = min(d, sdCap(q, vec3( 0.06, 0.55, 0.0), vec3( 0.06 - sw, 0.09, 0.0), 0.082));
  d = min(d, sdCap(q, vec3(-0.05, 1.06, 0.0), vec3(-0.05 - sw * 0.8, 0.70, 0.0), 0.060));
  d = min(d, sdCap(q, vec3( 0.05, 1.06, 0.0), vec3( 0.05 + sw * 0.8, 0.70, 0.0), 0.060));
  return vec2(d, 0.0);
}

/* 材质：1 地面 / 2 混凝土 / 3 木箱 / 4 管道 / 5 顶部格栅 */
vec2 mapScene(vec3 p){
  vec2 res = vec2(p.y, 1.0);                                                   // 地面
  res = opU(res, vec2(sdBox(p - vec3(0.0, 4.0, -12.5), vec3(17.0, 4.0, 0.4)), 2.0));
  res = opU(res, vec2(sdBox(p - vec3(0.0, 4.4, -24.0), vec3(34.0, 4.4, 0.4)), 2.0));
  res = opU(res, vec2(sdBox(p - vec3(-7.2, 2.4, -8.5), vec3(0.55, 2.4, 0.55)), 2.0));
  res = opU(res, vec2(sdBox(p - vec3( 6.9, 2.9, -9.5), vec3(0.50, 2.9, 0.50)), 2.0));
  res = opU(res, vec2(sdRBox(p - vec3(-5.6, 1.35, -3.2), vec3(2.0, 0.14, 1.1), 0.05), 3.0));  // 平台
  res = opU(res, vec2(sdBox(p - vec3(-7.0, 0.68, -3.2), vec3(0.16, 0.68, 0.9)), 3.0));
  res = opU(res, vec2(sdRBox(p - vec3(2.35, 0.62, -3.6), vec3(0.62), 0.04), 3.0));            // 木箱
  res = opU(res, vec2(sdRBox(p - vec3(3.55, 0.42, -4.4), vec3(0.42), 0.04), 3.0));
  res = opU(res, vec2(sdRBox(p - vec3(2.55, 1.55, -4.9), vec3(0.70, 0.35, 0.70), 0.04), 3.0));
  res = opU(res, vec2(sdRBox(p - vec3(-3.6, 0.95, -6.4), vec3(0.95), 0.05), 3.0));
  res = opU(res, vec2(sdCap(p, vec3(-18.0, 3.90, -7.4), vec3(18.0, 3.90, -7.4), 0.16), 4.0)); // 管道
  res = opU(res, vec2(sdCap(p, vec3(-18.0, 4.25, -7.7), vec3(18.0, 4.25, -7.7), 0.10), 4.0));
  res = opU(res, vec2(sdBox(p - vec3(0.0, 5.75, 1.6), vec3(22.0, 0.35, 0.5)), 2.0));          // 前景横梁
  /* 顶部格栅：域重复，光从缝隙漏下去 = 光柱 */
  vec3 g = p - vec3(0.0, 5.05, -6.2);
  float gx = g.x - clamp(floor(g.x / 0.85 + 0.5), -7.0, 7.0) * 0.85;
  res = opU(res, vec2(sdBox(vec3(gx, g.y, g.z), vec3(0.105, 0.12, 2.7)), 5.0));
  res = opU(res, mapChar(p));
  return res;
}

vec3 calcNormal(vec3 p){
  vec2 e = vec2(1.0, -1.0) * 0.0016;
  return normalize(e.xyy * mapScene(p + e.xyy).x + e.yyx * mapScene(p + e.yyx).x +
                   e.yxy * mapScene(p + e.yxy).x + e.xxx * mapScene(p + e.xxx).x);
}

float softShadow(vec3 ro, vec3 rd, float mint, float maxt, float k){
  float res = 1.0, t = mint;
  for(int i = 0; i < 40; i++){
    if(t > maxt) break;
    float h = mapScene(ro + rd * t).x;
    if(h < 0.0015) return 0.0;
    res = min(res, k * h / t);
    t += clamp(h, 0.02, 0.7);
  }
  return clamp(res, 0.0, 1.0);
}

void matInfo(float m, out vec3 alb, out float rough, out float refl){
  if(m < 0.5)      { alb = vec3(0.012);                rough = 0.80; refl = 0.0;  } // 角色剪影
  else if(m < 1.5) { alb = vec3(0.052, 0.056, 0.062);  rough = 0.22; refl = 1.0;  } // 地面（可湿）
  else if(m < 2.5) { alb = vec3(0.074, 0.080, 0.090);  rough = 0.85; refl = 0.0;  } // 混凝土
  else if(m < 3.5) { alb = vec3(0.100, 0.092, 0.080);  rough = 0.75; refl = 0.0;  } // 木箱
  else if(m < 4.5) { alb = vec3(0.085, 0.092, 0.100);  rough = 0.30; refl = 0.35; } // 金属管
  else             { alb = vec3(0.045);                rough = 0.65; refl = 0.0;  } // 格栅
}

/* iq 的解析球体遮蔽：一个球对某点某法线的遮蔽量，闭式解，没有采样噪点 */
float sphOcc(vec3 pos, vec3 nor, vec3 sc, float sr){
  vec3 di = sc - pos;
  float l  = max(length(di), 1e-4);
  float nl = dot(nor, di / l);
  float h  = max(l / max(sr, 1e-3), 1.001);
  float h2 = h * h;
  float k2 = 1.0 - h2 * nl * nl;
  float res = max(0.0, nl) / h2;
  if(k2 > 0.001){
    res = nl * acos(clamp(-nl * sqrt((h2 - 1.0) / (1.0 - nl * nl)), -1.0, 1.0))
        - sqrt(max(k2 * (h2 - 1.0), 0.0));
    res = res / h2 + atan(sqrt(k2 / (h2 - 1.0)));
    res /= 3.14159265;
  }
  return clamp(res, 0.0, 1.0);
}

/* 美术手摆的球 / 胶囊 —— 胶囊用 3 个球近似 */
float aoPrims(vec3 p, vec3 n){
  float occ = 0.0;
  for(int i = 0; i < 8; i++){
    if(i >= uAON) break;
    vec3 a = uAOA[i].xyz;  float r = uAOA[i].w;
    vec3 b = uAOB[i].xyz;  float s = uAOB[i].w;
    float seg = dot(b - a, b - a);
    float w = (seg > 1e-4) ? 0.5 : (1.0 / 3.0);
    occ += s * w * sphOcc(p, n, a, r);
    occ += s * w * sphOcc(p, n, mix(a, b, 0.5), r);
    occ += s * w * sphOcc(p, n, b, r);
  }
  return clamp(occ, 0.0, 1.0);
}

/* diffuse / specular / bounce 三份完全独立 —— 这就是整场分享的论点 */
vec3 shade(vec3 p, vec3 n, vec3 rd, float m, float aoOn, out float refl){
  vec3 alb; float rough, r0;
  matInfo(m, alb, rough, r0);
  refl = r0 * uWet * ((m > 0.5 && m < 1.5) ? 1.0 : 0.35);

  vec3  lv = uKeyPos - p;
  float ld = length(lv);
  vec3  l  = lv / ld;
  float att = 1.0 / (1.0 + 0.020 * ld * ld);
  float sh  = softShadow(p + n * 0.02, l, 0.03, ld - 0.15, 10.0);
  float ao  = mix(1.0, 1.0 - uAOAmt * aoPrims(p, n), clamp(aoOn, 0.0, 1.0));

  vec3 key = uKeyCol * uKeyInt * att;

  vec3 diff = alb * key * max(dot(n, l), 0.0) * sh * uDiffAmt;

  vec3  hv = normalize(l - rd);
  float sp = pow(max(dot(n, hv), 0.0), uSpecExp) * (uSpecExp + 8.0) / 25.0;
  vec3  spec = key * sp * sh * uSpecAmt * mix(0.03, 1.0, 1.0 - rough);

  float up = n.y * 0.5 + 0.5;
  vec3  bounce = alb * uBounceCol * uBounceInt * (1.0 - up);   // 地面弹上来的
  vec3  sky    = alb * uSkyCol * uAmb * up;

  float rn = max(dot(n, -uRimDir), 0.0);
  float fr = pow(1.0 - max(dot(n, -rd), 0.0), 3.0);
  vec3  rim = uRimCol * uRimInt * rn * fr;

  return diff * (0.40 + 0.60 * ao) + (bounce + sky) * ao + spec + rim * (0.5 + 0.5 * ao);
}
`;

/* ---------------- pass A：场景 ---------------- */
SH.sceneFS = `#version 300 es
precision highp float;
precision highp int;
in vec2 vUV;
layout(location = 0) out vec4 oColor;   // rgb=基础光照  a=反射率
layout(location = 1) out vec4 oGBuf;    // rgb=法线      a=距离/FAR
` + SH.common + SH.sdf + `
void main(){
  vec2 uv = vUV;
  vec3 rd = rayDir(uv), ro = uCamPos;
  vec4 lay = layersAt(uv);

  float t = 0.05, m = -1.0;
  bool hit = false;
  for(int i = 0; i < 200; i++){
    if(i >= uMarchSteps) break;
    vec2 d = mapScene(ro + rd * t);
    if(d.x < 0.0012 * t){ hit = true; m = d.y; break; }
    t += d.x * 0.92;
    if(t > FAR) break;
  }

  if(!hit){
    oColor = vec4(background(rd), 0.0);
    oGBuf  = vec4(0.0, 0.0, 1.0, 1.0);
    return;
  }
  vec3 p = ro + rd * t;
  vec3 n = calcNormal(p);
  float refl;
  vec3 col = shade(p, n, rd, m, lay.y, refl);
  oColor = vec4(col, refl);
  oGBuf  = vec4(n, t / FAR);
}`;

/* ---------------- pass B：体积雾（半分辨率） ---------------- */
SH.fogFS = `#version 300 es
precision highp float;
precision highp int;
in vec2 vUV;
out vec4 oFog;                          // rgb=内散射  a=透射率
uniform sampler2D uGBuf;
uniform vec3  uFogCol, uFogCenter;
uniform float uFogDensity, uFogHeight, uFogBase, uFogRadius, uFogG, uFogShadow, uFogAmb;
uniform int   uFogSteps, uFogShSteps;
` + SH.common + SH.sdf + `
float fogDens(vec3 p){
  vec3  d   = (p - uFogCenter) * vec3(1.0, 0.72, 1.0);
  float vol = 1.0 - smoothstep(uFogRadius * 0.45, uFogRadius, length(d));   // “局部”：美术摆一团
  float hgt = exp(-max(p.y - uFogBase, 0.0) * uFogHeight);
  return uFogDensity * vol * hgt;
}
float bayer2(vec2 a){ a = floor(a); return fract(a.x / 2.0 + a.y * a.y * 0.75); }
float bayer4(vec2 a){ return bayer2(0.5 * a) * 0.25 + bayer2(a); }
float hg(float c, float g){ float g2 = g * g; return (1.0 - g2) / pow(1.0 + g2 - 2.0 * g * c, 1.5); }

/* “带阴影”：物体挡住光 → 光柱里切出暗影 */
float shadowTo(vec3 p, vec3 l, float dist){
  float t = 0.15;
  for(int i = 0; i < 32; i++){
    if(i >= uFogShSteps || t > dist) break;
    float h = mapScene(p + l * t).x;
    if(h < 0.02) return 0.0;
    t += clamp(h, 0.15, 1.6);
  }
  return 1.0;
}

void main(){
  vec2 uv = vUV;
  float on = layersAt(uv).x;
  if(on < 0.005){ oFog = vec4(0.0, 0.0, 0.0, 1.0); return; }

  vec3 rd = rayDir(uv), ro = uCamPos;
  float sceneT = texture(uGBuf, uv).w * FAR;
  if(sceneT > FAR - 1.0) sceneT = 42.0;
  float maxT = min(sceneT, 42.0);

  int   N  = uFogSteps;
  float dt = maxT / float(N);
  float t  = dt * (0.25 + 0.5 * bayer4(gl_FragCoord.xy)) + 0.03;     // 有序抖动步长，去环状条纹

  vec3 acc = vec3(0.0);
  float tr = 1.0;
  for(int i = 0; i < 64; i++){
    if(i >= N) break;
    vec3 p = ro + rd * t;
    float d = fogDens(p);
    if(d > 0.0004){
      vec3  lv = uKeyPos - p;
      float ll = length(lv);
      vec3  l  = lv / ll;
      float att = 1.0 / (1.0 + 0.020 * ll * ll);
      float sh  = (uFogShadow > 0.5) ? shadowTo(p, l, ll - 0.25) : 1.0;
      float ph  = clamp(hg(dot(rd, l), uFogG), 0.0, 6.0);
      /* 0.05：把「按表面反照率调出来的」灯光强度换算到散射量纲上 */
      vec3  li  = uKeyCol * uKeyInt * att * sh * ph * 0.05 + uSkyCol * uFogAmb * 0.15;
      float sig = d * dt;
      acc += tr * li * uFogCol * sig;
      tr  *= exp(-sig * 1.15);
    }
    t += dt;
  }
  oFog = vec4(acc * on, mix(1.0, tr, on));
}`;

/* ---------------- pass C：SSR + 合成 ---------------- */
SH.compFS = `#version 300 es
precision highp float;
precision highp int;
in vec2 vUV;
out vec4 oCol;
uniform sampler2D uScene, uGBuf, uFogTex;
uniform float uSSRAmt, uSSREdge, uSSRFallback, uExposure, uAOShow;
uniform int   uSSRSteps;
` + SH.common + `
float bayer2c(vec2 a){ a = floor(a); return fract(a.x / 2.0 + a.y * a.y * 0.75); }
float bayer4(vec2 a){ return bayer2c(0.5 * a) * 0.25 + bayer2c(a); }
vec3 ACES(vec3 x){
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}
/* 世界坐标 → 屏幕 uv（必须和 rayDir 完全互逆） */
bool project(vec3 wp, out vec2 uv, out float dist){
  vec3 v = wp - uCamPos;
  float z = dot(v, uCamF);
  dist = length(v);
  if(z < 0.05) return false;
  vec2 nd = vec2(dot(v, uCamR), dot(v, uCamU)) / (z * uTanHalf);
  nd.x /= uAspect;
  uv = nd * 0.5 + 0.5;
  return all(greaterThanEqual(uv, vec2(0.0))) && all(lessThanEqual(uv, vec2(1.0)));
}
/* AO 几何体的可视化：直接和相机射线求交，画一圈描边 */
float aoGizmo(vec3 ro, vec3 rd, float sceneT){
  float e = 0.0;
  for(int i = 0; i < 8; i++){
    if(i >= uAON) break;
    for(int j = 0; j < 3; j++){
      vec3 c = mix(uAOA[i].xyz, uAOB[i].xyz, float(j) * 0.5);
      float r = uAOA[i].w;
      vec3 oc = ro - c;
      float b = dot(oc, rd), cc = dot(oc, oc) - r * r, h = b * b - cc;
      if(h > 0.0){
        float th = -b - sqrt(h);
        if(th > 0.0 && th < sceneT){
          vec3 nn = normalize(ro + rd * th - c);
          e = max(e, pow(1.0 - abs(dot(nn, rd)), 2.5));
        }
      }
    }
  }
  return e;
}
void main(){
  vec2 uv = vUV;
  vec4 lay = layersAt(uv);
  vec4 sc  = texture(uScene, uv);
  vec4 gb  = texture(uGBuf,  uv);
  float t  = gb.w * FAR;
  vec3  rd = rayDir(uv), ro = uCamPos;
  vec3 col = sc.rgb;

  /* ---- 屏幕空间反射：只反射“屏幕上已经画出来的东西” ---- */
  float refl = sc.a * uSSRAmt * lay.z;
  if(refl > 0.002 && t < FAR - 1.0){
    vec3 n = gb.xyz;
    vec3 p = ro + rd * t;
    vec3 r = reflect(rd, n);
    float fres = 0.04 + 0.96 * pow(1.0 - max(dot(-rd, n), 0.0), 4.0);

    float stepLen = 0.26;
    vec3 q = p + n * 0.03 + r * stepLen * bayer4(gl_FragCoord.xy);   // 起点抖动，避免出现规律条纹
    float conf = 0.0;
    vec3 hitCol = vec3(0.0);
    for(int i = 0; i < 64; i++){
      if(i >= uSSRSteps) break;
      q += r * stepLen;
      stepLen *= 1.12;
      vec2 suv; float qd;
      if(!project(q, suv, qd)) break;                 // 出画 = 找不到 → SSR 的破绽
      float sT = texture(uGBuf, suv).w * FAR;
      float diff = qd - sT;
      if(diff > 0.0 && diff < stepLen * 2.5 + 0.35){
        vec3 lo = q - r * stepLen, hi = q;            // 二分细化
        for(int k = 0; k < 5; k++){
          vec3 mid = (lo + hi) * 0.5;
          vec2 mu; float md;
          if(!project(mid, mu, md)) break;
          float mT = texture(uGBuf, mu).w * FAR;
          if(md - mT > 0.0) hi = mid; else lo = mid;
        }
        vec2 fu; float fd;
        if(project(hi, fu, fd)){
          hitCol = texture(uScene, fu).rgb;
          vec2 ef = smoothstep(vec2(0.0), vec2(0.14), fu) * smoothstep(vec2(0.0), vec2(0.14), 1.0 - fu);
          conf = mix(1.0, ef.x * ef.y, uSSREdge);
        }
        break;
      }
    }
    vec3 refCol = mix(mix(uBgLow, uBgHigh, 0.35) * uSSRFallback, hitCol, conf);
    col = mix(col, refCol, clamp(refl * fres * 2.2, 0.0, 0.92));
  }

  /* ---- AO 几何体描边（美术那支“笔”长什么样）---- */
  if(uAOShow > 0.5 && lay.y > 0.5){
    float e = aoGizmo(ro, rd, (t < FAR - 1.0) ? t : FAR);
    col += vec3(0.16, 0.40, 0.30) * e * 0.9;
  }

  /* ---- 体积雾合成 ---- */
  vec4 fg = texture(uFogTex, uv);
  col = col * fg.a + fg.rgb;

  col = ACES(col * uExposure);
  col = pow(col, vec3(1.0 / 2.2));
  oCol = vec4(col, 1.0);
}`;

/* ---------------- pass D：放大镜 + 抖动 + 量化 ---------------- */
SH.presentFS = `#version 300 es
precision highp float;
in vec2 vUV;
out vec4 oCol;
uniform sampler2D uComp;
uniform float uLevels, uMagOn, uMagR, uMagZoom, uRamp, uRampA, uRampB;
uniform vec2  uMagUV;
` + SH.common + `
void main(){
  vec2 uv = vUV;
  float ring = 0.0;

  if(uMagOn > 0.5){
    vec2 d = uv - uMagUV;
    float r = length(vec2(d.x * uAspect, d.y));
    if(r < uMagR){
      uv = uMagUV + d / uMagZoom;
      ring = smoothstep(uMagR - 0.0035, uMagR - 0.0015, r);
    }
  }

  vec3 c = texture(uComp, uv).rgb;

  /* 渐变测试条：一条极缓的斜坡，专门用来现形 banding */
  if(uRamp > 0.5 && uv.y < 0.13){
    float g = uRampA + (uRampB - uRampA) * clamp(uv.x, 0.0, 1.0);
    float edge = smoothstep(0.13, 0.115, uv.y);
    c = mix(c, vec3(g), edge);
  }

  /* 抖动：输出前加一层极细的三角分布噪声，把台阶边界打碎 */
  float lv = max(uLevels, 2.0);
  if(layersAt(vUV).w > 0.5){
    float n1 = hash12(gl_FragCoord.xy + 0.5);
    float n2 = hash12(gl_FragCoord.xy + 71.13);
    c += vec3(n1 - n2) / lv;            // TPDF，峰值 ±1 LSB
  }
  c = floor(c * lv + 0.5) / lv;         // 量化到 N 级（256 = 普通 8bit 输出）

  if(uWipeOn > 0.5){
    float d = abs(vUV.x - uWipeX) * uRes.x;
    c = mix(vec3(0.88, 0.66, 0.42), c, smoothstep(0.5, 1.6, d));
  }
  c = mix(c, vec3(0.88, 0.66, 0.42), ring);
  oCol = vec4(c, 1.0);
}`;

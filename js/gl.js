/* =====================================================================
   gl.js —— 极小的 WebGL2 封装：编译 / FBO / uniform 缓存
   ===================================================================== */
const GLU = {
  gl: null,
  floatOK: false,

  init(canvas){
    const gl = canvas.getContext('webgl2', {
      antialias: false, alpha: false, depth: false, stencil: false,
      preserveDrawingBuffer: false, powerPreference: 'high-performance'
    });
    if(!gl){ GLU.fatal('这台机器的浏览器没有 WebGL2。\n换 Chrome / Edge 新版本，或者检查显卡驱动。'); return null; }
    this.gl = gl;
    this.floatOK = !!gl.getExtension('EXT_color_buffer_float');
    gl.getExtension('OES_texture_float_linear');
    gl.bindVertexArray(gl.createVertexArray());   // WebGL2 要求有 VAO 才能无属性绘制
    return gl;
  },

  fatal(msg){
    const box = document.getElementById('err');
    document.getElementById('errText').textContent = msg;
    box.hidden = false;
  },

  compile(type, src, tag){
    const gl = this.gl;
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if(!gl.getShaderParameter(s, gl.COMPILE_STATUS)){
      const log = gl.getShaderInfoLog(s);
      const lines = src.split('\n');
      let ctx = '';
      (log.match(/\d+:(\d+)/g) || []).forEach(m => {
        const ln = parseInt(m.split(':')[1], 10);
        for(let i = Math.max(0, ln - 3); i < Math.min(lines.length, ln + 2); i++)
          ctx += String(i + 1).padStart(4) + ' | ' + lines[i] + '\n';
        ctx += '\n';
      });
      this.fatal('着色器编译失败 [' + tag + ']\n\n' + log + '\n' + ctx);
      throw new Error('shader ' + tag);
    }
    return s;
  },

  program(fsSrc, tag){
    const gl = this.gl;
    const p = gl.createProgram();
    gl.attachShader(p, this.compile(gl.VERTEX_SHADER, SH.vert, tag + '.vs'));
    gl.attachShader(p, this.compile(gl.FRAGMENT_SHADER, fsSrc, tag + '.fs'));
    gl.linkProgram(p);
    if(!gl.getProgramParameter(p, gl.LINK_STATUS)){
      this.fatal('链接失败 [' + tag + ']\n' + gl.getProgramInfoLog(p));
      throw new Error('link ' + tag);
    }
    p._u = {};
    return p;
  },

  tex(w, h, float, filter){
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    const useF = float && this.floatOK;
    gl.texImage2D(gl.TEXTURE_2D, 0, useF ? gl.RGBA16F : gl.RGBA8, w, h, 0,
                  gl.RGBA, useF ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE, null);
    const f = filter || gl.LINEAR;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    t._w = w; t._h = h;
    return t;
  },

  /* n 张附件的 FBO */
  fbo(w, h, n, float, filter){
    const gl = this.gl;
    const f = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    const texs = [], bufs = [];
    for(let i = 0; i < n; i++){
      const t = this.tex(w, h, float, filter);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0);
      texs.push(t);
      bufs.push(gl.COLOR_ATTACHMENT0 + i);
    }
    gl.drawBuffers(bufs);
    const st = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { fb: f, tex: texs, w, h, ok: st === gl.FRAMEBUFFER_COMPLETE };
  },

  bind(target){
    const gl = this.gl;
    if(target){
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fb);
      gl.viewport(0, 0, target.w, target.h);
    }else{
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    }
  },

  draw(){ this.gl.drawArrays(this.gl.TRIANGLES, 0, 3); },

  loc(p, n){
    if(!(n in p._u)) p._u[n] = this.gl.getUniformLocation(p, n);
    return p._u[n];
  },
  f (p, n, v){ const l = this.loc(p, n); if(l) this.gl.uniform1f(l, v); },
  i (p, n, v){ const l = this.loc(p, n); if(l) this.gl.uniform1i(l, v); },
  v2(p, n, a, b){ const l = this.loc(p, n); if(l) this.gl.uniform2f(l, a, b); },
  v3(p, n, a){ const l = this.loc(p, n); if(l) this.gl.uniform3f(l, a[0], a[1], a[2]); },
  v4(p, n, a, b, c, d){ const l = this.loc(p, n); if(l) this.gl.uniform4f(l, a, b, c, d); },
  v4a(p, n, arr){ const l = this.loc(p, n); if(l) this.gl.uniform4fv(l, arr); },
  samp(p, n, tex, unit){
    const gl = this.gl, l = this.loc(p, n);
    if(!l) return;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(l, unit);
  }
};

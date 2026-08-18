/* =====================================================================
   ui.js —— 面板 / 提词器 / 快捷键（只管 DOM，状态在 main.js 的 ST 里）
   ===================================================================== */
const UI = {
  el: {},
  groups: {},

  /* --- 颜色：面板里按感知亮度显示，存的是线性值 --- */
  toHex(c){
    const f = v => Math.round(Math.pow(Math.max(0, Math.min(1, v)), 1 / 2.2) * 255)
                     .toString(16).padStart(2, '0');
    return '#' + f(c[0]) + f(c[1]) + f(c[2]);
  },
  fromHex(h){
    const g = i => Math.pow(parseInt(h.substr(1 + i * 2, 2), 16) / 255, 2.2);
    return [g(0), g(1), g(2)];
  },

  init(){
    const $ = id => document.getElementById(id);
    this.el = {
      panel: $('panel'), notes: $('notes'), nBody: $('nBody'), nTitle: $('nTitle'), nTime: $('nTime'),
      stepLabel: $('stepLabel'), fps: $('fps'), resInfo: $('resInfo'), hint: $('hint'),
      wipeUI: $('wipeUI'), wipeHandle: $('wipeHandle'), tagL: $('wipeTagL'), tagR: $('wipeTagR'),
      help: $('help')
    };
    this.buildPanel();
    this.bindChrome();
    this.bindKeys();
    this.syncAll();
  },

  /* ---------------- 参数面板 ---------------- */
  buildPanel(){
    const P = ST.P, host = this.el.panel;
    host.innerHTML = '';

    SCHEMA.forEach(g => {
      const box = document.createElement('div');
      box.className = 'grp';
      box.dataset.layer = g.layer;

      const head = document.createElement('div');
      head.className = 'ghead';
      head.innerHTML = '<span class="gnum">' + g.num + '</span><h4>' + g.title + '</h4>' +
        '<span class="own ' + g.owner + '">' + (g.owner === 'art' ? '归美术' : '归程序') + '</span>';
      box.appendChild(head);

      if(g.note){
        const n = document.createElement('p');
        n.className = 'gnote';
        n.textContent = g.note;
        box.appendChild(n);
      }

      g.items.forEach(it => box.appendChild(this.buildRow(it, P)));
      if(g.custom === 'ao') this.buildAO(box);

      host.appendChild(box);
      this.groups[g.layer] = box;
    });
  },

  buildRow(it, P){
    const row = document.createElement('div');
    row.className = 'row';
    const tag = it.owner === 'tech' ? ' <b style="color:#8fa2d8">·程</b>' : '';

    if(it.t === 'toggle'){
      row.className = 'row tg' + (P[it.k] ? ' on' : '');
      row.innerHTML = '<label>' + it.label + tag + '</label><span class="sw"></span>';
      row.onclick = () => { P[it.k] = P[it.k] ? 0 : 1; row.classList.toggle('on', !!P[it.k]); };
    }else if(it.t === 'color'){
      row.innerHTML = '<label>' + it.label + tag + '</label>';
      const inp = document.createElement('input');
      inp.type = 'color';
      inp.value = this.toHex(P[it.k]);
      inp.oninput = () => { P[it.k] = this.fromHex(inp.value); };
      row.appendChild(inp);
      row._sync = () => { inp.value = this.toHex(P[it.k]); };
    }else if(it.t === 'select'){
      row.innerHTML = '<label>' + it.label + tag + '</label>';
      const sel = document.createElement('select');
      it.options.forEach(o => {
        const op = document.createElement('option');
        op.value = o[0]; op.textContent = o[1];
        sel.appendChild(op);
      });
      sel.value = P[it.k];
      sel.onchange = () => { P[it.k] = parseInt(sel.value, 10); App.onStructuralChange(); };
      row.appendChild(sel);
      row._sync = () => { sel.value = P[it.k]; };
    }else{
      row.innerHTML = '<label>' + it.label + tag + '</label>';
      const inp = document.createElement('input');
      inp.type = 'range'; inp.min = it.min; inp.max = it.max; inp.step = it.step;
      inp.value = P[it.k];
      const val = document.createElement('span');
      val.className = 'val';
      const fmt = v => (it.step >= 1 ? String(Math.round(v)) : v.toFixed(String(it.step).split('.')[1].length));
      val.textContent = fmt(P[it.k]);
      inp.oninput = () => { P[it.k] = parseFloat(inp.value); val.textContent = fmt(P[it.k]); };
      row.appendChild(inp); row.appendChild(val);
      row._sync = () => { inp.value = P[it.k]; val.textContent = fmt(P[it.k]); };
    }

    const wrap = document.createDocumentFragment();
    wrap.appendChild(row);
    if(it.hint){
      const h = document.createElement('p');
      h.className = 'hintline';
      h.textContent = it.hint;
      row.appendChild(h);
      h.style.cssText += ';position:relative;flex:0 0 100%;margin-left:0';
      row.style.flexWrap = 'wrap';
    }
    return row;
  },

  /* AO 几何体列表：选中 → 面板上拖，或者直接在画面里拖 */
  buildAO(box){
    const budget = document.createElement('p');
    budget.className = 'budget';
    box.appendChild(budget);

    const chips = document.createElement('div');
    chips.className = 'chips';
    box.appendChild(chips);

    const detail = document.createElement('div');
    box.appendChild(detail);

    const rowsSpec = [
      ['r', '半径', 0.1, 5, .01], ['s', '强度', 0, 1.5, .01],
      ['ax', 'A · X', -14, 14, .05], ['ay', 'A · Y', -1, 8, .05], ['az', 'A · Z', -20, 6, .05],
      ['bx', 'B · X', -14, 14, .05], ['by', 'B · Y', -1, 8, .05], ['bz', 'B · Z', -20, 6, .05]
    ];

    this.refreshAO = () => {
      const sel = ST.P.aoSel;
      budget.innerHTML = '预算 <b>' + ST.ao.length + ' / ' + AO_BUDGET + '</b> —— 程序给上限，美术在上限内随便花';
      chips.innerHTML = '';
      ST.ao.forEach((a, i) => {
        const b = document.createElement('button');
        b.textContent = (i + 1) + '·' + a.name;
        if(i === sel) b.className = 'on';
        b.onclick = () => { ST.P.aoSel = i; UI.refreshAO(); };
        chips.appendChild(b);
      });
      if(ST.ao.length < AO_BUDGET){
        const add = document.createElement('button');
        add.textContent = '+ 加一个';
        add.onclick = () => {
          const c = App.frontPoint();
          ST.ao.push({ ax: c[0], ay: c[1], az: c[2], bx: c[0], by: c[1], bz: c[2],
                       r: 1.0, s: 0.8, follow: 0, name: '新建' });
          ST.P.aoSel = ST.ao.length - 1; ST.P.aoShow = 1; UI.refreshAO(); UI.syncAll();
        };
        chips.appendChild(add);
      }
      if(ST.ao.length > 1){
        const del = document.createElement('button');
        del.textContent = '− 删除';
        del.onclick = () => { ST.ao.splice(sel, 1); ST.P.aoSel = Math.max(0, sel - 1); UI.refreshAO(); };
        chips.appendChild(del);
      }

      detail.innerHTML = '';
      const a = ST.ao[sel];
      if(!a) return;
      const fol = document.createElement('div');
      fol.className = 'row tg' + (a.follow ? ' on' : '');
      fol.innerHTML = '<label>跟随角色</label><span class="sw"></span>';
      fol.onclick = () => { a.follow = a.follow ? 0 : 1; fol.classList.toggle('on', !!a.follow); };
      detail.appendChild(fol);

      rowsSpec.forEach(sp => {
        const row = document.createElement('div');
        row.className = 'row';
        row.innerHTML = '<label>' + sp[1] + '</label>';
        const inp = document.createElement('input');
        inp.type = 'range'; inp.min = sp[2]; inp.max = sp[3]; inp.step = sp[4]; inp.value = a[sp[0]];
        const val = document.createElement('span');
        val.className = 'val'; val.textContent = (+a[sp[0]]).toFixed(2);
        inp.oninput = () => { a[sp[0]] = parseFloat(inp.value); val.textContent = (+a[sp[0]]).toFixed(2); };
        row.appendChild(inp); row.appendChild(val);
        detail.appendChild(row);
      });

      const tip = document.createElement('p');
      tip.className = 'hintline';
      tip.textContent = 'A ≠ B 就是胶囊体，A = B 就是球。打开「显示几何体」后可以直接在画面里拖。';
      detail.appendChild(tip);
    };
    this.refreshAO();
  },

  /* ---------------- 顶栏 / 分屏 / 提词器 ---------------- */
  bindChrome(){
    document.querySelectorAll('.layer').forEach(b => {
      b.onclick = () => {
        const k = b.dataset.layer;
        if(k === 'base'){ App.setLayers({ fog: 0, ao: 0, ssr: 0, dither: 0 }); }
        else { ST.layers[k] = ST.layers[k] ? 0 : 1; }
        UI.syncAll();
      };
    });
    document.getElementById('stepPrev').onclick = () => App.setStep(ST.step - 1);
    document.getElementById('stepNext').onclick = () => App.setStep(ST.step + 1);
    document.getElementById('btnWipe').onclick  = () => App.toggle('wipe');
    document.getElementById('btnMag').onclick   = () => App.toggle('mag');
    document.getElementById('btnNotes').onclick = () => App.toggle('notes');
    document.getElementById('btnPanel').onclick = () => App.toggle('panel');
    document.getElementById('btnClean').onclick = () => App.toggle('clean');
    document.getElementById('btnHelp').onclick  = () => { UI.el.help.hidden = false; };
    UI.el.help.onclick = () => { UI.el.help.hidden = true; };
    document.getElementById('nClose').onclick   = () => App.toggle('notes');
  },

  bindKeys(){
    window.addEventListener('keydown', e => {
      if(e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
      const k = e.key.toLowerCase();
      const L = ST.layers;
      if(k === '1'){ App.setLayers({ fog: 0, ao: 0, ssr: 0, dither: 0 }); }
      else if(k === '2'){ L.fog = L.fog ? 0 : 1; }
      else if(k === '3'){ L.ao = L.ao ? 0 : 1; }
      else if(k === '4'){ L.ssr = L.ssr ? 0 : 1; }
      else if(k === '5'){ L.dither = L.dither ? 0 : 1; }
      else if(k === '0'){ App.setLayers({ fog: 0, ao: 0, ssr: 0, dither: 0 }); }
      else if(k === '9'){ App.setLayers({ fog: 1, ao: 1, ssr: 1, dither: 1 }); }
      else if(k === 'arrowright' || k === ' '){ App.setStep(ST.step + 1); e.preventDefault(); }
      else if(k === 'arrowleft'){ App.setStep(ST.step - 1); }
      else if(k === 'w'){ App.toggle('wipe'); }
      else if(k === 'm'){ App.toggle('mag'); }
      else if(k === 'n'){ App.toggle('notes'); }
      else if(k === 'p'){ App.toggle('panel'); }
      else if(k === 'h'){ App.toggle('clean'); }
      else if(k === 'g'){ ST.P.ramp = ST.P.ramp ? 0 : 1; }
      else if(k === 'c'){ ST.P.charAnim = ST.P.charAnim ? 0 : 1; }
      else if(k === 'v'){ ST.P.aoShow = ST.P.aoShow ? 0 : 1; }
      else if(k === 'z'){ ST.P.cam = (ST.P.cam + CAMS.length - 1) % CAMS.length; }
      else if(k === 'x'){ ST.P.cam = (ST.P.cam + 1) % CAMS.length; }
      else if(k === 'r'){ App.reset(); }
      else if(k === '?' || k === '/'){ UI.el.help.hidden = !UI.el.help.hidden; }
      else return;
      UI.syncAll();
    });
  },

  showStep(i){
    const s = STEPS[i];
    this.el.nTitle.textContent = s.title;
    this.el.nTime.textContent = s.time;
    this.el.stepLabel.textContent = s.title;
    this.el.nBody.innerHTML = s.lines.map(l => '<p class="' + l.t + '">' + l.x + '</p>').join('');
    this.el.nBody.scrollTop = 0;
  },

  syncAll(){
    const L = ST.layers;
    document.querySelectorAll('.layer').forEach(b => {
      const k = b.dataset.layer;
      b.classList.toggle('on', k === 'base' ? true : !!L[k]);
    });
    ['wipe', 'mag'].forEach(k =>
      document.getElementById('btn' + k[0].toUpperCase() + k.slice(1)).classList.toggle('on', !!ST[k]));
    document.getElementById('btnNotes').classList.toggle('on', !ST.hide.notes);
    document.getElementById('btnPanel').classList.toggle('on', !ST.hide.panel);
    document.getElementById('btnClean').classList.toggle('on', !!ST.hide.clean);

    /* 面板：当前没开的层压暗，但不禁用（美术随时能拧） */
    Object.keys(this.groups).forEach(k => {
      if(k === 'base' || k === 'sys') return;
      this.groups[k].classList.toggle('dim', !L[k]);
    });

    this.el.wipeUI.hidden = !ST.wipe;
    this.el.notes.classList.toggle('hidden', !!ST.hide.notes);
    this.el.panel.classList.toggle('hidden', !!ST.hide.panel);
    document.body.classList.toggle('panelHidden', !!ST.hide.panel);
    document.body.classList.toggle('clean', !!ST.hide.clean);
    if(ST.wipe){
      this.el.wipeHandle.style.left = (ST.wipeX * 100) + '%';
      const nm = o => {
        const on = ['fog', 'ao', 'ssr', 'dither'].filter(k => o[k]);
        return on.length ? on.map(k => ({ fog: '雾', ao: 'AO', ssr: 'SSR', dither: '抖动' })[k]).join(' + ') : '只有基础光照';
      };
      this.el.tagL.textContent = '左：' + nm(ST.layersL);
      this.el.tagR.textContent = '右：' + nm(ST.layers);
    }
    document.querySelectorAll('#panel .row').forEach(r => { if(r._sync) r._sync(); });
    document.querySelectorAll('#panel .row.tg').forEach(r => {
      const lab = r.querySelector('label');
      if(!lab) return;
    });
    if(this.refreshAO) this.refreshAO();
    this.syncToggles();
  },

  /* toggle 行是靠 class 显示的，参数被提词器改过之后要回写 */
  syncToggles(){
    SCHEMA.forEach(g => {
      const box = this.groups[g.layer];
      if(!box) return;
      const rows = box.querySelectorAll(':scope > .row.tg');
      let n = 0;
      g.items.forEach(it => {
        if(it.t !== 'toggle') return;
        const r = rows[n++];
        if(r) r.classList.toggle('on', !!ST.P[it.k]);
      });
    });
  }
};

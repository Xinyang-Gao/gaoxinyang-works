(function(){
  const $ = s => document.querySelector(s);
  const drop = $('#drop'), file = $('#file'), stage = $('#stage'), bar = $('#bar'),
        errBox = $('#err'), meta = $('#meta'), dur = $('#dur'), durVal = $('#durVal');

  const EASINGS = {
    smooth: 'cubic-bezier(.65,0,.35,1)',
    sine:   'cubic-bezier(.37,0,.63,1)',
    out:    'cubic-bezier(.22,1,.36,1)',
    in:     'cubic-bezier(.5,0,.75,0)',
    linear: 'linear'
  };

  const S = { svg:null, paths:[], fades:[], timer:0 };

  function fail(msg){
    errBox.textContent = msg;
    errBox.classList.remove('hidden');
  }
  function ok(){ errBox.classList.add('hidden'); }

  /* ---------- 载入 ---------- */
  function loadText(text){
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    if(doc.querySelector('parsererror') || !doc.documentElement ||
       doc.documentElement.tagName.toLowerCase() !== 'svg'){
      return fail('无法解析为 SVG，请检查文件内容。');
    }
    ok();
    const svg = doc.documentElement;

    // 安全与尺寸处理
    svg.querySelectorAll('script,foreignObject').forEach(n => n.remove());
    svg.querySelectorAll('*').forEach(n => {
      Array.from(n.attributes).forEach(a => {
        if(a.name.toLowerCase().startsWith('on')) n.removeAttribute(a.name);
        if(/^xlink:href$|^href$/.test(a.name) && a.value.trim().startsWith('javascript:')) n.removeAttribute(a.name);
      });
    });
    if(!svg.getAttribute('viewBox')){
      const w = parseFloat(svg.getAttribute('width')) || 300;
      const h = parseFloat(svg.getAttribute('height')) || 300;
      svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
    }
    svg.removeAttribute('width');
    svg.removeAttribute('height');
    if(!svg.getAttribute('preserveAspectRatio')) svg.setAttribute('preserveAspectRatio','xMidYMid meet');

    stage.innerHTML = '';
    stage.appendChild(svg);          // 先入文档，才能取计算样式
    S.svg = svg;
    analyze();
    show();
    play();
  }

  function readFile(f){
    if(!f) return;
    if(!/\.svg$/i.test(f.name) && f.type !== 'image/svg+xml'){
      return fail('请选择 .svg 文件。');
    }
    const r = new FileReader();
    r.onload = () => loadText(String(r.result));
    r.onerror = () => fail('读取文件失败。');
    r.readAsText(f);
  }

  /* ---------- 扫描可绘制元素 ---------- */
  function analyze(){
    const svg = S.svg;
    S.paths = [];
    S.fades = [];

    const nodes = svg.querySelectorAll('path,line,polyline,polygon,circle,ellipse,rect');
    Array.prototype.forEach.call(nodes, el => {
      if(el.closest('defs,clipPath,mask,marker,pattern,symbol')) return; // 不动画被引用/不渲染的图形

      let len = 0;
      try{ len = el.getTotalLength(); }catch(e){ return; }
      if(!len || !isFinite(len)) return;

      const cs = getComputedStyle(el);
      if(cs.display === 'none' || cs.visibility === 'hidden') return;

      const fill = cs.fill;
      const hasFill = !!fill && fill !== 'none' && fill !== 'transparent' && fill !== 'rgba(0, 0, 0, 0)';
      const noStroke = !cs.stroke || cs.stroke === 'none';
      const sw = parseFloat(cs.strokeWidth) || 0;

      el.style.setProperty('--len', len.toFixed(2) + 'px');
      el.style.strokeDasharray  = 'var(--len)';
      el.style.strokeDashoffset = 'var(--len)';
      el.style.transition = 'fill-opacity .5s ease';

      if(noStroke || sw === 0){                 // 纯填充图形：补一条描边，才能“画”出来
        el.style.stroke = hasFill ? fill : '#111';
        if(sw === 0) el.style.strokeWidth = '1';
      }
      S.paths.push({ el:el, len:len, hasFill:hasFill, fillOpacity: cs.fillOpacity || '1' });
    });

    // 文本 / 位图不描边，落笔结束后统一淡入
    S.fades = Array.prototype.slice.call(svg.querySelectorAll('text,image,tspan'));
    S.fades.forEach(el => el.style.transition = 'opacity .5s ease');

    applyRound();
    meta.textContent = S.paths.length + ' 条路径';
  }

  function applyRound(){
    const on = $('#round').checked;
    S.paths.forEach(p => {
      p.el.style.strokeLinecap  = on ? 'round' : '';
      p.el.style.strokeLinejoin = on ? 'round' : '';
    });
  }

  function show(){
    drop.classList.add('hidden');
    stage.classList.remove('hidden');
    bar.classList.remove('hidden');
  }

  /* ---------- 播放 ---------- */
  function play(){
    if(!S.svg || !S.paths.length) return;
    clearTimeout(S.timer);

    const total = +dur.value;
    const ease  = EASINGS[$('#ease').value] || EASINGS.smooth;
    const even  = $('#even').checked;                       // 恒定速度：按长度分配时长
    let maxLen = 0;
    S.paths.forEach(p => { if(p.len > maxLen) maxLen = p.len; });

    // 复位
    S.paths.forEach(p => {
      const s = p.el.style;
      s.animation = 'none';
      s.strokeDasharray  = 'var(--len)';
      s.strokeDashoffset = 'var(--len)';
      if(p.hasFill) s.fillOpacity = '0';
    });
    S.fades.forEach(el => el.style.opacity = '0');
    void S.svg.getBoundingClientRect();                     // 强制回流，让复位生效

    let longest = 0;
    S.paths.forEach(p => {
      const d = even ? Math.max(140, total * p.len / maxLen) : total;
      if(d > longest) longest = d;
      const s = p.el.style;
      s.animationName = 'draw';
      s.animationDuration = d + 'ms';
      s.animationDelay = '0ms';
      s.animationTimingFunction = ease;
      s.animationFillMode = 'both';
      s.animationIterationCount = '1';
    });

    S.timer = setTimeout(finish, longest + 40);
  }

  function finish(){
    const showFill = $('#fill').checked;
    S.paths.forEach(p => {
      const s = p.el.style;
      s.animation = 'none';
      s.strokeDasharray = '';
      s.strokeDashoffset = '';
      if(showFill && p.hasFill) s.fillOpacity = p.fillOpacity;
    });
    S.fades.forEach(el => el.style.opacity = '');
  }

  /* ---------- 交互 ---------- */
  drop.addEventListener('click', () => file.click());
  $('#change').addEventListener('click', () => file.click());
  file.addEventListener('change', e => { readFile(e.target.files[0]); file.value = ''; });

  ['dragenter','dragover'].forEach(t => {
    document.addEventListener(t, e => { e.preventDefault(); drop.classList.add('over'); });
  });
  ['dragleave','drop'].forEach(t => {
    document.addEventListener(t, e => {
      e.preventDefault();
      if(t === 'dragleave' && e.relatedTarget) return;
      drop.classList.remove('over');
    });
  });
  document.addEventListener('drop', e => {
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if(f) readFile(f);
  });

  document.addEventListener('paste', e => {
    const t = e.clipboardData && e.clipboardData.getData('text/plain');
    if(t && t.indexOf('<svg') !== -1) loadText(t);
  });

  $('#replay').addEventListener('click', play);
  dur.addEventListener('input', () => durVal.textContent = (dur.value / 1000).toFixed(1) + 's');
  dur.addEventListener('change', play);
  $('#ease').addEventListener('change', play);
  $('#fill').addEventListener('change', finish);
  $('#even').addEventListener('change', play);
  $('#round').addEventListener('change', applyRound);

  document.addEventListener('keydown', e => {
    if(e.code === 'Space' && !/^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(e.target.tagName)){
      e.preventDefault(); play();
    }
  });
})();
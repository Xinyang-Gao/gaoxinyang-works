(function () {
    'use strict';

    const $ = (id) => document.getElementById(id);

    const form            = $('searchForm');
    const pidInput        = $('pidInput');
    const queryBtn        = $('queryBtn');
    const placeholder     = $('placeholder');
    const loadingState    = $('loadingState');
    const loadingText     = $('loadingText');
    const errorState      = $('errorState');
    const errorText       = $('errorText');
    const gallery         = $('gallery');
    const grid            = $('grid');
    const galleryCount    = $('galleryCount');
    const galleryLoading  = $('galleryLoading');
    const galleryLoadingText = $('galleryLoadingText');
    const downloadAllBtn  = $('downloadAllBtn');

    const lightbox  = $('lightbox');
    const lbImage   = $('lbImage');
    const lbCounter = $('lbCounter');
    const lbPrev    = $('lbPrev');
    const lbNext    = $('lbNext');
    const lbClose   = $('lbClose');
    const lbDownload = $('lbDownload');

    const MAX_SEQ = 150;
    const TIMEOUT = 8000;

    let images  = [];
    let cols    = [];
    let session = 0;
    let lbIndex = 0;

    /* ================= 视图状态 ================= */
    function setView(view, message) {
        placeholder.style.display  = view === 'idle'    ? 'flex'  : 'none';
        loadingState.style.display = view === 'loading' ? 'flex'  : 'none';
        errorState.style.display   = view === 'error'   ? 'flex'  : 'none';
        gallery.style.display      = view === 'gallery' ? 'block' : 'none';
        if (view === 'loading' && message) loadingText.textContent = message;
        if (view === 'error'   && message) errorText.textContent   = message;
    }

    /* ================= 瀑布流列 ================= */
    function columnCount() {
        const w = document.querySelector('.container').clientWidth || window.innerWidth;
        return w >= 700 ? 3 : 2;
    }

    function buildColumns(n) {
        grid.innerHTML = '';
        cols = [];
        for (let i = 0; i < n; i++) {
            const c = document.createElement('div');
            c.className = 'col';
            grid.appendChild(c);
            cols.push(c);
        }
    }

    function shortestColumn() {
        let best = cols[0];
        for (let i = 1; i < cols.length; i++) {
            if (cols[i].offsetHeight < best.offsetHeight) best = cols[i];
        }
        return best;
    }

    function appendCard(data, index) {
        const card = document.createElement('div');
        card.className = 'card';

        const img = document.createElement('img');
        img.loading = 'lazy';
        img.decoding = 'async';
        img.alt = '';
        img.addEventListener('load', function () {
            img.classList.add('loaded');
        }, { once: true });
        img.src = data.url;

        const dl = document.createElement('button');
        dl.type = 'button';
        dl.className = 'card-dl';
        dl.title = '下载此图';
        dl.setAttribute('aria-label', '下载此图');
        dl.innerHTML = '<i class="fas fa-download"></i>';
        dl.addEventListener('click', function (e) {
            e.stopPropagation();
            saveImage(data.url, nameOf(data));
        });

        card.appendChild(img);
        card.appendChild(dl);
        card.addEventListener('click', function () { openLightbox(index); });

        shortestColumn().appendChild(card);
    }

    function nameOf(d) {
        return d.pid + '-' + d.seq + '.' + d.format;
    }

    /* ================= 下载 ================= */
    function saveImage(url, filename) {
        fetch(url)
            .then(function (res) {
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return res.blob();
            })
            .then(function (blob) {
                const u = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = u;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                a.remove();
                setTimeout(function () { URL.revokeObjectURL(u); }, 3000);
            })
            .catch(function () {
                window.open(url, '_blank', 'noopener');
            });
    }

    /* ================= 图片侦测 ================= */
    function testImage(url, isCancelled) {
        return new Promise(function (resolve) {
            if (isCancelled && isCancelled()) return resolve(false);

            const img = new Image();
            let settled = false;

            const timer = setTimeout(function () { finish(false); }, TIMEOUT);

            function finish(ok) {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                img.onload = img.onerror = null;
                resolve(ok);
            }

            img.onload  = function () { finish(true); };
            img.onerror = function () { finish(false); };
            img.src = url;
        });
    }

    function getFormat() {
        const el = document.querySelector('input[name="imgFormat"]:checked');
        return el ? el.value : 'png';
    }

    async function detect(pid, preferred, onFound, isCancelled) {
        const order = [preferred].concat(
            ['png', 'jpg', 'gif'].filter(function (f) { return f !== preferred; })
        );

        let fmt = null;
        for (let i = 0; i < order.length; i++) {
            if (isCancelled()) return;
            const f = order[i];
            if (await testImage('https://pixiv.re/' + pid + '.' + f, isCancelled)) {
                fmt = f;
                break;
            }
        }

        if (!fmt) throw new Error('未找到该作品，请检查 ID 或换一种格式');

        document.querySelectorAll('input[name="imgFormat"]').forEach(function (r) {
            if (r.value === fmt) r.checked = true;
        });

        onFound({
            pid: pid, seq: 1, format: fmt,
            url: 'https://pixiv.re/' + pid + '.' + fmt
        });

        let fails = 0;
        for (let seq = 2; seq <= MAX_SEQ; seq++) {
            if (isCancelled()) return;
            const url = 'https://pixiv.re/' + pid + '-' + seq + '.' + fmt;
            if (await testImage(url, isCancelled)) {
                onFound({ pid: pid, seq: seq, format: fmt, url: url });
                fails = 0;
            } else if (++fails >= 2) {
                break;
            }
        }
    }

    /* ================= 查询流程 ================= */
    async function performQuery() {
        const pid = pidInput.value.trim();
        if (!pid) {
            pidInput.classList.remove('shake');
            void pidInput.offsetWidth;
            pidInput.classList.add('shake');
            pidInput.focus();
            return;
        }

        const my = ++session;
        const cancelled = function () { return my !== session; };

        images  = [];
        lbIndex = 0;
        buildColumns(columnCount());
        galleryCount.textContent = '';
        galleryLoadingText.textContent = '加载中…';
        galleryLoading.style.display = 'flex';
        queryBtn.disabled = true;
        setView('loading', '正在侦测图片…');

        try {
            await detect(pid, getFormat(), function (data) {
                if (cancelled()) return;

                images.push(data);

                if (images.length === 1) {
                    setView('gallery');
                    galleryLoading.style.display = 'flex';
                }

                appendCard(data, images.length - 1);

                galleryCount.textContent = images.length + ' 张';
                galleryLoadingText.textContent = '已加载 ' + images.length + ' 张…';
            }, cancelled);

            if (cancelled()) return;
            galleryLoading.style.display = 'none';
            galleryCount.textContent = images.length + ' 张';
        } catch (err) {
            if (cancelled()) return;
            if (!images.length) {
                setView('error', (err && err.message) || '加载失败，请稍后重试');
            } else {
                galleryLoading.style.display = 'none';
            }
        } finally {
            if (!cancelled()) queryBtn.disabled = false;
        }
    }

    /* ================= 灯箱 ================= */
    function openLightbox(i) {
        if (!images[i]) return;
        lbIndex = i;
        renderLightbox();
        lightbox.classList.add('open');
        document.body.style.overflow = 'hidden';
    }

    function closeLightbox() {
        lightbox.classList.remove('open');
        document.body.style.overflow = '';
        lbImage.classList.remove('loaded');
        lbImage.removeAttribute('src');
    }

    function renderLightbox() {
        const d = images[lbIndex];
        if (!d) return;

        lbImage.classList.remove('loaded');
        lbImage.onload = function () { lbImage.classList.add('loaded'); };
        lbImage.src = d.url;
        if (lbImage.complete) lbImage.classList.add('loaded');

        lbCounter.textContent = (lbIndex + 1) + ' / ' + images.length;

        const multi = images.length > 1;
        lbPrev.style.display = multi ? '' : 'none';
        lbNext.style.display = multi ? '' : 'none';
    }

    function stepLightbox(dir) {
        const n = images.length;
        if (!n) return;
        lbIndex = (lbIndex + dir + n) % n;
        renderLightbox();
    }

    /* ================= 事件 ================= */
    form.addEventListener('submit', function (e) {
        e.preventDefault();
        performQuery();
    });

    downloadAllBtn.addEventListener('click', function () {
        if (!images.length) return;
        if (!confirm('下载全部 ' + images.length + ' 张图片？')) return;
        images.forEach(function (d, i) {
            setTimeout(function () { saveImage(d.url, nameOf(d)); }, i * 320);
        });
    });

    lbClose.addEventListener('click', closeLightbox);
    lbPrev.addEventListener('click', function (e) { e.stopPropagation(); stepLightbox(-1); });
    lbNext.addEventListener('click', function (e) { e.stopPropagation(); stepLightbox(1); });
    lbDownload.addEventListener('click', function (e) {
        e.stopPropagation();
        const d = images[lbIndex];
        if (d) saveImage(d.url, nameOf(d));
    });

    lightbox.addEventListener('click', function (e) {
        if (e.target === lightbox) closeLightbox();
    });

    document.addEventListener('keydown', function (e) {
        if (!lightbox.classList.contains('open')) return;
        if (e.key === 'Escape') closeLightbox();
        else if (e.key === 'ArrowLeft') stepLightbox(-1);
        else if (e.key === 'ArrowRight') stepLightbox(1);
    });

    let resizeTimer;
    window.addEventListener('resize', function () {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(function () {
            const n = columnCount();
            if (n === cols.length) return;
            const cards = Array.prototype.slice.call(grid.querySelectorAll('.card'));
            buildColumns(n);
            cards.forEach(function (c) { shortestColumn().appendChild(c); });
        }, 200);
    });

    /* ================= 初始化 ================= */
    buildColumns(columnCount());
    setView('idle');
})();

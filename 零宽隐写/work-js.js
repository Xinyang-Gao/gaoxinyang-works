        (function() {
            'use strict';

            // ================================================================
            // 1. Constants & Configuration
            // ================================================================

            // 16 Zero-Width Characters mapped to 0-F
            const ZW_CHARS = [
                '\u200B', // 0
                '\u200C', // 1
                '\u200D', // 2
                '\uFEFF', // 3
                '\u200E', // 4
                '\u200F', // 5
                '\u2060', // 6
                '\u2061', // 7
                '\u2062', // 8
                '\u2063', // 9
                '\u2064', // A
                '\u202A', // B
                '\u202B', // C
                '\u202C', // D
                '\u202D', // E
                '\u202E' // F
            ];

            const ZW_TO_HEX = {};
            ZW_CHARS.forEach((char, index) => {
                ZW_TO_HEX[char] = index;
            });

            const MARKERS = {
                COMPRESSED_UTF8: ZW_CHARS[0],
                COMPRESSED_UTF16: ZW_CHARS[1],
                RAW_UTF8: ZW_CHARS[2],
                RAW_UTF16: ZW_CHARS[3],
                CHARACTER_MODE: ZW_CHARS[4]
            };

            // 映射表渲染
            const mapContainer = document.getElementById('charMapDisplay');
            let mapHtml = '<span class="map-label">映射表</span>';
            ZW_CHARS.forEach((char, i) => {
                const hex = i.toString(16).toUpperCase();
                mapHtml +=
                    `<div class="char-pair"><span class="zw-char">${char}</span><span class="hex-label">${hex}</span></div>`;
            });
            mapContainer.innerHTML = mapHtml;

            // ================================================================
            // 2. Core Algorithms
            // ================================================================

            function bytesToZw(bytes) {
                const len = bytes.length;
                const result = new Array(len * 2);
                for (let i = 0; i < len; i++) {
                    const b = bytes[i];
                    result[i * 2] = ZW_CHARS[(b >> 4) & 0x0F];
                    result[i * 2 + 1] = ZW_CHARS[b & 0x0F];
                }
                return result.join('');
            }

            function zwToBytes(zwStr) {
                const valid = [];
                for (let i = 0; i < zwStr.length; i++) {
                    const c = zwStr[i];
                    if (ZW_TO_HEX[c] !== undefined) valid.push(c);
                }
                if (valid.length % 2) valid.pop();
                const byteCount = valid.length / 2;
                const bytes = new Uint8Array(byteCount);
                for (let i = 0; i < byteCount; i++) {
                    bytes[i] = (ZW_TO_HEX[valid[i * 2]] << 4) | ZW_TO_HEX[valid[i * 2 + 1]];
                }
                return bytes;
            }

            // ================================================================
            // 3. Character Mode (3-bit)
            // ================================================================

            const CHAR_MAP_8 = ZW_CHARS.slice(0, 8);
            const REV_CHAR_MAP_8 = {};
            CHAR_MAP_8.forEach((c, i) => REV_CHAR_MAP_8[c] = i);

            function encodeCharMode(str) {
                const bits = [];
                let i = 0;
                while (i < str.length) {
                    const cp = str.codePointAt(i);
                    if (cp === undefined) break;
                    if (cp <= 0x7F) {
                        bits.push(0);
                        for (let b = 6; b >= 0; b--) bits.push((cp >> b) & 1);
                    } else if (cp <= 0xFFFF) {
                        bits.push(1);
                        for (let b = 15; b >= 0; b--) bits.push((cp >> b) & 1);
                    } else if (cp <= 0x10FFFF) {
                        bits.push(2);
                        const data = cp - 0x10000;
                        for (let b = 19; b >= 0; b--) bits.push((data >> b) & 1);
                    }
                    i += (cp > 0xFFFF) ? 2 : 1;
                }
                while (bits.length % 3) bits.push(0);
                const zwChars = [];
                for (let idx = 0; idx < bits.length; idx += 3) {
                    const val = (bits[idx] << 2) | (bits[idx + 1] << 1) | bits[idx + 2];
                    zwChars.push(CHAR_MAP_8[val]);
                }
                return zwChars.join('');
            }

            function decodeCharMode(zwStr) {
                const bits = [];
                for (let ch of zwStr) {
                    const val = REV_CHAR_MAP_8[ch];
                    if (val !== undefined) {
                        bits.push((val >> 2) & 1, (val >> 1) & 1, val & 1);
                    }
                }
                const chars = [];
                let pos = 0;
                while (pos < bits.length) {
                    if (pos + 1 >= bits.length) break;
                    const marker = (bits[pos] << 1) | bits[pos + 1];
                    pos += 2;
                    if (marker === 0) {
                        if (pos + 7 > bits.length) break;
                        let val = 0;
                        for (let k = 0; k < 7; k++) val = (val << 1) | (bits[pos + k] || 0);
                        pos += 7;
                        chars.push(String.fromCodePoint(val));
                    } else if (marker === 1) {
                        if (pos + 16 > bits.length) break;
                        let val = 0;
                        for (let k = 0; k < 16; k++) val = (val << 1) | (bits[pos + k] || 0);
                        pos += 16;
                        chars.push(String.fromCodePoint(val));
                    } else if (marker === 2) {
                        if (pos + 20 > bits.length) break;
                        let val = 0;
                        for (let k = 0; k < 20; k++) val = (val << 1) | (bits[pos + k] || 0);
                        pos += 20;
                        const cp = 0x10000 + val;
                        if (cp <= 0x10FFFF) chars.push(String.fromCodePoint(cp));
                    }
                }
                return chars.join('');
            }

            // ================================================================
            // 4. Strategy Selection
            // ================================================================

            function getBestStrategy(secretStr) {
                if (!secretStr) throw new Error('秘密信息不能为空');

                const utf8Bytes = new TextEncoder().encode(secretStr);
                const utf16Bytes = new Uint8Array(secretStr.length * 2);
                for (let i = 0; i < secretStr.length; i++) {
                    const code = secretStr.charCodeAt(i);
                    utf16Bytes[i * 2] = (code >> 8) & 0xFF;
                    utf16Bytes[i * 2 + 1] = code & 0xFF;
                }

                const candidates = [];

                const evaluate = (bytes, marker, type, encodingName) => {
                    const header = new Uint8Array(4);
                    new DataView(header.buffer).setUint32(0, bytes.length, false);
                    const total = new Uint8Array(header.length + bytes.length);
                    total.set(header);
                    total.set(bytes, header.length);
                    const zwCount = total.length * 2;
                    candidates.push({
                        marker: marker,
                        data: bytes,
                        zwCount: zwCount,
                        type: type,
                        encoding: encodingName,
                        originalByteLen: bytes.length
                    });
                };

                evaluate(utf8Bytes, MARKERS.RAW_UTF8, 'raw', 'UTF-8');
                evaluate(utf16Bytes, MARKERS.RAW_UTF16, 'raw', 'UTF-16BE');

                try {
                    const compUtf8 = pako.deflate(utf8Bytes, { level: 9 });
                    evaluate(compUtf8, MARKERS.COMPRESSED_UTF8, 'compressed', 'UTF-8');
                } catch (_) {}
                try {
                    const compUtf16 = pako.deflate(utf16Bytes, { level: 9 });
                    evaluate(compUtf16, MARKERS.COMPRESSED_UTF16, 'compressed', 'UTF-16BE');
                } catch (_) {}

                const charZw = encodeCharMode(secretStr);
                const charZwCount = 1 + charZw.length;
                candidates.push({
                    marker: MARKERS.CHARACTER_MODE,
                    data: charZw,
                    zwCount: charZwCount,
                    type: 'character',
                    encoding: '3-bit',
                    originalByteLen: utf8Bytes.length,
                    isChar: true
                });

                candidates.sort((a, b) => a.zwCount - b.zwCount);
                return candidates[0];
            }

            // ================================================================
            // 5. Encode / Decode
            // ================================================================

            function encode(coverText, secretText) {
                const strategy = getBestStrategy(secretText);

                const header = new Uint8Array(4);
                new DataView(header.buffer).setUint32(0, strategy.data.length, false);
                const fullData = new Uint8Array(4 + strategy.data.length);
                fullData.set(header);
                fullData.set(strategy.data, 4);

                let zwData;
                if (strategy.isChar) {
                    zwData = strategy.data;
                } else {
                    zwData = bytesToZw(fullData);
                }

                const finalString = coverText + strategy.marker + zwData;

                return {
                    result: finalString,
                    stats: {
                        mode: strategy.type,
                        encoding: strategy.encoding,
                        zwCount: strategy.zwCount,
                        originalLen: secretText.length,
                        byteLen: strategy.originalByteLen,
                        ratio: (strategy.zwCount / secretText.length).toFixed(2)
                    }
                };
            }

            function decode(text) {
                let marker = null;
                let markerIndex = -1;
                for (const key in MARKERS) {
                    const m = MARKERS[key];
                    const idx = text.indexOf(m);
                    if (idx !== -1 && (markerIndex === -1 || idx < markerIndex)) {
                        marker = m;
                        markerIndex = idx;
                    }
                }
                if (!marker) throw new Error('未找到有效的隐写标记');

                const dataPart = text.substring(markerIndex + 1);
                const zwData = dataPart.split('').filter(c => ZW_TO_HEX[c] !== undefined).join('');

                if (marker === MARKERS.CHARACTER_MODE) {
                    const decoded = decodeCharMode(zwData);
                    return {
                        text: decoded,
                        stats: {
                            mode: 'character',
                            encoding: '3-bit',
                            zwCount: zwData.length,
                            byteLen: new TextEncoder().encode(decoded).length
                        }
                    };
                } else {
                    const rawBytes = zwToBytes(zwData);
                    if (rawBytes.length < 4) throw new Error('数据长度不足');
                    const dataLen = new DataView(rawBytes.buffer).getUint32(0, false);
                    const payload = rawBytes.slice(4, 4 + dataLen);

                    let finalBytes = payload;
                    if (marker === MARKERS.COMPRESSED_UTF8 || marker === MARKERS.COMPRESSED_UTF16) {
                        try {
                            finalBytes = pako.inflate(payload);
                        } catch (_) {
                            throw new Error('解压失败，数据可能已损坏');
                        }
                    }

                    let decodedStr = '';
                    if (marker === MARKERS.COMPRESSED_UTF8 || marker === MARKERS.RAW_UTF8) {
                        decodedStr = new TextDecoder('utf-8').decode(finalBytes);
                    } else {
                        decodedStr = new TextDecoder('utf-16be').decode(finalBytes);
                    }

                    const modeType = (marker === MARKERS.COMPRESSED_UTF8 || marker === MARKERS.COMPRESSED_UTF16) ?
                        'compressed' : 'raw';
                    const encName = (marker === MARKERS.COMPRESSED_UTF8 || marker === MARKERS.RAW_UTF8) ? 'UTF-8' :
                    'UTF-16BE';
                    return {
                        text: decodedStr,
                        stats: {
                            mode: modeType,
                            encoding: encName,
                            zwCount: zwData.length,
                            byteLen: finalBytes.length
                        }
                    };
                }
            }

            // ================================================================
            // 6. UI Interaction
            // ================================================================

            const els = {
                cover: document.getElementById('coverText'),
                secret: document.getElementById('secretText'),
                encodeBtn: document.getElementById('encodeBtn'),
                clearEncode: document.getElementById('clearEncodeBtn'),
                sampleEncode: document.getElementById('sampleEncodeBtn'),
                encodedResult: document.getElementById('encodedResult'),
                copyBtn: document.getElementById('copyEncodedBtn'),
                encodeArea: document.getElementById('encodeResultArea'),
                encodeStats: document.getElementById('encodeStats'),
                encodeError: document.getElementById('encodeError'),
                modeBadge: document.getElementById('encodeModeBadge'),

                decodeText: document.getElementById('decodeText'),
                decodeBtn: document.getElementById('decodeBtn'),
                clearDecode: document.getElementById('clearDecodeBtn'),
                sampleDecode: document.getElementById('sampleDecodeBtn'),
                decodeBox: document.getElementById('decodedResultBox'),
                decodeContent: document.getElementById('decodedContent'),
                decodeStats: document.getElementById('decodeStats'),
                decodeError: document.getElementById('decodeError')
            };

            function showEncodeStats(stats) {
                const modeClass = stats.mode === 'compressed' ? 'mode-compressed' :
                    (stats.mode === 'character' ? 'mode-char' : 'mode-raw');
                const modeText = stats.mode === 'compressed' ? '压缩' :
                    (stats.mode === 'character' ? '字符级' : '原始');
                els.modeBadge.innerHTML =
                    `<span class="mode-badge ${modeClass}">${modeText} (${stats.encoding})</span>`;

                els.encodeStats.innerHTML = `
                    <div class="stat-item"><span class="stat-label">原始字符</span><span class="stat-value">${stats.originalLen}</span></div>
                    <div class="stat-item"><span class="stat-label">零宽字符数</span><span class="stat-value">${stats.zwCount}</span></div>
                    <div class="stat-item"><span class="stat-label">膨胀率</span><span class="stat-value ${parseFloat(stats.ratio) > 10 ? 'bad' : 'good'}">${stats.ratio}x</span></div>
                    <div class="stat-item"><span class="stat-label">有效载荷</span><span class="stat-value">${stats.byteLen} B</span></div>
                `;
            }

            els.encodeBtn.addEventListener('click', () => {
                els.encodeError.classList.remove('show');
                try {
                    const res = encode(els.cover.value, els.secret.value);
                    els.encodedResult.value = res.result;
                    els.encodeArea.style.display = 'block';
                    showEncodeStats(res.stats);
                } catch (e) {
                    els.encodeError.textContent = e.message;
                    els.encodeError.classList.add('show');
                    els.encodeArea.style.display = 'none';
                }
            });

            els.copyBtn.addEventListener('click', () => {
                if (!els.encodedResult.value) return;
                navigator.clipboard.writeText(els.encodedResult.value).then(() => {
                    const old = els.copyBtn.textContent;
                    els.copyBtn.textContent = '已复制 ✓';
                    setTimeout(() => els.copyBtn.textContent = old, 1800);
                });
            });

            els.encodedResult.addEventListener('dblclick', () => {
                if (els.encodedResult.value) {
                    els.decodeText.value = els.encodedResult.value;
                    els.decodeText.scrollIntoView({ behavior: 'smooth' });
                }
            });

            els.clearEncode.addEventListener('click', () => {
                els.cover.value = '';
                els.secret.value = '';
                els.encodeArea.style.display = 'none';
            });

            els.sampleEncode.addEventListener('click', () => {
                els.cover.value = '今天天气真不错，适合出去散步。';
                els.secret.value = '这是一条绝密消息：Meeting at 10 PM. 🕵️‍♂️';
                els.encodeBtn.click();
            });

            els.decodeBtn.addEventListener('click', () => {
                els.decodeError.classList.remove('show');
                els.decodeBox.classList.remove('show');

                const text = els.decodeText.value;
                if (!text) {
                    els.decodeError.textContent = '请输入待解码文本';
                    els.decodeError.classList.add('show');
                    return;
                }

                try {
                    const res = decode(text);
                    els.decodeContent.textContent = res.text;
                    els.decodeBox.classList.add('show');

                    const modeClass = res.stats.mode === 'compressed' ? 'mode-compressed' :
                        (res.stats.mode === 'character' ? 'mode-char' : 'mode-raw');
                    els.decodeStats.innerHTML = `
                        <div class="stat-item"><span class="stat-label">模式</span><span class="mode-badge ${modeClass}">${res.stats.mode.toUpperCase()}</span></div>
                        <div class="stat-item"><span class="stat-label">编码</span><span class="stat-value">${res.stats.encoding}</span></div>
                        <div class="stat-item"><span class="stat-label">还原字节</span><span class="stat-value">${res.stats.byteLen} B</span></div>
                    `;
                } catch (e) {
                    els.decodeError.textContent = e.message;
                    els.decodeError.classList.add('show');
                }
            });

            els.clearDecode.addEventListener('click', () => {
                els.decodeText.value = '';
                els.decodeBox.classList.remove('show');
            });

            els.sampleDecode.addEventListener('click', () => {
                const sampleRes = encode('Sample Cover ', 'Hello World 123');
                els.decodeText.value = sampleRes.result;
                els.decodeBtn.click();
            });

        })();

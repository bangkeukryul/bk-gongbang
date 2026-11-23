/*! BK공방 추억앨범 (휴대폰) v0.1 — 사진 + 노래 + 자막 → 휴대폰 안에서 MP4
 * 저장: IndexedDB 'bk-gongbang-m' (kv: 작품 설정 · files: 사진 · 노래)
 * 그리기: fx.js(BKFX) 전환 · 색감 · 분위기 효과 · 자막 / 만들기: WebCodecs + mp4mux.js
 */
(function (g) {
'use strict';
const $ = id => document.getElementById(id);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fmt = s => { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + '분 ' + String(s % 60).padStart(2, '0') + '초'; };
const MAXP = 80, HOLD = 2.5;
const FX = g.BKFX;

/* ═════════ 저장 (IndexedDB) ═════════ */
let DB = null;
function db() {
  if (DB) return DB;
  DB = new Promise((res, rej) => { const q = indexedDB.open('bk-gongbang-m', 1); q.onupgradeneeded = () => { const d = q.result; d.createObjectStore('kv'); d.createObjectStore('files'); }; q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
  return DB;
}
async function op(store, mode, fn) { const d = await db(); return new Promise((res, rej) => { const tx = d.transaction(store, mode), st = tx.objectStore(store), r = fn(st); tx.oncomplete = () => res(r && r.result); tx.onerror = () => rej(tx.error); }); }
const kvGet = k => op('kv', 'readonly', s => s.get(k));
const kvSet = (k, v) => op('kv', 'readwrite', s => s.put(v, k));
const fGet = k => op('files', 'readonly', s => s.get(k));
const fSet = (k, v) => op('files', 'readwrite', s => s.put(v, k));
const fDel = k => op('files', 'readwrite', s => s.delete(k));

const DEF = () => ({ photos: [], music: null, fit: true, sec: 4, title: '', endText: '', capPos: 'low',
  fx: { tr: 'fade', mix: 'all',speed: 'normal', color: 'none', efx: '', zoom: true, fadein: true, fadeout: true }, ratio: '9:16', q: 720, seen: {} });
let P = DEF(), saveT = 0;
function save() { clearTimeout(saveT); saveT = setTimeout(() => kvSet('album', P).catch(() => {}), 300); }

function toast(msg, ms) { const t = $('toast'); t.textContent = msg; t.style.display = 'block'; clearTimeout(toast.t); toast.t = setTimeout(() => { t.style.display = 'none'; }, ms || 2600); }

/* ═════════ 사진 넣기 ═════════ */
async function exifDate(file) {
  try {
    const b = new DataView(await file.slice(0, 196608).arrayBuffer());
    if (b.getUint16(0) !== 0xFFD8) return 0;
    let o = 2;
    while (o < b.byteLength - 10) {
      const m = b.getUint16(o); if ((m & 0xFF00) !== 0xFF00) break;
      const len = b.getUint16(o + 2);
      if (m === 0xFFE1 && b.getUint32(o + 4) === 0x45786966) {
        const t = o + 10, le = b.getUint16(t) === 0x4949, u16 = p => b.getUint16(p, le), u32 = p => b.getUint32(p, le);
        const find = (p, tag) => { const n = u16(p); for (let i = 0; i < n; i++) { const e = p + 2 + i * 12; if (u16(e) === tag) return e; } return 0; };
        let e = find(t + u32(t + 4), 0x8769); if (!e) return 0;
        const sub = t + u32(e + 8); e = find(sub, 0x9003) || find(sub, 0x9004); if (!e) return 0;
        const so = t + u32(e + 8); let s = ''; for (let i = 0; i < 19; i++) s += String.fromCharCode(b.getUint8(so + i));
        const d = s.match(/(\d{4}):(\d\d):(\d\d) (\d\d):(\d\d):(\d\d)/);
        return d ? new Date(+d[1], d[2] - 1, +d[3], +d[4], +d[5], +d[6]).getTime() : 0;
      }
      o += 2 + len;
    }
  } catch (e) { /* 날짜 없음 */ }
  return 0;
}
function loadImg(src) { return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('사진을 읽을 수 없어요')); im.src = src; }); }
function toJpeg(img, max, q) {
  const w0 = img.naturalWidth || img.width, h0 = img.naturalHeight || img.height, s = Math.min(1, max / Math.max(w0, h0));
  const c = document.createElement('canvas'); c.width = Math.round(w0 * s); c.height = Math.round(h0 * s);
  const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(img, 0, 0, c.width, c.height);
  return new Promise(r => c.toBlob(b => { c.width = c.height = 0; r(b); }, 'image/jpeg', q));
}
const THUMBS = new Map();
async function thumbUrl(id) { if (THUMBS.has(id)) return THUMBS.get(id); const b = await fGet('t:' + id); const u = b ? URL.createObjectURL(b) : ''; THUMBS.set(id, u); return u; }

async function addPhotos(files) {
  files = [...files].filter(f => /^image\//.test(f.type) || /\.(jpe?g|png|webp|heic)$/i.test(f.name));
  if (!files.length) return;
  const room = MAXP - P.photos.length;
  if (room <= 0) { toast(`사진은 ${MAXP}장까지 넣을 수 있어요`); return; }
  if (files.length > room) { toast(`${room}장만 넣었어요 (최대 ${MAXP}장)`); files = files.slice(0, room); }
  let ok = 0, bad = 0;
  for (let i = 0; i < files.length; i++) {
    const f = files[i]; $('now').textContent = `📷 사진 넣는 중… ${i + 1} / ${files.length}`;
    const url = URL.createObjectURL(f);
    try {
      const img = await loadImg(url), when = (await exifDate(f)) || f.lastModified || Date.now();
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
      await fSet('f:' + id, await toJpeg(img, 1920, .9)); await fSet('t:' + id, await toJpeg(img, 420, .8));
      P.photos.push({ id, when, cap: '' }); ok++;
    } catch (e) { bad++; } finally { URL.revokeObjectURL(url); }
    await sleep(0);
  }
  P.photos.sort((a, b) => a.when - b.when);
  save(); render();
  toast(`사진 ${ok}장을 넣었어요` + (bad ? ` · ${bad}장은 읽지 못했어요` : '') + ' (찍은 날짜 순서)');
}
async function delPhoto(i) {
  const p = P.photos[i]; if (!p || !confirm(`${i + 1}번 사진을 뺄까요?`)) return;
  P.photos.splice(i, 1); for (const k of ['f:', 't:', 'v:']) fDel(k + p.id).catch(() => {});
  const u = THUMBS.get(p.id); if (u) URL.revokeObjectURL(u); THUMBS.delete(p.id); save(); render();
}
function move(i, d) { const j = i + d; if (j < 0 || j >= P.photos.length) return; const a = P.photos; [a[i], a[j]] = [a[j], a[i]]; save(); render(); }
async function renderPhotos() {
  const box = $('photos');
  if (!P.photos.length) { box.innerHTML = '<div class="empty" style="grid-column:1/-1">아직 사진이 없어요</div>'; return; }
  const urls = await Promise.all(P.photos.map(p => thumbUrl(p.id)));
  box.innerHTML = P.photos.map((p, i) => `<div class="ph"><div class="top">${i + 1}번 <span>${new Date(p.when).toLocaleDateString('ko-KR')}</span></div>
    <div class="imgw"><img src="${urls[i]}" alt="">${p.vid ? '<b>🎬 영상</b>' : ''}</div>
    <button class="vbtn ${p.vid ? 'has' : ''}" data-flow="${i}">${p.vid ? '🎬 영상 들어감 ✓' : '✨ 영상으로 (Flow)'}</button>
    <input type="text" data-cap="${i}" placeholder="자막 한 줄 (비워도 돼요)" value="${(p.cap || '').replace(/"/g, '&quot;')}" maxlength="40">
    <div class="row"><button data-mv="${i}" data-d="-1">◀</button><button data-mv="${i}" data-d="1">▶</button><button data-del="${i}">🗑</button></div></div>`).join('');
}

/* ═════════ ✨ 사진을 영상으로 (Google Flow) ═════════ */
const FLOW_URL = 'https://labs.google/fx/tools/flow';
function flowPrompt(p) {
  const cap = (p.cap || '').trim();
  return ['첨부한 사진에서 그대로 시작하는 8초짜리 잔잔한 추억 영상이다. 사진 속 사람의 얼굴, 머리, 옷, 배경은 사진과 똑같이 유지한다.',
    '첫 장면은 첨부한 사진과 완전히 같다. 새 장면이나 새 사람을 만들지 않고, 이 사진 한 장만 살짝 움직인다. 장면이 바뀌지 않는다.',
    '등장하는 사람은 모두 한국 사람이고, 배경은 한국이다. 외국인이나 외국 풍경으로 바꾸지 않는다. 새 사람이 나타나지 않는다.',
    '사진 속 사람들이 자연스럽게 웃거나 살짝 고개를 돌리고, 머리카락과 옷자락이 바람에 조금 흔들린다. 큰 동작은 하지 않는다.',
    '카메라는 아주 천천히 앞으로 다가간다. 따뜻하고 부드러운 빛.',
    cap ? `장면 느낌: ${cap}` : '',
    '아무도 말하지 않는다. 입은 다물고 있다. 소리·음악·자막·화면 글자는 넣지 않는다.'].filter(Boolean).join('\n');
}
let SH = -1, SHURL = '';
async function copyText(t) {
  try { await navigator.clipboard.writeText(t); return true; }
  catch (e) { const a = document.createElement('textarea'); a.value = t; document.body.appendChild(a); a.select(); let ok = false; try { ok = document.execCommand('copy'); } catch (e2) { /* 실패 */ } a.remove(); return ok; }
}
async function openSheet(i) {
  SH = i; const p = P.photos[i]; if (!p) return;
  $('sTitle').textContent = `✨ ${i + 1}번 사진을 영상으로`;
  if (SHURL) URL.revokeObjectURL(SHURL); SHURL = '';
  const box = $('sImg'), vb = p.vid ? await fGet('v:' + p.id) : null;
  const old = box.tagName === 'VIDEO' ? box : null, el = document.createElement(vb ? 'video' : 'img'); el.id = 'sImg';
  if (vb) { SHURL = URL.createObjectURL(vb); el.src = SHURL; el.controls = true; el.muted = true; el.playsInline = true; } else el.src = await thumbUrl(p.id);
  box.replaceWith(el); if (old) old.removeAttribute('src');
  $('sheet').style.display = 'flex'; sheetRender();
}
function sheetRender() {
  const p = P.photos[SH]; if (!p) return; const st = p.vid ? 9 : (p.vstep || 0);
  $('sheet').querySelectorAll('[data-s]').forEach(b => { const k = b.dataset.s; b.classList.toggle('y', String(st) === k); });
  $('sheet').querySelector('[data-s="3"]').textContent = p.vid ? '④ 다른 영상으로 바꾸기' : '④ 받은 영상 넣기';
  $('sDel').style.display = p.vid ? 'block' : 'none';
}
function closeSheet() { $('sheet').style.display = 'none'; const v = $('sImg'); if (v.tagName === 'VIDEO') v.pause(); if (SHURL) { URL.revokeObjectURL(SHURL); SHURL = ''; } SH = -1; render(); }
async function sheetAct(k) {
  const p = P.photos[SH]; if (!p) return;
  if (k === 'close') return closeSheet();
  if (k === '0') { const b = await fGet('f:' + p.id); const u = URL.createObjectURL(b), a = document.createElement('a'); a.href = u; a.download = `flow_photo_${SH + 1}.jpg`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 4000); toast('📷 사진을 「다운로드」에 저장했어요 — Flow에서 이 사진을 넣으세요', 3500); p.vstep = 1; }
  if (k === '1') { const ok = await copyText(flowPrompt(p)); toast(ok ? '📋 프롬프트를 복사했어요 — Flow 입력 칸에 붙여 넣으세요' : '복사가 안 됐어요. 다시 눌러 주세요', 3500); if (ok) p.vstep = 2; }
  if (k === '2') { window.open(FLOW_URL, '_blank'); p.vstep = 3; }
  if (k === '3') { vin.onchange = async () => { const f = vin.files[0]; vin.value = ''; if (!f) return; const d = await audioDur(f); if (!d) { toast('이 영상은 읽을 수 없어요 (MP4)'); return; } await fSet('v:' + p.id, f); p.vid = { name: f.name, dur: d }; save(); toast(`🎬 ${SH + 1}번 사진에 영상을 넣었어요`); openSheet(SH); }; vin.click(); return; }
  if (k === 'del') { if (!confirm('넣은 영상을 빼고 사진으로 되돌릴까요?')) return; await fDel('v:' + p.id); p.vid = null; p.vstep = 0; save(); openSheet(SH); return; }
  save(); sheetRender();
}
const vin = document.createElement('input'); vin.type = 'file'; vin.accept = 'video/*,.mp4';

/* ═════════ 노래 ═════════ */
async function audioDur(blob) {
  const u = URL.createObjectURL(blob);
  try { return await new Promise(res => { const a = new Audio(); a.preload = 'metadata'; a.onloadedmetadata = () => res(a.duration || 0); a.onerror = () => res(0); a.src = u; }); }
  finally { URL.revokeObjectURL(u); }
}
async function setMusic(f) {
  if (!f) return;
  const dur = await audioDur(f);
  if (!dur || !isFinite(dur)) { toast('이 노래 파일은 읽을 수 없어요 (MP3 · M4A · WAV)'); return; }
  await fSet('music', f); P.music = { name: f.name, dur }; save(); render(); toast('🎵 노래를 넣었어요');
}

/* ═════════ 시간 계산 ═════════ */
function plan() {
  const N = P.photos.length; if (!N) return null;
  let per = P.sec, total;
  if (P.music && P.fit) per = clamp((P.music.dur - HOLD) / N, 1.5, 12);
  total = N * per + HOLD;
  const td = Math.min({ fast: .5, normal: 1, slow: 1.6 }[P.fx.speed] || 1, per * .45);
  return { N, per, total, td };
}
// 🎲 골고루 섞기: 모든 전환을 섞인 순서로 하나씩 (바로 넘어가기 · 지지직 같은 거친 것은 빼고)
const ALLMIX = (() => { const a = Object.keys(FX.TRANS).filter(k => !['cut', 'glitch', 'rgb', 'pixel'].includes(k)); const r = n => { const s = Math.sin(n * 91.7 + 13.1) * 43758.5; return s - Math.floor(s); }; return a.map((k, i) => [r(i), k]).sort((x, y) => x[0] - y[0]).map(x => x[1]); })();
function transFor(i) { return P.fx.mix ? ALLMIX[(i - 1) % ALLMIX.length] : (P.fx.tr || 'fade'); }
function outSize() { const s = P.q >= 1080 ? 1080 : 720; return P.ratio === '16:9' ? [Math.round(s * 16 / 9 / 2) * 2, s] : [s, Math.round(s * 16 / 9 / 2) * 2]; }

/* ═════════ 그리기 ═════════ */
const colF = () => (FX.FILTERS[P.fx.color] || ['', ''])[1];
function drawContain(x, src, W, H) {
  const iw = src.videoWidth || src.width, ih = src.videoHeight || src.height, s = Math.min(W / iw, H / ih), w = iw * s, h = ih * s;
  x.filter = colF() || 'none'; x.shadowColor = 'rgba(0,0,0,.5)'; x.shadowBlur = Math.min(W, H) * .03;
  x.drawImage(src, (W - w) / 2, (H - h) / 2, w, h);
  x.filter = 'none'; x.shadowBlur = 0;
}
/** 흐린 배경 (+ 가운데 사진). bgOnly면 배경만 */
function makeStill(src, W, H, bgOnly) {
  const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d', { alpha: false });
  const iw = src.videoWidth || src.width, ih = src.videoHeight || src.height, col = colF();
  const cs = Math.max(W / iw, H / ih) * 1.12;
  x.fillStyle = '#000'; x.fillRect(0, 0, W, H);
  x.filter = (col ? col + ' ' : '') + `blur(${Math.round(Math.min(W, H) / 22)}px) brightness(.55)`;
  x.drawImage(src, (W - iw * cs) / 2, (H - ih * cs) / 2, iw * cs, ih * cs);
  x.filter = 'none';
  if (!bgOnly) drawContain(x, src, W, H);
  return c;
}
function seek(v, t) {
  if (Math.abs(v.currentTime - t) < 0.001 && v.readyState >= 2) return Promise.resolve();
  return new Promise(res => { const to = setTimeout(done, 2500); function done() { clearTimeout(to); v.removeEventListener('seeked', done); res(); } v.addEventListener('seeked', done); v.currentTime = t; });
}
function drawVid(e, W, H) { const x = e.c.getContext('2d', { alpha: false }); x.drawImage(e.bg, 0, 0); drawContain(x, e.v, W, H); }
function freeEntry(e) { if (!e) return; e.c.width = e.c.height = 0; if (e.v) { e.v.removeAttribute('src'); e.v.load(); URL.revokeObjectURL(e.url); e.bg.width = e.bg.height = 0; } }
/** 🎬 Flow 영상이 든 사진: 지금 시간의 영상 한 장면을 그려 두기 */
async function vidAt(C, i, t, pl) {
  const e = C.cache.get(i); if (!e || !e.v) return;
  const vt = clamp(t - i * pl.per, 0, Math.max(0, (e.v.duration || 8) - .05));
  if (Math.abs(e.t - vt) < .001) return; await seek(e.v, vt); drawVid(e, C.W, C.H); e.t = vt;
}
function mkCtx(rs) {
  const [W, H] = rs, mk = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; };
  return { W, H, A: mk(), B: mk(), cache: new Map() };
}
async function ensure(C, i, center) {
  if (!C.cache.has(i)) {
    const ph = P.photos[i], vb = ph.vid ? await fGet('v:' + ph.id) : null; let e;
    if (vb) {
      const url = URL.createObjectURL(vb), v = document.createElement('video'); v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
      await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = () => rej(new Error(`${i + 1}번 사진에 넣은 영상을 읽을 수 없어요. 영상을 다시 넣어 주세요.`)); });
      await seek(v, 0);
      e = { c: document.createElement('canvas'), v, url, bg: makeStill(v, C.W, C.H, true), t: 0 }; e.c.width = C.W; e.c.height = C.H; drawVid(e, C.W, C.H);
    } else { const b = await fGet('f:' + ph.id); const bmp = await createImageBitmap(b); e = { c: makeStill(bmp, C.W, C.H) }; bmp.close && bmp.close(); }
    C.cache.set(i, e);
  }
  // 휴대폰 메모리 아끼기: 지금 사진 앞뒤 하나씩만 남기기
  for (const k of [...C.cache.keys()]) if (k < center - 1 || k > center + 1) { freeEntry(C.cache.get(k)); C.cache.delete(k); }
  return C.cache.get(i);
}
function zoomed(dst, e, k, odd) {
  const x = dst.getContext('2d', { alpha: false }), W = dst.width, H = dst.height, st = e.c;
  if (!P.fx.zoom || e.v) { x.drawImage(st, 0, 0); return dst; }
  const kk = odd ? 1 - k : k, s = 1 + .08 * kk;
  x.drawImage(st, W * (1 - s) / 2, H * (1 - s) / 2, W * s, H * s); return dst;
}
function capY(kind) { const v = P.ratio === '9:16'; if (kind === 'title') return v ? .24 : .18; if (kind === 'end') return v ? .5 : .5; return P.capPos === 'mid' ? (v ? .47 : .5) : (v ? .6 : .85); }
function drawFrame(C, x, t, pl) {
  const { W, H, A, B } = C, { N, per, total, td } = pl;
  const i = Math.min(N - 1, Math.floor(t / per)), st = i * per, end = i === N - 1 ? total : st + per + td, loc = t - st;
  const span = i => (i === N - 1 ? total - i * per : per + td);
  const cur = zoomed(A, C.cache.get(i), clamp(loc / span(i), 0, 1), i % 2);
  if (i > 0 && loc < td && transFor(i) !== 'cut') {
    const pst = (i - 1) * per, prev = zoomed(B, C.cache.get(i - 1), clamp((t - pst) / span(i - 1), 0, 1), (i - 1) % 2);
    FX.transition(x, W, H, transFor(i), prev, cur, clamp(loc / td, 0, 1));
  } else x.drawImage(cur, 0, 0);
  if (P.fx.efx) FX.overlay(x, W, H, { k: P.fx.efx, start: 0, dur: total }, t);
  // 자막
  if (P.title && P.title.trim()) FX.drawCaption(x, W, H, { t: P.title, st: 'variety', start: .4, dur: Math.min(4, Math.max(2.5, per * 1.4)), y: capY('title'), size: 1.05 }, t);
  const cp = P.photos[i].cap; if (cp && cp.trim()) { const s0 = st + (i > 0 ? td * .6 : .5); FX.drawCaption(x, W, H, { t: cp, st: 'box', start: s0, dur: (i === N - 1 ? total - HOLD : st + per) - s0, y: capY('cap'), size: .85 }, t); }
  if (P.endText && P.endText.trim()) { const s0 = Math.max(0, total - HOLD - Math.min(per * .6, 2)); FX.drawCaption(x, W, H, { t: P.endText, st: 'memory', start: s0, dur: total - s0 + 1, y: capY('end'), size: 1.1 }, t); }
  // 서서히 시작 · 끝
  let dark = 0;
  if (P.fx.fadein && t < 1) dark = Math.max(dark, 1 - t / 1);
  if (P.fx.fadeout && t > total - 1.5) dark = Math.max(dark, (t - (total - 1.5)) / 1.5);
  if (dark > 0) { x.save(); x.globalAlpha = clamp(dark, 0, 1); x.fillStyle = '#000'; x.fillRect(0, 0, W, H); x.restore(); }
}

/* ═════════ 소리 ═════════ */
async function mixAudio(total, SR) {
  const blob = await fGet('music'); if (!blob) return null;
  const OAC = g.OfflineAudioContext || g.webkitOfflineAudioContext, ab = await blob.arrayBuffer();
  const dec = await new Promise((res, rej) => { const c = new OAC(2, 44100, 44100); const q = c.decodeAudioData(ab, res, () => rej(new Error('노래 파일을 읽을 수 없어요 (MP3 · M4A · WAV)'))); if (q && q.then) q.then(res, () => {}); });
  const oc = new OAC(2, Math.ceil(total * SR), SR), gn = oc.createGain();
  for (let at = 0; at < total; at += dec.duration) { const s = oc.createBufferSource(); s.buffer = dec; s.connect(gn); s.start(at); if (dec.duration < 1) break; }
  const fi = P.fx.fadein ? Math.min(1, total / 4) : 0, fo = Math.min(2.5, total / 3);
  if (fi) { gn.gain.setValueAtTime(0, 0); gn.gain.linearRampToValueAtTime(1, fi); } else gn.gain.setValueAtTime(1, 0);
  gn.gain.setValueAtTime(1, Math.max(fi, total - fo)); gn.gain.linearRampToValueAtTime(0, total);
  gn.connect(oc.destination);
  return await new Promise((res, rej) => { oc.oncomplete = e => res(e.renderedBuffer); const q = oc.startRendering(); if (q && q.then) q.then(res, rej); });
}

/* ═════════ MP4 만들기 ═════════ */
async function pickV(W, H, fps) {
  const list = Math.min(W, H) >= 1080 ? ['avc1.640028', 'avc1.4d0028', 'avc1.42e028', 'avc1.640032'] : ['avc1.64001f', 'avc1.4d001f', 'avc1.42e01f', 'avc1.640028'];
  const bitrate = Math.min(W, H) >= 1080 ? 9e6 : 5e6;
  for (const codec of list) { const cfg = { codec, width: W, height: H, bitrate, framerate: fps, avc: { format: 'avc' } }; try { const r = await VideoEncoder.isConfigSupported(cfg); if (r.supported) return cfg; } catch (e) { /* 다음 */ } }
  return null;
}
async function pickA(sr) {
  if (typeof AudioEncoder === 'undefined') return null;
  for (const c of [{ codec: 'mp4a.40.2', mux: 'aac', b: 192000 }, { codec: 'opus', mux: 'opus', b: 160000 }]) { const cfg = { codec: c.codec, sampleRate: sr, numberOfChannels: 2, bitrate: c.b }; try { const r = await AudioEncoder.isConfigSupported(cfg); if (r.supported) return { cfg, mux: c.mux }; } catch (e) { /* 다음 */ } }
  return null;
}
let RESULT = null, BUSY = false;
async function exportMp4(onProg) {
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') throw new Error('이 브라우저는 영상 만들기를 지원하지 않아요. 크롬으로 열어 주세요.');
  const pl = plan(); if (!pl) throw new Error('사진을 먼저 넣어 주세요.');
  const [W, H] = outSize(), fps = 30, SR = 48000;
  const vcfg = await pickV(W, H, fps); if (!vcfg) throw new Error(`이 휴대폰은 ${W}x${H} 영상을 못 만들어요. 「보통 720」으로 바꿔 보세요.`);
  try { await Promise.all([document.fonts.load('900 60px "Black Han Sans"', P.title || '가'), document.fonts.load('700 60px "Gowun Batang"', P.endText || '가'), document.fonts.load('900 60px "Noto Sans KR"', P.photos.map(p => p.cap).join('').slice(0, 300) || '가')]); } catch (e) { /* 기본 글꼴 */ }
  const acfg = P.music ? await pickA(SR) : null;
  const mux = new g.Mp4Muxer({ video: { width: W, height: H }, audio: acfg ? { codec: acfg.mux, sampleRate: SR, numberOfChannels: 2, bitrate: acfg.cfg.bitrate } : undefined });
  let err = null, warning = P.music && !acfg ? '이 브라우저는 소리 넣기를 지원하지 않아 소리 없이 만들었어요.' : '';
  if (acfg) {
    onProg(0, '🎵 노래 넣는 중…');
    const ab = await mixAudio(pl.total, SR);
    const ae = new AudioEncoder({ output: (c, m) => mux.addAudioChunk(c, m), error: e => { err = e; } }); ae.configure(acfg.cfg);
    const L = ab.getChannelData(0), R = ab.numberOfChannels > 1 ? ab.getChannelData(1) : L, N = ab.length, BLK = 4800;
    for (let i = 0; i < N; i += BLK) { const n = Math.min(BLK, N - i), d = new Float32Array(n * 2); d.set(L.subarray(i, i + n), 0); d.set(R.subarray(i, i + n), n); const a = new AudioData({ format: 'f32-planar', sampleRate: SR, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round(i * 1e6 / SR), data: d }); ae.encode(a); a.close(); if (ae.encodeQueueSize > 16) await sleep(1); if (err) throw err; }
    await ae.flush(); ae.close(); if (err) throw err;
  }
  const C = mkCtx([W, H]), cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const x = cv.getContext('2d', { alpha: false }); x.imageSmoothingQuality = 'high';
  const ve = new VideoEncoder({ output: (c, m) => mux.addVideoChunk(c, m), error: e => { err = e; } }); ve.configure(vcfg);
  const nF = Math.max(1, Math.round(pl.total * fps)), fd = Math.round(1e6 / fps), t0 = performance.now();
  let lastI = -1;
  try {
    for (let f = 0; f < nF; f++) {
      if (err) throw err;
      const t = f / fps, i = Math.min(pl.N - 1, Math.floor(t / pl.per));
      if (i !== lastI) { lastI = i; if (i > 0) await ensure(C, i - 1, i); await ensure(C, i, i); if (i + 1 < pl.N) await ensure(C, i + 1, i); }
      await vidAt(C, i, t, pl); if (i > 0 && t - i * pl.per < pl.td) await vidAt(C, i - 1, t, pl);
      drawFrame(C, x, t, pl);
      const vf = new VideoFrame(cv, { timestamp: Math.round(f * 1e6 / fps), duration: fd }); ve.encode(vf, { keyFrame: f % (fps * 2) === 0 }); vf.close();
      while (ve.encodeQueueSize > 6) await sleep(2);
      if (f % 6 === 0 || f === nF - 1) { const el = (performance.now() - t0) / 1000, done = (f + 1) / nF; onProg(done, `🎬 ${Math.round(done * 100)}% · 남은 시간 약 ${fmt(el / done - el)}`); await sleep(0); }
    }
    await ve.flush(); if (err) throw err;
  } finally { try { ve.close(); } catch (e) { /* 닫힘 */ } for (const c of [cv, C.A, C.B]) c.width = c.height = 0; C.cache.forEach(freeEntry); C.cache.clear(); }
  return { blob: new Blob(mux.finalize(), { type: 'video/mp4' }), W, H, warning, dur: pl.total };
}
async function make() {
  if (BUSY) return; if (!P.photos.length) { toast('사진을 먼저 넣어 주세요'); show('photo'); return; }
  BUSY = true; $('make').disabled = true; $('make').textContent = '⏳ 만드는 중… 화면을 켜 두세요';
  let lock = null; try { lock = await navigator.wakeLock.request('screen'); } catch (e) { /* 지원 안 함 */ }
  const bar = $('bar'), pr = $('prog');
  try {
    const r = await exportMp4((d, m) => { bar.style.width = Math.round(d * 100) + '%'; pr.textContent = m; });
    if (RESULT && RESULT.url) URL.revokeObjectURL(RESULT.url);
    RESULT = { ...r, url: URL.createObjectURL(r.blob) };
    const v = $('out'); v.src = RESULT.url; v.style.display = 'block';
    pr.textContent = `✅ 다 만들었어요! ${r.W}×${r.H} · ${fmt(r.dur)} · ${(r.blob.size / 1048576).toFixed(1)}MB` + (r.warning ? ' · ⚠ ' + r.warning : '');
    P.seen.make = 1; save(); render();
  } catch (e) { pr.textContent = '❌ ' + (e && e.message || e); bar.style.width = '0'; }
  finally { BUSY = false; $('make').disabled = false; $('make').textContent = RESULT ? '🔁 다시 만들기' : '🎞 완성본 만들기'; try { lock && lock.release(); } catch (e) { /* 무시 */ } render(); }
}
function fname() { const d = new Date(), z = n => String(n).padStart(2, '0'); return `추억앨범_${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}_${z(d.getHours())}${z(d.getMinutes())}.mp4`; }
function saveFile() { if (!RESULT) return; const a = document.createElement('a'); a.href = RESULT.url; a.download = fname(); document.body.appendChild(a); a.click(); a.remove(); toast('💾 「다운로드」 폴더에 저장했어요 (갤러리에서도 보여요)', 3500); }
const KAKAO_HELP = '카톡에서 보내는 법: 「💾 휴대폰에 저장」 → 카톡 채팅방 → ＋ → 앨범(또는 파일) → 저장한 영상 고르기';
async function share() {
  if (!RESULT) return;
  // 받는 앱(카톡)이 한글 파일 이름을 못 받을 때가 있어 영어 이름으로 보내요
  const f = new File([RESULT.blob], 'album_' + Date.now() + '.mp4', { type: 'video/mp4', lastModified: Date.now() });
  if (!navigator.share || !(navigator.canShare && navigator.canShare({ files: [f] }))) { alert('이 휴대폰은 바로 보내기가 안 돼요.\n\n' + KAKAO_HELP); return; }
  try { await navigator.share({ files: [f] }); }
  catch (e) { if (e && e.name === 'AbortError') return; alert('바로 보내기가 안 됐어요 (' + (e && e.name || '오류') + ').\n\n' + KAKAO_HELP); }
}

/* ═════════ 화면 ═════════ */
const TABS = ['photo', 'music', 'text', 'fx', 'make'];
let TAB = 'photo';
function show(t) { TAB = t; P.seen[t] = 1; save(); render(); scrollTo(0, 0); }
function chips(id, obj, cur, onPick) {
  const el = $(id); el.innerHTML = Object.entries(obj).map(([k, v]) => `<button data-v="${k}" class="${k === cur ? 'on' : ''}">${v}</button>`).join('');
  el.onclick = e => { const b = e.target.closest('button'); if (!b) return; onPick(b.dataset.v); save(); render(); };
}
function setOn(id, v) { $(id).querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === String(v))); }
const NOW = {
  photo: () => P.photos.length ? `✅ 사진 ${P.photos.length}장. 순서와 자막을 확인하고 아래 노란 「다음 ▶」을 누르세요.` : '👉 지금 할 일: 노란 「📷 사진 고르기」를 눌러 사진을 넣으세요.',
  music: () => P.music ? '✅ 노래를 넣었어요. 아래 노란 「다음 ▶」을 누르세요.' : '👉 지금 할 일: 노란 「🎵 노래 고르기」로 노래를 넣으세요. (노래 없이 만들려면 「다음 ▶」)',
  text: () => '👉 첫 화면 제목과 마지막 글씨를 쓰세요. 비워도 돼요. 다 되면 「다음 ▶」.',
  fx: () => '👉 마음에 드는 효과를 고르세요. 그대로 둬도 예쁘게 나와요. 다 되면 「다음 ▶」.',
  make: () => RESULT ? '✅ 완성! 노란 「💾 휴대폰에 저장」을 누르세요.' : '👉 지금 할 일: 화면 모양을 고르고 노란 「🎞 완성본 만들기」를 누르세요.',
};
function render() {
  TABS.forEach(t => $('t-' + t).classList.toggle('on', t === TAB));
  const done = { photo: P.photos.length > 0, music: !!P.music, text: !!(P.title || P.endText), fx: !!P.seen.fx && TAB !== 'fx', make: !!RESULT };
  $('nav').querySelectorAll('button').forEach(b => { b.classList.toggle('on', b.dataset.t === TAB); b.classList.toggle('done', !!done[b.dataset.t]); });
  if (!BUSY) $('now').textContent = NOW[TAB]();
  // 노란 버튼은 지금 할 것 하나만
  const nx = $('next'), N = P.photos.length;
  $('pick').classList.toggle('y', TAB === 'photo' && !N);
  $('pickMusic').classList.toggle('y', TAB === 'music' && !P.music);
  $('make').classList.toggle('y', TAB === 'make' && !RESULT && !BUSY);
  $('save').classList.toggle('y', !!RESULT);
  nx.parentElement.style.display = TAB === 'make' ? 'none' : '';
  nx.classList.toggle('y', !((TAB === 'photo' && !N) || (TAB === 'music' && !P.music)));
  // 사진
  if (TAB === 'photo') renderPhotos();
  // 노래
  $('musicInfo').textContent = P.music ? `🎵 ${P.music.name} · ${fmt(P.music.dur)}` : '아직 노래가 없어요';
  $('pickMusic').textContent = P.music ? '🎵 다른 노래로 바꾸기' : '🎵 노래 고르기 (MP3)';
  $('fit').checked = !!P.fit; $('sec').value = P.sec;
  const pl = plan();
  $('sec').disabled = !!(P.music && P.fit);
  $('secV').textContent = pl ? `: ${pl.per.toFixed(1)}초` + (P.music && P.fit ? ' (노래에 맞춤)' : '') : `: ${P.sec}초`;
  // 글씨
  if (document.activeElement !== $('title')) $('title').value = P.title;
  if (document.activeElement !== $('endText')) $('endText').value = P.endText;
  setOn('capPos', P.capPos);
  // 효과
  setOn('trans', P.fx.mix ? '' : P.fx.tr);
  $('mixBtn').classList.toggle('on', !!P.fx.mix); $('mixBtn').textContent = P.fx.mix ? '🎲 골고루 섞기 ✓ 켜짐 (누르면 끄기)' : '🎲 골고루 섞기 (꺼짐 · 누르면 켜기)';
setOn('speed', P.fx.speed); setOn('color', P.fx.color); setOn('efx', P.fx.efx);
  $('zoom').checked = !!P.fx.zoom; $('fadein').checked = !!P.fx.fadein; $('fadeout').checked = !!P.fx.fadeout;
  // 완성
  setOn('ratio', P.ratio); setOn('qual', P.q);
  const [W, H] = outSize();
  $('sum').textContent = pl ? `사진 ${pl.N}장 × ${pl.per.toFixed(1)}초 → 영상 길이 ${fmt(pl.total)} · ${W}×${H}` + (P.music ? ' · 🎵 노래 있음' : ' · 소리 없음') : '사진을 먼저 넣어 주세요.';
  $('save').style.display = $('share').style.display = RESULT ? 'block' : 'none';
}

async function init() {
  try { const s = await kvGet('album'); if (s) { P = Object.assign(DEF(), s); P.fx = Object.assign(DEF().fx, s.fx || {}); P.seen = s.seen || {}; } } catch (e) { toast('저장 공간을 열 수 없어요. 크롬으로 열어 주세요'); }
  // 사진
  const fin = document.createElement('input'); fin.type = 'file'; fin.accept = 'image/*'; fin.multiple = true;
  fin.onchange = () => { addPhotos(fin.files); fin.value = ''; };
  $('pick').onclick = () => fin.click();
  $('sortDate').onclick = () => { P.photos.sort((a, b) => a.when - b.when); save(); render(); toast('📅 찍은 날짜 순서로 정렬했어요'); };
  $('clearAll').onclick = () => { if (!P.photos.length || !confirm(`사진 ${P.photos.length}장을 모두 뺄까요?\n(휴대폰 갤러리의 사진은 그대로 있어요)`)) return; for (const p of P.photos) for (const k of ['f:', 't:', 'v:']) fDel(k + p.id).catch(() => {}); THUMBS.forEach(u => u && URL.revokeObjectURL(u)); THUMBS.clear(); P.photos = []; save(); render(); };
  $('photos').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; if (b.dataset.flow != null) openSheet(+b.dataset.flow); else if (b.dataset.del != null) delPhoto(+b.dataset.del); else if (b.dataset.mv != null) move(+b.dataset.mv, +b.dataset.d); });
  $('photos').addEventListener('input', e => { const c = e.target.dataset.cap; if (c == null) return; P.photos[+c].cap = e.target.value; save(); });
  // 노래
  const min = document.createElement('input'); min.type = 'file'; min.accept = 'audio/*,.mp3,.m4a,.wav';
  min.onchange = () => { setMusic(min.files[0]); min.value = ''; };
  $('pickMusic').onclick = () => min.click();
  $('fit').onchange = e => { P.fit = e.target.checked; save(); render(); };
  $('sec').oninput = e => { P.sec = +e.target.value; save(); render(); };
  // 글씨
  $('title').oninput = e => { P.title = e.target.value; save(); };
  $('endText').oninput = e => { P.endText = e.target.value; save(); };
  $('title').onchange = $('endText').onchange = () => render();
  $('capPos').onclick = e => { const b = e.target.closest('button'); if (!b) return; P.capPos = b.dataset.v; save(); render(); };
  // 효과
  const TR = {}; ['fade', 'dissolve', 'blur', 'lightleak', 'sparkle', 'zoomIn', 'black', 'white', 'slide', 'push', 'wipe', 'circle', 'heart', 'star', 'doors', 'filmburn', 'flip', 'cut'].forEach(k => { if (FX.TRANS[k]) TR[k] = FX.TRANS[k]; });
  chips('trans', TR, P.fx.tr, v => { P.fx.tr = v; P.fx.mix = ''; });
  $('mixBtn').onclick = () => { P.fx.mix = P.fx.mix ? '' : 'all'; save(); render(); toast(P.fx.mix ? '🎲 골고루 섞기를 켰어요' : '골고루 섞기를 껐어요'); };
  chips('speed', { fast: '빠르게 0.5초', normal: '보통 1초', slow: '천천히 1.6초' }, P.fx.speed, v => { P.fx.speed = v; });
  const COL = {}; Object.entries(FX.FILTERS).forEach(([k, v]) => { COL[k] = v[0]; });
  chips('color', COL, P.fx.color, v => { P.fx.color = v; });
  const EF = { '': '없음' }; ['petal', 'heart', 'snow', 'stars', 'bokeh', 'lightleak', 'glow', 'grain', 'vignette', 'bars'].forEach(k => { if (FX.EFX[k]) EF[k] = FX.EFX[k]; });
  chips('efx', EF, P.fx.efx, v => { P.fx.efx = v; });
  ['zoom', 'fadein', 'fadeout'].forEach(k => { $(k).onchange = e => { P.fx[k] = e.target.checked; save(); }; });
  // 완성
  $('ratio').onclick = e => { const b = e.target.closest('button'); if (!b) return; P.ratio = b.dataset.v; save(); render(); };
  $('qual').onclick = e => { const b = e.target.closest('button'); if (!b) return; P.q = +b.dataset.v; save(); render(); };
  $('make').onclick = make; $('save').onclick = saveFile; $('share').onclick = share;
  $('sheet').onclick = e => { if (e.target.id === 'sheet') return closeSheet(); const b = e.target.closest('[data-s]'); if (b) sheetAct(b.dataset.s); };
  // 단계
  $('nav').onclick = e => { const b = e.target.closest('button'); if (b && !BUSY) show(b.dataset.t); };
  $('next').onclick = () => { const i = TABS.indexOf(TAB); if (TAB === 'photo' && !P.photos.length) { toast('먼저 「📷 사진 고르기」로 사진을 넣어 주세요'); return; } if (i < TABS.length - 1) show(TABS[i + 1]); };
  render();
}
g.BKALBUM = { P: () => P, plan, exportMp4, addPhotos, setMusic, render };
init();
})(window);

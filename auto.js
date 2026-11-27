/*! BK공방 자동 쇼츠 (휴대폰) v0.1 — 무료: ChatGPT 대본(복사·붙여넣기) → 휴대폰이 화면·자막·효과음·음악을 자동으로 → MP4 → 유튜브 보내기
 * 저장: IndexedDB 'bk-gongbang-m' (kv 'auto' · files 'ap'(상품 사진) 'al:N'(줄 사진) 'av'(목소리) 'abgm')
 * 대본 형식: ChatGPT가 주는 JSON (아래 SPEC)
 */
(function (g) {
'use strict';
const $ = id => document.getElementById(id);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = s => { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + '분 ' + String(s % 60).padStart(2, '0') + '초'; };
const FX = g.BKFX;
const GPT = 'https://chatgpt.com/';

/* ═════════ 저장 ═════════ */
let DB = null;
function db() { if (DB) return DB; DB = new Promise((res, rej) => { const q = indexedDB.open('bk-gongbang-m', 1); q.onupgradeneeded = () => { const d = q.result; d.createObjectStore('kv'); d.createObjectStore('files'); }; q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); return DB; }
async function op(store, mode, fn) { const d = await db(); return new Promise((res, rej) => { const tx = d.transaction(store, mode), r = fn(tx.objectStore(store)); tx.oncomplete = () => res(r && r.result); tx.onerror = () => rej(tx.error); }); }
const kvGet = k => op('kv', 'readonly', s => s.get(k)), kvSet = (k, v) => op('kv', 'readwrite', s => s.put(v, k));
const fGet = k => op('files', 'readonly', s => s.get(k)), fSet = (k, v) => op('files', 'readwrite', s => s.put(v, k)), fDel = k => op('files', 'readwrite', s => s.delete(k));

const DEF = () => ({ kind: '', style: 'anchor', topic: '', product: '', strong: '', link: '', ref: '', refTopic: '', hasProd: false,
  answer: '', D: null, voice: 'none', marks: null, bgm: 'beat', bgmName: '', pace: 'normal', pics: {}, seen: {} });
let P = DEF(), saveT = 0;
function save() { clearTimeout(saveT); saveT = setTimeout(() => kvSet('auto', P).catch(() => {}), 300); }
function toast(m, ms) { const t = $('toast'); t.textContent = m; t.style.display = 'block'; clearTimeout(toast.t); toast.t = setTimeout(() => { t.style.display = 'none'; }, ms || 2600); }
async function copyText(t) {
  try { await navigator.clipboard.writeText(t); return true; }
  catch (e) { const a = document.createElement('textarea'); a.value = t; document.body.appendChild(a); a.select(); let ok = false; try { ok = document.execCommand('copy'); } catch (e2) { /* 실패 */ } a.remove(); return ok; }
}
function pickFile(accept) { return new Promise(res => { const i = document.createElement('input'); i.type = 'file'; i.accept = accept; i.onchange = () => res(i.files[0] || null); i.click(); }); }
function loadImg(src) { return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('그림을 읽을 수 없어요')); im.src = src; }); }
function toJpeg(img, max, q) { const w0 = img.naturalWidth, h0 = img.naturalHeight, s = Math.min(1, max / Math.max(w0, h0)); const c = document.createElement('canvas'); c.width = Math.round(w0 * s); c.height = Math.round(h0 * s); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); return new Promise(r => c.toBlob(b => { c.width = c.height = 0; r(b); }, 'image/jpeg', q)); }
async function putImage(key) {
  const f = await pickFile('image/*'); if (!f) return false;
  const u = URL.createObjectURL(f);
  try { const im = await loadImg(u); await fSet(key, await toJpeg(im, 1920, .9)); return true; }
  catch (e) { toast('이 그림은 읽을 수 없어요'); return false; } finally { URL.revokeObjectURL(u); }
}

/* ═════════ 스타일 (미리 만든 참고 스타일) ═════════ */
const STYLES = {
  anchor: ['🎙 선비 앵커 뉴스', '조선 선비 앵커가 사극 말투로 뉴스를 읽고 촌평. 큰 노란 숫자, 「근데 웃긴 건」 반전.'],
  story: ['🗣 썰 풀기', '친구에게 이야기하듯 반말 섞인 구어체. 「그래서 어떻게 됐냐면…」으로 궁금하게.'],
  rank: ['🏆 TOP 3', '3위 → 2위 → 1위로 갈수록 놀라운 것. 마지막 1위에서 반전.'],
  fact: ['😲 몰랐던 사실', '「이거 알고 계셨나요?」로 시작, 숫자·연도로 놀라게, 끝에 생활 꿀팁.'],
};
const KIND_STYLE = { satire: 'anchor', shop: 'fact', ref: 'story' };

/* ═════════ ② ChatGPT 요청문 ═════════ */
const SPEC = `[답 형식] 설명 없이 아래 JSON 하나만, 코드블록 안에 써 줘.
{
 "title": ["화면 위 제목 1줄(14자 이내)", "제목 2줄(14자 이내)"],
 "hook": {"top": "첫 화면 작은 줄(12자 이내)", "big": "첫 화면 큰 글씨: 숫자나 충격어 8자 이내 (예: 73만 장?!)", "bottom": "아래 줄(14자 이내)"},
 "lines": [
  {"who": "앵커 또는 설명", "face": "놀람|화남|비꼼 (앵커일 때만)", "text": "읽을 문장 한두 개(45자 이내)", "card": "크게 띄울 숫자 카드(없으면 빈칸)", "emoji": "장면을 나타내는 이모지 1개", "pic": "이 장면 그림 설명(한국 배경, 한국 사람)"}
 ],
 "source": "출처: 언론사 이름(날짜) · …",
 "meta": {"title": "유튜브 제목(40자 이내, #shorts 포함)", "desc": "설명란 3~5줄", "tags": "#태그 5~7개"}
}
[규칙] lines는 9~11개, 다 합쳐 45~60초 분량. 첫 줄은 2초 안에 멈추게 하는 훅. 숫자·날짜는 기사 원문 그대로(지어내지 말 것). 어려운 한자어 대신 쉬운 말.`;

function styleText() { const s = STYLES[P.style] || STYLES.anchor; return `[말투·구성 스타일] ${s[0].replace(/^\S+\s/, '')}: ${s[1]}`; }
function request() {
  const k = P.kind;
  if (k === 'satire') return `너는 한국 시사 풍자 쇼츠 작가야. 진행자는 「조선 선비 앵커」(갓 쓴 선비, 사극 말투 "~하오", "~이옵니다", 웃기지만 점잖음).
${P.topic.trim() ? '주제: ' + P.topic.trim() : '먼저 최근 24시간 한국에서 가장 많이 본 뉴스 5개를 검색해서, 그중 「사람이 아니라 어이없는 상황·제도」를 풍자하기 좋은 것 1개를 골라 줘(사고·참사·특정인 사생활·연예인 사건은 고르지 말 것).'}
기사 2곳 이상에서 숫자·날짜를 확인하고, 그대로 써.
${styleText()}
[지킬 것] 특정 정치인·정당을 단정해 비난하지 말고 상황·제도를 풍자. 실존 인물 이름으로 조롱 금지. 마지막 줄은 "여러분 생각은 어떠하오? 댓글로 상소를 올려 주시오!" 같은 참여 유도.
앵커 줄(who=앵커)은 3~4개만, 나머지는 설명 줄. 숫자 카드(card)는 2~3개.
설명란 끝에 출처와 "※ 풍자 콘텐츠입니다. 진행자 선비 앵커는 AI로 만든 가상 캐릭터입니다."를 넣어.
${SPEC}`;
  if (k === 'shop') return `너는 한국 쇼핑 쇼츠 작가야. 형식은 「쇼핑 탄생 이야기」: 이 상품(분류)이 처음 어떻게 생겼는지 진짜 역사 → 지금 우리 생활 → 오늘 소개하는 상품.
상품: ${P.product.trim() || '(상품 이름 없음)'}
${P.strong.trim() ? '상품 좋은 점(상세페이지 내용, 이것만 써): ' + P.strong.trim() : '상품의 좋은 점은 지어내지 말고, 탄생 이야기 위주로.'}
${styleText()}
[지킬 것] 역사·연도·발명가는 확인된 사실만(모르면 빼기). 효능 과장·의학적 주장 금지. 가격은 쓰지 말 것.
마지막 줄은 "오늘 소개한 상품은 설명란 링크에서 확인해 보세요."
설명란 첫 줄에 "이 영상은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다."${P.link.trim() ? ', 그다음 줄에 링크: ' + P.link.trim() : ''}.
who는 모두 "설명", card는 연도나 숫자 2~3개.
${SPEC}`;
  return `너는 한국 유튜브 쇼츠 기획 작가야.
참고 영상: ${P.ref.trim() || '(주소 없음)'}
이 주소의 영상을 열어 보거나(못 열면 제목·설명·댓글을 검색해서) 구성만 분석해 줘: 첫 2초 훅 방식, 장면이 바뀌는 속도, 말투, 자막 느낌, 끝맺는 방식.
그다음 그 「풍」만 따라서 새 쇼츠 대본을 써 줘. 내용·대사·문장·그림은 절대 베끼지 말고 완전히 새로.
${P.refTopic.trim() ? '내 주제: ' + P.refTopic.trim() : '주제: 참고 영상과 같은 분야에서 요즘 사람들이 많이 찾는 새 주제 하나(네가 골라).'}
${P.ref.trim() ? '' : styleText()}
who는 모두 "설명". 사실·숫자는 확인된 것만, 출처를 source에.
${SPEC}`;
}
const fixRequest = () => `방금 답을 아래 형식 그대로 다시 써 줘. 설명 없이 JSON 코드블록 하나만.\n${SPEC}`;

/* ═════════ 답 읽기 ═════════ */
function parseAnswer(text) {
  let t = String(text || '').trim(); if (!t) return null;
  const m = t.match(/```(?:json)?\s*([\s\S]*?)```/); if (m) t = m[1];
  const a = t.indexOf('{'), b = t.lastIndexOf('}'); if (a < 0 || b < a) return null;
  t = t.slice(a, b + 1).replace(/[“”]/g, '"').replace(/,\s*([}\]])/g, '$1');
  let d; try { d = JSON.parse(t); } catch (e) { return null; }
  if (!d || !Array.isArray(d.lines) || !d.lines.length) return null;
  const s = v => String(v == null ? '' : v).trim();
  d.title = Array.isArray(d.title) ? d.title.map(s).slice(0, 2) : [s(d.title), ''];
  while (d.title.length < 2) d.title.push('');
  d.hook = d.hook || {}; d.hook = { top: s(d.hook.top), big: s(d.hook.big), bottom: s(d.hook.bottom) };
  d.lines = d.lines.map(l => ({ who: /앵커/.test(s(l.who)) ? '앵커' : '설명', face: s(l.face), text: s(l.text), card: s(l.card), emoji: s(l.emoji).slice(0, 4) || '📌', pic: s(l.pic) })).filter(l => l.text);
  d.source = s(d.source); d.meta = d.meta || {}; d.meta = { title: s(d.meta.title), desc: s(d.meta.desc), tags: s(d.meta.tags) };
  if (!d.hook.big) d.hook.big = (d.lines.find(l => l.card) || {}).card || d.title[0];
  return d.lines.length ? d : null;
}

/* ═════════ 시간 계획 ═════════ */
const HOOK = 1.6, END = 2.5;
function lineDur(l) { const per = P.pace === 'fast' ? .13 : .17; return Math.max(2.2, l.text.length * per + .9); }
function plan() {
  const D = P.D, segs = []; let t = 0;
  segs.push({ k: 'hook', s: 0, d: HOOK }); t = HOOK;
  const useRec = P.voice === 'rec' && P.marks && P.marks.length === D.lines.length + 1;
  D.lines.forEach((l, i) => { const d = useRec ? Math.max(1, P.marks[i + 1] - P.marks[i]) + (i === D.lines.length - 1 ? .4 : 0) : lineDur(l); segs.push({ k: 'line', i, s: t, d }); t += d; });
  segs.push({ k: 'end', s: t, d: END }); t += END;
  return { segs, total: t, useRec };
}
function chunks(text) {   // 13자 안팎으로 끊기 (말 끊는 곳 우선)
  const out = []; for (const p of text.split(/(?<=[,.!?…])\s+/)) { let cur = ''; for (const w of p.split(/\s+/)) { if ((cur + ' ' + w).trim().length > 13 && cur) { out.push(cur); cur = w; } else cur = (cur + ' ' + w).trim(); } if (cur) out.push(cur); }
  return out.length ? out : [text];
}

/* ═════════ 그리기 ═════════ */
const THEME = { satire: [['#e11d48', '#7c3aed', '#1d4ed8']], shop: [['#f97316', '#f59e0b', '#fb7185']], ref: [['#0ea5e9', '#7c3aed', '#ec4899']] };
const FACE = { 놀람: 'shock', 화남: 'angry', 비꼼: 'smug' };
function cover(x, src, W, H, zoom) {   // 꽉 채우기 + 천천히 확대
  const iw = src.width || src.naturalWidth, ih = src.height || src.naturalHeight, s = Math.max(W / iw, H / ih) * (zoom || 1);
  x.drawImage(src, (W - iw * s) / 2, (H - ih * s) / 2, iw * s, ih * s);
}
function rr(x, a, b, w, h, r) { x.beginPath(); if (x.roundRect) x.roundRect(a, b, w, h, r); else x.rect(a, b, w, h); }
function fitFont(x, text, size, maxW, fam) { let s = size; do { x.font = `900 ${s}px ${fam}`; if (x.measureText(text).width <= maxW) break; s -= 4; } while (s > 20); return s; }
function centerText(x, text, y, size, fill, stroke, sw, W, fam) {
  if (!text) return; const s = fitFont(x, text, size, W * .9, fam); x.textAlign = 'center'; x.textBaseline = 'middle'; x.lineJoin = 'round';
  if (stroke) { x.lineWidth = s * (sw || .16); x.strokeStyle = stroke; x.strokeText(text, W / 2, y); }
  x.fillStyle = fill; x.fillText(text, W / 2, y); return s;
}
const BH = '"Black Han Sans", "Noto Sans KR", sans-serif', NOTO = '"Noto Sans KR", sans-serif';
function drawCard(x, W, H, l, loc) {   // 사진 없는 줄: 색 배경 + 큰 이모지
  const th = (THEME[P.kind] || THEME.ref)[0], gr = x.createLinearGradient(0, 0, W, H);
  gr.addColorStop(0, th[0]); gr.addColorStop(.5, th[1]); gr.addColorStop(1, th[2]); x.fillStyle = gr; x.fillRect(0, 0, W, H);
  x.save(); x.globalAlpha = .12; x.fillStyle = '#fff'; for (let i = 0; i < 6; i++) { x.beginPath(); x.arc(W * ((i * 37) % 100) / 100, H * ((i * 61 + 20) % 100) / 100, W * (.12 + i * .03), 0, 7); x.fill(); } x.restore();
  const s = W * .36 * (1 + .04 * Math.sin(loc * 3)); x.font = `${Math.round(s)}px "Noto Color Emoji", "Apple Color Emoji", "Segoe UI Emoji", sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(l.emoji || '📌', W / 2, H * .4);
}
function drawTopBand(x, W, H, D) {
  x.fillStyle = 'rgba(0,0,0,.8)'; x.fillRect(0, 0, W, H * .17);
  const lab = P.kind === 'satire' ? 'BK풍자뉴스' : P.kind === 'shop' ? 'BK쇼핑이야기' : 'BK공방';
  x.font = `900 ${Math.round(W * .036)}px ${BH}`; const lw = x.measureText(lab).width + W * .05;
  x.fillStyle = '#e11d48'; rr(x, W * .04, H * .022, lw, H * .036, 10); x.fill(); x.fillStyle = '#fff'; x.textAlign = 'left'; x.textBaseline = 'middle'; x.fillText(lab, W * .04 + W * .025, H * .041);
  centerText(x, D.title[0], H * .088, W * .072, '#ffe600', '#000', .14, W, BH);
  centerText(x, D.title[1], H * .138, W * .066, '#fff', '#000', .14, W, BH);
}
function drawHook(x, W, H, D, base, loc) {
  if (base) cover(x, base, W, H, 1.12 + .03 * loc); else drawCard(x, W, H, { emoji: (D.lines[0] || {}).emoji }, loc);
  const gr = x.createLinearGradient(0, H * .45, 0, H); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(.35, 'rgba(0,0,0,.85)'); gr.addColorStop(1, 'rgba(0,0,0,.92)'); x.fillStyle = gr; x.fillRect(0, H * .45, W, H * .55);
  const bw = W / 3; x.fillStyle = '#e11d48'; x.fillRect(0, 0, bw, H * .01); x.fillStyle = '#7c3aed'; x.fillRect(bw, 0, bw, H * .01); x.fillStyle = '#1d4ed8'; x.fillRect(bw * 2, 0, bw, H * .01);
  centerText(x, D.hook.top, H * .555, W * .085, '#ffe600', '#000', .16, W, BH);
  const p = clamp(loc / .3, 0, 1), sc = .6 + .4 * (1 + 2.7 * Math.pow(p - 1, 3) + 1.7 * Math.pow(p - 1, 2));
  x.save(); x.translate(W / 2, H * .66); x.scale(sc, sc); x.translate(-W / 2, -H * .66);
  const fs = fitFont(x, D.hook.big, W * .19, W * .86, BH), tw = x.measureText(D.hook.big).width;
  x.fillStyle = '#ffd600'; rr(x, W / 2 - tw / 2 - W * .04, H * .66 - fs * .7, tw + W * .08, fs * 1.4, W * .03); x.fill(); x.lineWidth = W * .008; x.strokeStyle = '#000'; x.stroke();
  centerText(x, D.hook.big, H * .662, fs, '#e1142d', '#fff', .1, W, BH); x.restore();
  centerText(x, D.hook.bottom, H * .77, W * .075, '#fff', '#000', .16, W, BH);
}
function drawLineTop(x, W, H, D, sg, t) {
  const l = D.lines[sg.i], loc = t - sg.s, cs = chunks(l.text), tot = cs.reduce((a, c) => a + c.length, 0);
  let acc = 0, cur = cs[cs.length - 1], cst = sg.s;
  for (const c of cs) { const d = sg.d * .92 * c.length / tot; if (loc < acc + d) { cur = c; cst = sg.s + acc; break; } acc += d; }
  if (l.card && loc > .25 && loc < sg.d - .1) {
    const p = clamp((loc - .25) / .18, 0, 1), sc = 1 + .3 * (1 - p), fs = fitFont(x, l.card, W * .1, W * .8, BH), tw = x.measureText(l.card).width;
    x.save(); x.translate(W / 2, H * .3); x.scale(sc, sc); x.translate(-W / 2, -H * .3);
    x.fillStyle = 'rgba(225,29,72,.95)'; rr(x, W / 2 - tw / 2 - W * .05, H * .3 - fs * .75, tw + W * .1, fs * 1.5, W * .03); x.fill();
    centerText(x, l.card, H * .302, fs, '#ffe600', '#000', .12, W, BH); x.restore();
  }
  const anchor = l.who === '앵커';
  FX.drawCaption(x, W, H, { t: cur, st: anchor ? 'bubble' : 'variety', start: cst, dur: sg.s + sg.d - cst, y: .58, size: anchor ? .95 : 1.05 }, t);
}
function drawEnd(x, W, H, D) {
  x.fillStyle = '#101418'; x.fillRect(0, 0, W, H);
  centerText(x, P.kind === 'shop' ? '참고' : '출처', H * .4, W * .07, '#ffe600', null, 0, W, BH);
  const src = (D.source || '').replace(/^출처\s*[:：]\s*/, '').split(/\s*[·,]\s*/).slice(0, 4);
  src.forEach((s, i) => centerText(x, s, H * .47 + i * H * .05, W * .05, '#fff', null, 0, W, NOTO));
  centerText(x, P.kind === 'satire' ? '풍자 · 캐릭터는 가상(AI)' : 'BK공방', H * .72, W * .04, '#9ca3af', null, 0, W, NOTO);
}

/* ═════════ 소리 ═════════ */
async function decodeAudio(blob) {
  const OAC = g.OfflineAudioContext || g.webkitOfflineAudioContext, ab = await blob.arrayBuffer();
  return new Promise(res => { const c = new OAC(2, 44100, 44100); const q = c.decodeAudioData(ab, res, () => res(null)); if (q && q.then) q.then(res, () => res(null)); });
}
function beat(oc, dst, total) {   // 저작권 걱정 없는 기본 음악 (프로그램이 만드는 소리)
  const bpm = 104, b = 60 / bpm, notes = [55, 55, 65.4, 49], end = total - .5;
  for (let t = 0, i = 0; t < end; t += b, i++) {
    const k = oc.createOscillator(), kg = oc.createGain(); k.frequency.setValueAtTime(120, t); k.frequency.exponentialRampToValueAtTime(40, t + .12); kg.gain.setValueAtTime(.9, t); kg.gain.exponentialRampToValueAtTime(.001, t + .18); k.connect(kg); kg.connect(dst); k.start(t); k.stop(t + .2);
    const hb = oc.createBuffer(1, Math.ceil(oc.sampleRate * .05), oc.sampleRate), hd = hb.getChannelData(0); for (let j = 0; j < hd.length; j++) hd[j] = (Math.random() * 2 - 1) * (1 - j / hd.length);
    const h = oc.createBufferSource(), hf = oc.createBiquadFilter(), hg = oc.createGain(); h.buffer = hb; hf.type = 'highpass'; hf.frequency.value = 7000; hg.gain.value = .25; h.connect(hf); hf.connect(hg); hg.connect(dst); h.start(t + b / 2);
    if (i % 2 === 0) { const o = oc.createOscillator(), og = oc.createGain(); o.type = 'triangle'; o.frequency.value = notes[(i / 2 | 0) % 4] * 2; og.gain.setValueAtTime(.0001, t); og.gain.linearRampToValueAtTime(.35, t + .02); og.gain.exponentialRampToValueAtTime(.001, t + b * 1.8); o.connect(og); og.connect(dst); o.start(t); o.stop(t + b * 2); }
  }
}
async function mixAudio(pl, SR) {
  const { segs, total, useRec } = pl, OAC = g.OfflineAudioContext || g.webkitOfflineAudioContext, oc = new OAC(2, Math.ceil(total * SR), SR), out = oc.createGain(); out.connect(oc.destination);
  const D = P.D;
  if (useRec) { const vb = await fGet('av'), dec = vb ? await decodeAudio(vb) : null; if (dec) { const s = oc.createBufferSource(), vg = oc.createGain(); vg.gain.value = 1.3; s.buffer = dec; s.connect(vg); vg.connect(out); s.start(HOOK, P.marks[0]); } }
  const sx = oc.createGain(); sx.gain.value = .55; sx.connect(out);
  FX.sfx(oc, sx, 'dun', .05);
  segs.forEach(sg => { if (sg.k !== 'line') return; const l = D.lines[sg.i]; if (l.card) FX.sfx(oc, sx, 'pop', sg.s + .25); else if (sg.i === 0 || l.who === '앵커' && /놀람|화남/.test(l.face)) FX.sfx(oc, sx, 'boing', sg.s + .05); else if (sg.i % 3 === 0) FX.sfx(oc, sx, 'whoosh', sg.s); });
  const vol = useRec ? .09 : .22, bg = oc.createGain(); bg.gain.setValueAtTime(vol, 0); bg.gain.setValueAtTime(vol, Math.max(0, total - 2)); bg.gain.linearRampToValueAtTime(0, total); bg.connect(out);
  if (P.bgm === 'beat') beat(oc, bg, total);
  else if (P.bgm === 'file') { const bb = await fGet('abgm'), dec = bb ? await decodeAudio(bb) : null; if (dec) for (let at = 0; at < total; at += dec.duration) { const s = oc.createBufferSource(); s.buffer = dec; s.connect(bg); s.start(at); if (dec.duration < 1) break; } }
  return new Promise((res, rej) => { oc.oncomplete = e => res(e.renderedBuffer); const q = oc.startRendering(); if (q && q.then) q.then(res, rej); });
}

/* ═════════ MP4 ═════════ */
async function pickV(W, H, fps) {
  for (const codec of ['avc1.64001f', 'avc1.4d001f', 'avc1.42e01f', 'avc1.640028']) { const cfg = { codec, width: W, height: H, bitrate: 5e6, framerate: fps, avc: { format: 'avc' } }; try { if ((await VideoEncoder.isConfigSupported(cfg)).supported) return cfg; } catch (e) { /* 다음 */ } }
  return null;
}
async function pickA(sr) {
  if (typeof AudioEncoder === 'undefined') return null;
  for (const c of [{ codec: 'mp4a.40.2', mux: 'aac', b: 160000 }, { codec: 'opus', mux: 'opus', b: 128000 }]) { const cfg = { codec: c.codec, sampleRate: sr, numberOfChannels: 2, bitrate: c.b }; try { if ((await AudioEncoder.isConfigSupported(cfg)).supported) return { cfg, mux: c.mux }; } catch (e) { /* 다음 */ } }
  return null;
}
async function bitmap(key, url) { try { if (key) { const b = await fGet(key); return b ? await createImageBitmap(b) : null; } const r = await fetch(url); return await createImageBitmap(await r.blob()); } catch (e) { return null; } }
async function loadVisuals() {
  const D = P.D, V = { line: [], hook: null }, anc = {};
  if (P.kind === 'satire') for (const f of ['shock', 'angry', 'smug']) anc[f] = await bitmap(null, `auto/anchor_${f}.jpg`);
  const prod = P.hasProd ? await bitmap('ap') : null;
  for (let i = 0; i < D.lines.length; i++) {
    const l = D.lines[i]; let im = P.pics[i] ? await bitmap('al:' + i) : null;
    if (!im && P.kind === 'satire' && l.who === '앵커') im = anc[FACE[l.face] || 'shock'] || anc.shock;
    if (!im && P.kind === 'shop' && prod && (i === D.lines.length - 1 || i === D.lines.length - 2)) im = prod;
    V.line.push(im);
  }
  V.hook = P.kind === 'satire' ? anc.shock : (prod || V.line.find(Boolean) || null);
  return V;
}
let RESULT = null, BUSY = false;
async function exportMp4(onProg) {
  if (typeof VideoEncoder === 'undefined') throw new Error('이 브라우저는 영상 만들기를 지원하지 않아요. 크롬으로 열어 주세요.');
  const D = P.D, pl = plan(), W = 720, H = 1280, fps = 30, SR = 48000;
  const vcfg = await pickV(W, H, fps); if (!vcfg) throw new Error('이 휴대폰은 영상 만들기를 지원하지 않아요.');
  try { await Promise.all(['900 60px "Black Han Sans"', '900 60px "Noto Sans KR"', '900 60px "Jua"'].map(f => document.fonts.load(f, '가나다' + D.title.join('') + D.hook.big))); } catch (e) { /* 기본 글꼴 */ }
  onProg(0, '🖼 그림 준비 중…'); const V = await loadVisuals();
  onProg(0, '🎵 소리 만드는 중…');
  const ab = await mixAudio(pl, SR), acfg = await pickA(SR);
  const mux = new g.Mp4Muxer({ video: { width: W, height: H }, audio: acfg ? { codec: acfg.mux, sampleRate: SR, numberOfChannels: 2, bitrate: acfg.cfg.bitrate } : undefined });
  let err = null;
  if (acfg) {
    const ae = new AudioEncoder({ output: (c, m) => mux.addAudioChunk(c, m), error: e => { err = e; } }); ae.configure(acfg.cfg);
    const L = ab.getChannelData(0), R = ab.numberOfChannels > 1 ? ab.getChannelData(1) : L, N = ab.length, B = 4800;
    for (let i = 0; i < N; i += B) { const n = Math.min(B, N - i), d = new Float32Array(n * 2); d.set(L.subarray(i, i + n), 0); d.set(R.subarray(i, i + n), n); const a = new AudioData({ format: 'f32-planar', sampleRate: SR, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round(i * 1e6 / SR), data: d }); ae.encode(a); a.close(); if (ae.encodeQueueSize > 16) await sleep(1); if (err) throw err; }
    await ae.flush(); ae.close(); if (err) throw err;
  }
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const x = cv.getContext('2d', { alpha: false }); x.imageSmoothingQuality = 'high';
  const ve = new VideoEncoder({ output: (c, m) => mux.addVideoChunk(c, m), error: e => { err = e; } }); ve.configure(vcfg);
  const nF = Math.round(pl.total * fps), fd = Math.round(1e6 / fps), t0 = performance.now();
  let thumb = null;
  try {
    for (let f = 0; f < nF; f++) {
      if (err) throw err;
      const t = f / fps, sg = pl.segs.find(s => t >= s.s && t < s.s + s.d) || pl.segs[pl.segs.length - 1], loc = t - sg.s;
      x.save();
      if (sg.k === 'hook') drawHook(x, W, H, D, V.hook, loc);
      else if (sg.k === 'end') drawEnd(x, W, H, D);
      else {
        const im = V.line[sg.i]; if (im) { x.fillStyle = '#000'; x.fillRect(0, 0, W, H); cover(x, im, W, H, 1.02 + .08 * clamp(loc / sg.d, 0, 1)); } else drawCard(x, W, H, D.lines[sg.i], loc);
        drawTopBand(x, W, H, D); drawLineTop(x, W, H, D, sg, t);
        if (loc < .2 && sg.i >= 0) { x.globalAlpha = 1 - loc / .2; x.fillStyle = '#fff'; x.fillRect(0, 0, W, H); x.globalAlpha = 1; }
      }
      x.restore();
      if (f === Math.round(.9 * fps)) thumb = await new Promise(r => cv.toBlob(r, 'image/jpeg', .92));
      const vf = new VideoFrame(cv, { timestamp: Math.round(f * 1e6 / fps), duration: fd }); ve.encode(vf, { keyFrame: f % (fps * 2) === 0 }); vf.close();
      while (ve.encodeQueueSize > 6) await sleep(2);
      if (f % 6 === 0 || f === nF - 1) { const el = (performance.now() - t0) / 1000, dn = (f + 1) / nF; onProg(dn, `🎬 ${Math.round(dn * 100)}% · 남은 시간 약 ${fmt(el / dn - el)}`); await sleep(0); }
    }
    await ve.flush(); if (err) throw err;
  } finally { try { ve.close(); } catch (e) { /* 닫힘 */ } cv.width = cv.height = 0; }
  return { blob: new Blob(mux.finalize(), { type: 'video/mp4' }), thumb, W, H, dur: pl.total, noSound: !acfg };
}
async function make() {
  if (BUSY || !P.D) return; BUSY = true; $('make').disabled = true; $('make').textContent = '⏳ 만드는 중… 화면을 켜 두세요';
  let lock = null; try { lock = await navigator.wakeLock.request('screen'); } catch (e) { /* 없음 */ }
  try {
    const r = await exportMp4((d, m) => { $('bar').style.width = Math.round(d * 100) + '%'; $('prog').textContent = m; });
    if (RESULT) URL.revokeObjectURL(RESULT.url); RESULT = { ...r, url: URL.createObjectURL(r.blob) };
    $('out').src = RESULT.url; $('out').style.display = 'block';
    $('prog').textContent = `✅ 다 만들었어요! ${fmt(r.dur)} · ${(r.blob.size / 1048576).toFixed(1)}MB` + (r.noSound ? ' · 소리 없음(이 휴대폰은 소리 저장이 안 돼요)' : '');
    P.made = true; save();
  } catch (e) { $('prog').textContent = '❌ ' + (e && e.message || e); $('bar').style.width = '0'; }
  finally { BUSY = false; $('make').disabled = false; $('make').textContent = RESULT ? '🔁 다시 만들기' : '🎞 영상 만들기'; try { lock && lock.release(); } catch (e) { /* 무시 */ } render(); }
}
const fname = () => { const d = new Date(), z = n => String(n).padStart(2, '0'); return `쇼츠_${(P.D && P.D.title[0] || '').replace(/[\\/:*?"<>|]/g, '').slice(0, 16) || '자동'}_${z(d.getMonth() + 1)}${z(d.getDate())}${z(d.getHours())}${z(d.getMinutes())}.mp4`; };
function saveFile() { if (!RESULT) return; const a = document.createElement('a'); a.href = RESULT.url; a.download = fname(); document.body.appendChild(a); a.click(); a.remove(); toast('💾 「다운로드」 폴더에 저장했어요', 3500); }
function metaText() { const m = (P.D && P.D.meta) || {}; return [m.title, '', m.desc, '', m.tags].join('\n').trim(); }
async function upload() {
  if (!RESULT) return;
  await copyText(metaText());
  const f = new File([RESULT.blob], 'shorts_' + Date.now() + '.mp4', { type: 'video/mp4' });
  if (!navigator.share || !(navigator.canShare && navigator.canShare({ files: [f] }))) { saveFile(); alert('제목·설명을 복사했어요.\n이 휴대폰은 바로 보내기가 안 돼서 영상을 저장했어요.\n\n유튜브 앱 → ＋ → 「Shorts 동영상 업로드」 → 저장한 영상 고르기 → 제목 칸 길게 눌러 붙여넣기'); return; }
  toast('📋 제목·설명을 복사했어요 → 목록에서 YouTube를 고르세요', 4000);
  try { await navigator.share({ files: [f] }); } catch (e) { if (e && e.name !== 'AbortError') alert('바로 보내기가 안 됐어요 (' + e.name + '). 「💾 휴대폰에 저장」 후 유튜브 앱에서 올려 주세요.'); }
}

/* ═════════ 🎙 내 목소리 녹음 (한 번에 읽고, 줄마다 「다음 줄」) ═════════ */
let REC = null;
async function recToggle() {
  if (!P.D) return;
  if (!REC) {
    let st; try { st = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); } catch (e) { toast('마이크를 쓸 수 없어요. 마이크 허용을 눌러 주세요', 4000); return; }
    const mr = new MediaRecorder(st), parts = []; mr.ondataavailable = e => e.data.size && parts.push(e.data);
    REC = { mr, st, parts, t0: performance.now(), marks: [0], i: 0 };
    mr.onstop = async () => { st.getTracks().forEach(k => k.stop()); const b = new Blob(parts, { type: mr.mimeType || 'audio/webm' }); await fSet('av', b); P.marks = REC.marks; REC = null; save(); toast('🎙 녹음했어요! 자막이 목소리에 맞춰져요', 3500); render(); };
    mr.start(); $('recBtn').textContent = '다음 줄 ▶'; promptLine(); return;
  }
  REC.marks.push((performance.now() - REC.t0) / 1000); REC.i++;
  if (REC.i >= P.D.lines.length) { REC.mr.stop(); $('prompter').style.display = 'none'; $('recBtn').textContent = '🎙 다시 녹음하기'; return; }
  promptLine();
}
function promptLine() { const L = P.D.lines, i = REC.i; $('prompter').style.display = 'block'; $('pN').innerHTML = `<span class="rec">● 녹음 중</span> · ${i + 1} / ${L.length}`; $('pL').textContent = L[i].text; $('pX').textContent = L[i + 1] ? '다음: ' + L[i + 1].text : '이 줄을 읽고 「다음 줄」을 누르면 끝나요'; $('recBtn').textContent = i === L.length - 1 ? '✅ 끝 (마지막 줄 다 읽었어요)' : '다음 줄 ▶'; }

/* ═════════ 화면 ═════════ */
const TABS = ['pick', 'plan', 'deco', 'make'];
let TAB = 'pick';
function show(t) { TAB = t; P.seen[t] = 1; save(); render(); scrollTo(0, 0); }
function setOn(id, v) { $(id).querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === String(v))); }
function ready() { return P.kind && (P.kind !== 'shop' || P.product.trim()) && (P.kind !== 'ref' || P.ref.trim() || P.refTopic.trim()); }
function nowText() {
  if (TAB === 'pick') return !P.kind ? '👉 지금 할 일: 만들 종류를 하나 누르세요.' : !ready() ? (P.kind === 'shop' ? '👉 상품 이름을 써 주세요.' : '👉 참고 영상 주소(또는 내 주제)를 넣어 주세요.') : '👉 좋아요! 아래 「다음 ▶」을 누르세요.';
  if (TAB === 'plan') return P.D ? '✅ 대본이 들어왔어요. 「다음 ▶」' : P.answer.trim() ? '👉 「✅ 대본 넣기」를 누르세요.' : '👉 ① 노란 버튼으로 ChatGPT에 보내고 → ② 답을 복사해 「📥 붙여넣기」.';
  if (TAB === 'deco') return '👉 그대로 「다음 ▶」을 눌러도 돼요. (목소리·사진은 선택)';
  return RESULT ? '👉 「📺 유튜브에 올리기」를 누르세요.' : '👉 「🎞 영상 만들기」를 누르세요. (1~3분)';
}
function renderSum() {
  const D = P.D, el = $('sum'); if (!D) { el.style.display = 'none'; return; }
  el.style.display = 'block';
  el.innerHTML = `<h2>📜 ${esc(D.title.join(' '))}</h2><p class="hint">첫 화면: <b>${esc(D.hook.top)} / <span style="color:#dc2626">${esc(D.hook.big)}</span> / ${esc(D.hook.bottom)}</b></p>` +
    D.lines.map((l, i) => `<div class="hint" style="margin:2px 0">${i + 1}. ${esc(l.emoji)} ${l.who === '앵커' ? '<span class="tag">앵커 ' + esc(l.face) + '</span>' : ''}${esc(l.text)}${l.card ? ' <span class="tag r">' + esc(l.card) + '</span>' : ''}</div>`).join('') +
    `<p class="hint">약 ${Math.round(plan().total)}초 · ${esc(D.source)}</p>`;
}
function renderLines() {
  const D = P.D, box = $('lines'); if (!D) { box.innerHTML = '<div class="empty">② 대본을 먼저 넣어 주세요</div>'; return; }
  box.innerHTML = D.lines.map((l, i) => `<div class="row${P.pics[i] ? ' ok' : ''}"><div class="pic" data-i="${i}">${P.pics[i] ? '' : (P.kind === 'satire' && l.who === '앵커' ? '🎙 앵커' : esc(l.emoji))}</div><div><h4>${i + 1}. ${esc(l.text.slice(0, 26))}${l.text.length > 26 ? '…' : ''}</h4>
    <div class="t">${esc(l.pic)}</div><div class="b"><button data-a="gpt" data-i="${i}">📋 그림 요청문</button><button class="y" data-a="put" data-i="${i}">🖼 사진 넣기</button>${P.pics[i] ? `<button data-a="del" data-i="${i}">빼기</button>` : ''}</div></div></div>`).join('');
  box.querySelectorAll('.pic').forEach(async d => { const i = +d.dataset.i; if (!P.pics[i]) return; const b = await fGet('al:' + i); if (b) d.innerHTML = `<img src="${URL.createObjectURL(b)}">`; });
}
function render() {
  TABS.forEach(t => { $('t-' + t).classList.toggle('on', t === TAB); });
  document.querySelectorAll('#nav button').forEach(b => { b.classList.toggle('on', b.dataset.t === TAB); b.classList.toggle('done', !!(b.dataset.t === 'pick' ? ready() : b.dataset.t === 'plan' ? P.D : b.dataset.t === 'deco' ? P.seen.deco : RESULT)); });
  setOn('kind', P.kind); ['satire', 'shop', 'ref'].forEach(k => { $('box-' + k).style.display = P.kind === k ? 'block' : 'none'; });
  setOn('style', P.style); $('styleHint').textContent = (STYLES[P.style] || [])[1] || '';
  $('prodInfo').textContent = P.hasProd ? '✅ 상품 사진을 넣었어요 (마지막 장면·첫 화면에 나와요)' : '마지막 장면에 나올 진짜 상품 사진 (없으면 글씨 화면)';
  $('apply').style.display = P.answer.trim() && !P.D ? 'block' : 'none';
  renderSum();
  setOn('voice', P.voice); setOn('bgm', P.bgm); setOn('pace', P.pace);
  $('recBox').style.display = P.voice === 'rec' ? 'block' : 'none';
  $('recInfo').textContent = P.marks && P.D && P.marks.length === P.D.lines.length + 1 ? `✅ 녹음 있음 (${Math.round(P.marks[P.marks.length - 1])}초)` : '';
  $('bgmInfo').textContent = P.bgm === 'file' ? (P.bgmName ? '🎵 ' + P.bgmName : '아래 「내 음악」을 한 번 더 누르면 MP3를 고를 수 있어요') : P.bgm === 'beat' ? '프로그램이 만드는 음악이라 저작권 걱정이 없어요' : '';
  if (TAB === 'deco') renderLines();
  $('mkSum').textContent = P.D ? `「${P.D.title.join(' ')}」 · 약 ${Math.round(plan().total)}초 · ${P.voice === 'rec' && P.marks ? '내 목소리' : '자막만'} · ${({ beat: '기본 음악', none: '음악 없음', file: '내 음악' })[P.bgm]}` : '② 대본을 먼저 넣어 주세요.';
  $('make').disabled = !P.D || BUSY;
  $('save').style.display = RESULT ? 'block' : 'none'; $('upCard').style.display = RESULT ? 'block' : 'none'; $('meta').textContent = P.D ? metaText() : '';
  $('now').textContent = nowText();
  const i = TABS.indexOf(TAB); $('next').style.display = i < TABS.length - 1 ? 'block' : 'none';
  $('next').disabled = (TAB === 'pick' && !ready()) || (TAB === 'plan' && !P.D);
}

async function init() {
  const s = await kvGet('auto').catch(() => null); if (s) P = Object.assign(DEF(), s);
  $('style').innerHTML = Object.entries(STYLES).map(([k, v]) => `<button data-v="${k}">${v[0]}</button>`).join('');
  for (const id of ['topic', 'product', 'strong', 'link', 'ref', 'refTopic', 'answer']) { $(id).value = P[id] || ''; $(id).oninput = () => { P[id] = $(id).value; if (id === 'answer') P.D = null; save(); render(); }; }
  $('kind').onclick = e => { const b = e.target.closest('button'); if (!b) return; P.kind = b.dataset.v; P.style = KIND_STYLE[P.kind]; save(); render(); };
  $('style').onclick = e => { const b = e.target.closest('button'); if (!b) return; P.style = b.dataset.v; save(); render(); };
  $('pickProd').onclick = async () => { if (await putImage('ap')) { P.hasProd = true; save(); render(); toast('📷 상품 사진을 넣었어요'); } };
  $('pasteRef').onclick = async () => { try { const t = await navigator.clipboard.readText(); const m = t.match(/https?:\/\/\S+/); if (m) { P.ref = m[0]; $('ref').value = P.ref; save(); render(); toast('🔗 주소를 넣었어요'); } else toast('복사된 주소가 없어요'); } catch (e) { toast('칸을 길게 눌러 붙여넣기 해 주세요', 3500); } };
  $('copyReq').onclick = async () => { const ok = await copyText(request()); toast(ok ? '📋 복사했어요! ChatGPT 입력 칸에 붙여넣기 → 보내기' : '복사가 안 됐어요. 다시 눌러 주세요', 4000); if (ok) setTimeout(() => window.open(GPT, '_blank'), 600); };
  $('pasteAns').onclick = async () => { try { const t = await navigator.clipboard.readText(); if (!t.trim()) { toast('복사된 답이 없어요. ChatGPT 답 아래 「복사」를 눌러 주세요', 4000); return; } P.answer = t; $('answer').value = t; applyAns(); } catch (e) { toast('아래 칸을 길게 눌러 붙여넣기 해 주세요', 3500); $('answer').focus(); } };
  $('apply').onclick = applyAns;
  $('copyFix').onclick = async () => { toast((await copyText(fixRequest())) ? '📋 복사했어요. 같은 ChatGPT 창에 붙여넣고 보내기' : '복사가 안 됐어요', 4000); };
  $('voice').onclick = e => { const b = e.target.closest('button'); if (!b) return; P.voice = b.dataset.v; save(); render(); };
  $('bgm').onclick = async e => { const b = e.target.closest('button'); if (!b) return; if (b.dataset.v === 'file') { const f = await pickFile('audio/*'); if (f) { await fSet('abgm', f); P.bgmName = f.name; P.bgm = 'file'; } } else P.bgm = b.dataset.v; save(); render(); };
  $('pace').onclick = e => { const b = e.target.closest('button'); if (!b) return; P.pace = b.dataset.v; save(); render(); };
  $('recBtn').onclick = recToggle;
  $('lines').onclick = async e => {
    const b = e.target.closest('button'); if (!b) return; const i = +b.dataset.i, l = P.D.lines[i];
    if (b.dataset.a === 'gpt') toast((await copyText(`세로 9:16 그림 한 장 그려 줘. 글자·자막은 넣지 마. 밝고 선명한 3D 애니메이션(블렌더) 스타일, 한국 배경·한국 사람.\n장면: ${l.pic || l.text}`)) ? '📋 그림 요청문을 복사했어요 → ChatGPT에 붙여넣기 → 그림 길게 눌러 저장 → 「사진 넣기」' : '복사가 안 됐어요', 5000);
    if (b.dataset.a === 'put') { if (await putImage('al:' + i)) { P.pics[i] = 1; save(); render(); } }
    if (b.dataset.a === 'del') { await fDel('al:' + i); delete P.pics[i]; save(); render(); }
  };
  $('make').onclick = make; $('save').onclick = saveFile; $('upBtn').onclick = upload;
  $('copyMeta').onclick = async () => toast((await copyText(metaText())) ? '📋 제목·설명을 복사했어요' : '복사가 안 됐어요');
  $('reset').onclick = async () => { if (!confirm('지금 작품을 비우고 처음부터 할까요?\n(완성본은 먼저 휴대폰에 저장해 두세요)')) return; for (const k of ['ap', 'av', 'abgm', ...Object.keys(P.pics).map(i => 'al:' + i)]) await fDel(k).catch(() => {}); P = DEF(); RESULT = null; $('out').style.display = 'none'; for (const id of ['topic', 'product', 'strong', 'link', 'ref', 'refTopic', 'answer']) $(id).value = ''; save(); show('pick'); };
  $('nav').onclick = e => { const b = e.target.closest('button'); if (b) show(b.dataset.t); };
  $('next').onclick = () => { const i = TABS.indexOf(TAB); if (i < TABS.length - 1) show(TABS[i + 1]); };
  render();
}
function applyAns() {
  const d = parseAnswer(P.answer);
  if (!d) { $('copyFix').style.display = 'block'; toast('대본 모양이 달라요. 아래 「🧩 정리 요청문」을 같은 ChatGPT 창에 보내 주세요', 5000); render(); return; }
  P.D = d; P.marks = null; $('copyFix').style.display = 'none'; save(); toast(`✅ 대본 ${d.lines.length}줄을 넣었어요!`); render();
}
g.BKAUTO = { parseAnswer, request: () => request(), get P() { return P; } };
init();
})(window);

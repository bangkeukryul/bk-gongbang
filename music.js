/*! BK공방 뮤직비디오 (휴대폰) v0.1 — 보드 방식: 노래(수노) → 가사 → 장면 기획(AI) → 그림(ChatGPT)·영상(Flow) → 효과 → MP4
 * 저장: IndexedDB 'bk-gongbang-m' (kv 'music' · files 'msong' 'mh' 'mi:N' 'mv:N')
 */
(function (g) {
'use strict';
const $ = id => document.getElementById(id);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = s => { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + '분 ' + String(s % 60).padStart(2, '0') + '초'; };
const fmt0 = s => { s = Math.max(0, Math.round(s || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const FX = g.BKFX;
const AI = { chatgpt: ['ChatGPT', 'https://chatgpt.com/'], gemini: ['제미나이', 'https://gemini.google.com/app'] };
const FLOW_URL = 'https://labs.google/fx/tools/flow', SUNO_URL = 'https://suno.com/create';
const GENRES = { ballad: '발라드', trot: '트로트', folk: '포크 감성', citypop: '시티팝', dance: '신나는 댄스', gugak: '국악 퓨전', hymn: '잔잔한 찬양', kids: '동요' };
const STYLES = { '실사 시네마틱': '🎬 실사 영화', '따뜻한 감성 사진': '📷 감성 사진', '수채화 그림': '🎨 수채화', '애니메이션 그림': '✏️ 애니', '옛날 필름 사진': '🎞 옛날 필름' };
const KR_LINE = '등장인물은 모두 한국 사람, 배경은 한국 (한국 거리 · 한국 집 · 한국 자연, 간판과 글씨는 한글).';

/* ═════════ 저장 ═════════ */
let DB = null;
function db() { if (DB) return DB; DB = new Promise((res, rej) => { const q = indexedDB.open('bk-gongbang-m', 1); q.onupgradeneeded = () => { const d = q.result; d.createObjectStore('kv'); d.createObjectStore('files'); }; q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); return DB; }
async function op(store, mode, fn) { const d = await db(); return new Promise((res, rej) => { const tx = d.transaction(store, mode), r = fn(tx.objectStore(store)); tx.oncomplete = () => res(r && r.result); tx.onerror = () => rej(tx.error); }); }
const kvGet = k => op('kv', 'readonly', s => s.get(k)), kvSet = (k, v) => op('kv', 'readwrite', s => s.put(v, k));
const fGet = k => op('files', 'readonly', s => s.get(k)), fSet = (k, v) => op('files', 'readwrite', s => s.put(v, k)), fDel = k => op('files', 'readwrite', s => s.delete(k));

const DEF = () => ({ title: '', topic: '', genre: 'ballad', ai: 'chatgpt', song: null, lyricsRaw: '', lines: [], timed: false,
  cap: { on: true, st: 'memory' }, ratio: '16:9', sceneLen: 8, style: '실사 시네마틱', hero: '', heroImg: 0, planAns: '', scenes: [], q: 720,
  fx: { tr: 'fade', mix: 'all', speed: 'normal', color: 'none', efx: '', titleOn: true, zoom: true, fadein: true, fadeout: true }, seen: {} });
let P = DEF(), saveT = 0;
function save() { clearTimeout(saveT); saveT = setTimeout(() => kvSet('music', P).catch(() => {}), 300); }
function toast(m, ms) { const t = $('toast'); t.textContent = m; t.style.display = 'block'; clearTimeout(toast.t); toast.t = setTimeout(() => { t.style.display = 'none'; }, ms || 2600); }
async function copyText(t) { try { await navigator.clipboard.writeText(t); return true; } catch (e) { const a = document.createElement('textarea'); a.value = t; document.body.appendChild(a); a.select(); let ok = false; try { ok = document.execCommand('copy'); } catch (e2) { /* 실패 */ } a.remove(); return ok; } }
async function copyMsg(t, what) { const ok = await copyText(t); toast(ok ? `📋 ${what}을(를) 복사했어요` : '복사가 안 됐어요. 다시 눌러 주세요', 3000); return ok; }
function pickFile(accept) { return new Promise(res => { const i = document.createElement('input'); i.type = 'file'; i.accept = accept; i.onchange = () => res(i.files[0] || null); i.click(); }); }
function loadImg(src) { return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('x')); im.src = src; }); }
function toJpeg(img, max, q) { const w0 = img.naturalWidth, h0 = img.naturalHeight, s = Math.min(1, max / Math.max(w0, h0)); const c = document.createElement('canvas'); c.width = Math.round(w0 * s); c.height = Math.round(h0 * s); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); return new Promise(r => c.toBlob(b => { c.width = c.height = 0; r(b); }, 'image/jpeg', q)); }
function mediaDur(blob, video) { const u = URL.createObjectURL(blob); return new Promise(res => { const v = document.createElement(video ? 'video' : 'audio'); v.preload = 'metadata'; v.muted = true; const fin = d => { res(isFinite(d) ? d : 0); URL.revokeObjectURL(u); }; v.onloadedmetadata = () => fin(v.duration); v.onerror = () => fin(0); v.src = u; }); }
const URLS = new Map();
async function fileUrl(k) { if (URLS.has(k)) return URLS.get(k); const b = await fGet(k); const u = b ? URL.createObjectURL(b) : ''; URLS.set(k, u); return u; }
function dropUrl(k) { const u = URLS.get(k); if (u) URL.revokeObjectURL(u); URLS.delete(k); }
async function putImage(key) { const f = await pickFile('image/*'); if (!f) return false; const u = URL.createObjectURL(f); try { await fSet(key, await toJpeg(await loadImg(u), 1920, .92)); dropUrl(key); return true; } catch (e) { toast('이 그림은 읽을 수 없어요'); return false; } finally { URL.revokeObjectURL(u); } }

/* ═════════ 가사 · 장면 시간 ═════════ */
function parseLyrics(raw) {
  const out = []; let timed = 0;
  String(raw || '').split(/\r?\n/).forEach(l => {
    let s = null, t = l.trim(); if (!t) return;
    const m = t.match(/^\[?\(?(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\)?\]?\s*[-–:]?\s*(.*)$/);
    if (m) { s = (+m[1]) * 60 + (+m[2]) + (m[3] ? +('0.' + m[3]) : 0); t = m[4].trim(); timed++; }
    if (!t || /^[\[(（【].*[\])）】]$/.test(t)) return;
    if (/^(verse|chorus|bridge|intro|outro|pre-?chorus|hook|간주|전주|후주|후렴|브릿지)\s*\d*\s*:?$/i.test(t)) return;
    if (/^`{3}/.test(t)) return;
    out.push({ t: t.replace(/^[-•·]\s*/, ''), s });
  });
  const tim = timed > 0 && timed >= out.length * .6;
  return { lines: tim ? out.filter(l => l.s != null) : out, timed: tim };
}
function lineTimes() {
  const L = P.lines, dur = (P.song && P.song.dur) || 0, n = L.length, a = dur * .1, b = dur * .92;
  return L.map((l, i) => { const s = l.s != null ? l.s : a + (b - a) * i / Math.max(1, n); const nx = i + 1 < n ? (L[i + 1].s != null ? L[i + 1].s : a + (b - a) * (i + 1) / n) : Math.min(dur, s + 5); return { s, e: Math.max(s + .4, Math.min(nx, s + 7)) }; });
}
function sceneLines(sc) { const T = lineTimes(), r = []; P.lines.forEach((l, i) => { const m = (T[i].s + T[i].e) / 2; if ((T[i].s >= sc.s - .3 && T[i].s < sc.e - .3) || (m >= sc.s && m < sc.e)) r.push(l.t); }); return r; }
function planScenes() {
  const dur = (P.song && P.song.dur) || 0; if (!dur) return;
  const L = P.sceneLen || 8, n = Math.max(1, Math.ceil(dur / L - .25)), step = dur / n, old = P.scenes || [], out = [];
  for (let i = 0; i < n; i++) { const o = old[i] || {}; out.push({ s: +(i * step).toFixed(2), e: +((i + 1) * step).toFixed(2), prompt: o.prompt || '', img: o.img || 0, vid: o.vid || null, reuse: o.reuse != null && o.reuse < i ? o.reuse : null, vstep: o.vstep || 0 }); }
  for (let i = n; i < old.length; i++) { fDel('mi:' + i).catch(() => {}); fDel('mv:' + i).catch(() => {}); dropUrl('mi:' + i); dropUrl('mv:' + i); }
  P.scenes = out;
}
const ratioKo = () => P.ratio === '9:16' ? '세로 9:16' : '가로 16:9';

/* ═════════ 요청문 ═════════ */
const FENCE = '```';
function songReq() {
  return `너는 한국 노래 작사가 겸 작곡 기획자야. 아래 주제로 「수노(Suno)」 AI에 넣을 노래를 만들어 줘.

주제: ${P.topic.trim() || '(주제를 알아서 정해 줘: 따뜻하고 공감되는 이야기)'}
장르 · 분위기: ${GENRES[P.genre] || '발라드'}
${P.title ? '제목 후보: ' + P.title : ''}

[해 줄 일] 아래 세 가지를 **각각 따로 된 코드 블록 상자**에 넣어 줘(상자마다 복사 버튼이 생기게). 상자 밖 설명은 한 줄씩만.
① 가사 — 한국어, 3분 안팎. [Intro] [Verse 1] [Chorus] [Verse 2] [Bridge] [Chorus] [Outro] 같은 표시를 줄 맨 앞에 넣어 줘. 후렴은 쉽게 따라 부를 수 있게, 한 줄은 너무 길지 않게.
② 스타일 — 수노 「Style of Music」 칸에 넣을 영어 글(200자 안). 장르, 템포, 악기, 목소리(성별·나이 느낌)를 써 줘. 실존 가수 이름은 쓰지 마.
③ 제목 — 한국어 제목 하나.

${FENCE}text
(① 가사)
${FENCE}
${FENCE}text
(② 스타일)
${FENCE}
${FENCE}text
(③ 제목)
${FENCE}`;
}
function planReq() {
  const N = P.scenes.length;
  return `[BK공방 뮤직비디오 「${P.title || '제목 없음'}」 장면 기획 요청]
노래 길이 ${fmt0(P.song && P.song.dur)}로 뮤직비디오를 만들어요. ChatGPT로 그림 ${N}장을 만들고, 몇 장면은 구글 Flow로 움직이게 할 거예요. 당신은 기획만 해 주세요 (그림은 그리지 마세요).
그림 느낌: ${P.style} · 화면: ${ratioKo()}${P.hero ? '\n주인공: ' + P.hero : ''}

아래에 장면마다 그 시간에 나오는 가사를 적었어요. 노래 전체가 하나의 이야기처럼 이어지게, 장면마다 그림 설명을 한국어 한두 문장으로 써 주세요.
- 모든 장면은 한국 사람 · 한국 배경으로 (한국 거리 · 집 · 자연, 간판은 한글)
- 노래 구조(전주 · 1절 · 후렴 · 2절 · 브리지 · 후주)와 가사 흐름에 맞춰 장면을 나눠 주세요
- 가사의 감정과 맞게 (밝은 부분은 밝게, 슬픈 부분은 차분하게)
- 같은 주인공 · 같은 옷 · 같은 장소 느낌이 이어지게
- 주인공이 안 나오는 장면(풍경 · 물건 · 손 · 뒷모습 · 거리)도 3~4장면에 1번꼴로 섞어 주세요
- 후렴이 반복되는 곳은 앞의 후렴 그림을 다시 써도 돼요. 그럴 땐 설명 대신 「장면 6 다시 쓰기」처럼 한 줄만 써 주세요
- 화면에 글자 · 자막 · 로고는 넣지 않기
- 인사말 없이, 장면마다 아래 모양으로만 써 주세요:
### 장면 1
(설명)
### 장면 2
(설명)

` + P.scenes.map((sc, i) => { const ly = sceneLines(sc); return `장면 ${i + 1} (${fmt0(sc.s)}~${fmt0(sc.e)}) 가사: ${ly.length ? ly.join(' / ') : (i === 0 ? '(전주)' : '(반주만)')}`; }).join('\n');
}
function heroReq() {
  const ly = P.lines.map(l => l.t).join('\n').slice(0, 1500);
  return [`[BK공방 뮤직비디오 「${P.title || '뮤직비디오'}」 그림 방]`, '이 대화방에서 뮤직비디오 그림을 차례로 만들 거예요. 먼저 이 노래의 주인공을 정하고 그려 주세요.',
    ly ? `\n[가사]\n${ly}\n` : '', `그림 느낌: ${P.style} · 화면: ${ratioKo()}`, '등장인물은 한국 사람, 배경은 한국.', P.hero ? `주인공 조건 (꼭 지켜 주세요): ${P.hero}` : '',
    '\n해 주실 일:', '① 가사를 읽고 노래에 어울리는 주인공을 한국어 한 줄로 정해 주세요 (나이대 · 성별 · 얼굴 느낌 · 머리 · 옷). 「주인공: …」 모양으로 한 줄만.',
    '② 그 주인공을 그림 한 장으로 그려 주세요 (얼굴과 옷이 잘 보이는 상반신, 자연스러운 표정, 글자 · 로고 없이).',
    '③ 앞으로 이 대화방에 보내는 장면 글마다, 주인공이 나오면 이 주인공과 같은 얼굴 · 머리 · 옷으로 그림을 한 장씩 그려 주세요.'].filter(Boolean).join('\n');
}
function sceneReq(i) {
  const sc = P.scenes[i], ly = sceneLines(sc);
  const what = sc.prompt || (ly.length ? `가사 「${ly.join(' / ')}」의 감정을 담은 장면` : (i === 0 ? '노래가 시작되는 첫 장면, 분위기를 보여 주는 풍경' : '가사 없이 반주만 나오는 부분, 분위기를 이어 주는 장면'));
  return [`[장면 ${i + 1} / ${P.scenes.length} · ${P.title || '뮤직비디오'}]`, KR_LINE, `${P.style} 스타일, ${ratioKo()} 화면.`, P.hero ? `주인공: ${P.hero}.` : '',
    '주인공이 나오는 장면이면 이 대화방의 주인공과 같은 얼굴 · 머리 · 옷으로 그려 주세요. 나이 · 성별 · 얼굴을 바꾸지 마세요.',
    `장면: ${what}`, `고화질 그림 한 장 (${ratioKo()}).`, '화면에 글자 · 자막 · 로고를 넣지 마세요.'].filter(Boolean).join('\n');
}
function flowReq(i) {
  const sc = P.scenes[i], ly = sceneLines(sc);
  return [`${ratioKo()} 뮤직비디오 한 장면. 첨부한 그림에서 그대로 시작하는 8초짜리 영상이다.`,
    '첫 장면은 첨부한 그림과 완전히 같다. 사람의 얼굴, 머리, 옷, 배경은 그림과 똑같이 유지하고, 새 장면이나 새 사람을 만들지 않는다.',
    '등장인물은 모두 한국 사람이고 배경은 한국이다.',
    `장면: ${sc.prompt || (ly.length ? '가사 「' + ly.join(' / ') + '」의 감정' : '분위기를 이어 주는 장면')}`,
    '사람은 자연스럽게 조금 움직이고(머리카락·옷자락이 바람에 살짝, 고개를 돌리거나 미소), 카메라는 아주 천천히 다가가거나 옆으로 흐른다.',
    '아무도 말하지 않는다. 입은 다물고 있다. 소리 · 음악 · 자막 · 화면 글자는 넣지 않는다(노래는 따로 깔린다).'].join('\n');
}
function parsePlan(t) {
  let n = 0, want = -1; const S2 = P.scenes;
  String(t || '').replace(/\r/g, '').split('\n').forEach(l => {
    const x = l.replace(/\*\*|__|`/g, '').trim(); if (!x) return;
    const rr = x.match(/^[-#•\s]*(?:S|장면|scene|씬)\s*(\d{1,3})\b.*?(?:=|→|:)\s*(?:S|장면)\s*(\d{1,3})\s*(?:번)?\s*(?:그림)?\s*(?:다시|재사용|반복|같은)/i);
    if (rr && x.length <= 40 && S2[+rr[1] - 1] && S2[+rr[2] - 1] && +rr[2] < +rr[1]) { S2[+rr[1] - 1].reuse = +rr[2] - 1; S2[+rr[1] - 1].prompt = `♻ 장면 ${rr[2]} 그림 다시 쓰기`; n++; want = -1; return; }
    const m = x.match(/^[-#•]*\s*(?:S|장면|scene|씬)\s*(\d{1,3})\s*(?:\([^)]*\))?\s*(?:[.:)\]：\-—]\s*(.*))?$/i) || x.match(/^(\d{1,3})\s*[.)]\s*(.+)$/);
    if (m && S2[+m[1] - 1]) { const r = (m[2] || '').replace(/^가사\s*[:：].*$/, '').trim(); if (r.length > 3) { S2[+m[1] - 1].prompt = r; S2[+m[1] - 1].reuse = null; n++; want = -1; } else want = +m[1] - 1; return; }
    if (want >= 0 && x.length > 3 && !/^가사\s*[:：]/.test(x)) {
      const rm = x.length <= 30 && x.match(/^[♻\s(]*(?:장면|S)\s*(\d{1,3})\s*(?:번)?\s*(?:그림)?\s*(?:을|를)?\s*(?:다시\s*(?:쓰기|사용)|재사용|반복\s*사용|그대로\s*쓰기)[.)\s]*$/);
      if (rm && S2[+rm[1] - 1] && +rm[1] - 1 < want) { S2[want].reuse = +rm[1] - 1; S2[want].prompt = `♻ 장면 ${rm[1]} 그림 다시 쓰기`; } else { S2[want].prompt = x.replace(/^(설명|장면)\s*[:：]\s*/, ''); S2[want].reuse = null; }
      n++; want = -1;
    }
  });
  return n;
}

/* ═════════ 화면: 장면 목록 · 그림 보드 ═════════ */
function renderScn() {
  if (document.activeElement && document.activeElement.closest && document.activeElement.closest('#scnList')) return;
  $('scnList').innerHTML = P.scenes.map((sc, i) => { const ly = sceneLines(sc);
    return `<div class="capcut"><h4>장면 ${i + 1} <span class="tag">${fmt0(sc.s)}~${fmt0(sc.e)}</span>${sc.reuse != null ? `<span class="tag g">♻ 장면 ${sc.reuse + 1} 다시 쓰기</span>` : ''}</h4>
      <div class="who">🎵 ${ly.length ? esc(ly.join(' / ')) : (i === 0 ? '(전주)' : '(반주만)')}</div>
      <input type="text" data-p="${i}" value="${esc(sc.reuse != null ? '' : sc.prompt)}" placeholder="${sc.reuse != null ? '앞 그림을 다시 써요 (새로 쓰려면 여기에 설명)' : '장면 설명 (AI 답을 넣으면 채워져요)'}"></div>`; }).join('') || '<div class="empty">① 노래를 먼저 넣어 주세요</div>';
}
async function renderImg() {
  const hu = await fileUrl('mh');
  $('heroBox').innerHTML = `<div class="row ${P.heroImg ? 'ok' : ''}"><div class="pic">${hu ? `<img src="${hu}">` : '주인공 없음'}</div><div><h4>🧑 주인공 ${P.heroImg ? '<span class="tag g">✓</span>' : ''}</h4>
    <div class="t">${esc(P.hero || 'ChatGPT가 가사를 보고 정해요')}</div><div class="b"><button data-hq class="${!P.heroImg ? 'y' : ''}">📋 주인공 요청문 복사</button><button data-hi>🖼 주인공 그림 넣기</button></div></div></div>`;
  const first = P.scenes.findIndex(sc => sc.reuse == null && !sc.img);
  const urls = await Promise.all(P.scenes.map((sc, i) => sc.vid ? fileUrl('mv:' + i) : fileUrl('mi:' + (sc.reuse != null ? sc.reuse : i))));
  $('imgList').innerHTML = P.scenes.map((sc, i) => { const ly = sceneLines(sc), has = sc.reuse != null ? !!(P.scenes[sc.reuse] || {}).img : sc.img;
    return `<div class="row ${has ? 'ok' : ''}"><div class="pic ${P.ratio === '16:9' ? 'wide' : ''}">${urls[i] ? (sc.vid ? `<video src="${urls[i]}" muted playsinline preload="metadata"></video>` : `<img src="${urls[i]}">`) : '그림 없음'}</div>
    <div><h4>장면 ${i + 1} <span class="tag">${fmt0(sc.s)}</span>${sc.vid ? '<span class="tag g">🎬 영상</span>' : ''}${sc.reuse != null ? `<span class="tag g">♻ ${sc.reuse + 1}</span>` : ''}</h4>
    <div class="t">${esc((sc.reuse != null ? '' : sc.prompt) || ly.join(' / ') || '(반주)').slice(0, 80)}</div>
    <div class="b">${sc.reuse != null ? `<button data-nr="${i}">✏️ 새로 그리기</button>` : `<button data-sq="${i}" class="${P.heroImg && i === first ? 'y' : ''}">📋 요청문 복사</button><button data-si="${i}">🖼 그림 넣기</button>${sc.img ? `<button data-vs="${i}">${sc.vid ? '🎬 영상 바꾸기' : '✨ 영상'}</button>` : ''}`}</div></div></div>`; }).join('') || '<div class="empty">③ 장면을 먼저 나눠 주세요</div>';
}

/* ═════════ Flow 창 ═════════ */
let SH = -1, SHURL = '';
async function openSheet(i) {
  SH = i; const sc = P.scenes[i]; if (!sc) return;
  $('sTitle').textContent = `✨ 장면 ${i + 1} 영상 만들기`;
  $('sHint').innerHTML = `노래에 깔리는 장면이라 <b>대사 없음 → Veo 3.1 Lite</b>(10크레딧) · ${ratioKo()} · 8초. <b>노란 버튼을 차례로</b> 누르세요.`;
  if (SHURL) { URL.revokeObjectURL(SHURL); SHURL = ''; }
  const box = $('sImg'), vb = sc.vid ? await fGet('mv:' + i) : null, el = document.createElement(vb ? 'video' : 'img'); el.id = 'sImg';
  if (vb) { SHURL = URL.createObjectURL(vb); el.src = SHURL; el.controls = true; el.playsInline = true; } else el.src = await fileUrl('mi:' + i);
  box.replaceWith(el); $('sheet').style.display = 'flex'; sheetRender();
}
function sheetRender() { const sc = P.scenes[SH]; if (!sc) return; const st = sc.vid ? 9 : (sc.vstep || 0);
  $('sheet').querySelectorAll('[data-s]').forEach(b => b.classList.toggle('y', String(st) === b.dataset.s));
  $('sheet').querySelector('[data-s="3"]').textContent = sc.vid ? '④ 다른 영상으로 바꾸기' : '④ 받은 영상 넣기'; $('sDel').style.display = sc.vid ? 'block' : 'none'; }
function closeSheet() { $('sheet').style.display = 'none'; const v = $('sImg'); if (v.tagName === 'VIDEO') v.pause(); if (SHURL) { URL.revokeObjectURL(SHURL); SHURL = ''; } SH = -1; render(); }
async function sheetAct(k) {
  const sc = P.scenes[SH]; if (!sc) return;
  if (k === 'close') return closeSheet();
  if (k === '0') { const b = await fGet('mi:' + SH); const u = URL.createObjectURL(b), a = document.createElement('a'); a.href = u; a.download = `music_scene${SH + 1}.jpg`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 4000); toast('📷 그림을 「다운로드」에 저장했어요', 3000); sc.vstep = 1; }
  if (k === '1') { if (await copyMsg(flowReq(SH), 'Flow 프롬프트')) sc.vstep = 2; }
  if (k === '2') { window.open(FLOW_URL, '_blank'); sc.vstep = 3; }
  if (k === '3') { const f = await pickFile('video/*,.mp4'); if (!f) return; const d = await mediaDur(f, true); if (!d) { toast('이 영상은 읽을 수 없어요 (MP4)'); return; } await fSet('mv:' + SH, f); dropUrl('mv:' + SH); sc.vid = { dur: d }; save(); toast(`🎬 장면 ${SH + 1}에 영상을 넣었어요`); return openSheet(SH); }
  if (k === 'del') { if (!confirm('넣은 영상을 빼고 그림으로 되돌릴까요?')) return; await fDel('mv:' + SH); dropUrl('mv:' + SH); sc.vid = null; sc.vstep = 0; save(); return openSheet(SH); }
  save(); sheetRender();
}

/* ═════════ 그리기 ═════════ */
function transFor(i) { const ALL = Object.keys(FX.TRANS).filter(x => !['cut', 'glitch', 'rgb', 'pixel'].includes(x)); return P.fx.mix ? ALL[(i * 7 + 3) % ALL.length] : (P.fx.tr || 'fade'); }
const colF = () => (FX.FILTERS[P.fx.color] || ['', ''])[1];
function drawFit(x, src, W, H) {
  const iw = src.videoWidth || src.width, ih = src.videoHeight || src.height, ra = (iw / ih) / (W / H);
  if (ra > .85 && ra < 1.18) { x.filter = colF() || 'none'; const s = Math.max(W / iw, H / ih); x.drawImage(src, (W - iw * s) / 2, (H - ih * s) / 2, iw * s, ih * s); x.filter = 'none'; return; }
  const cs = Math.max(W / iw, H / ih) * 1.1; x.filter = (colF() ? colF() + ' ' : '') + `blur(${Math.round(Math.min(W, H) / 22)}px) brightness(.5)`;
  x.drawImage(src, (W - iw * cs) / 2, (H - ih * cs) / 2, iw * cs, ih * cs);
  x.filter = colF() || 'none'; const s = Math.min(W / iw, H / ih); x.drawImage(src, (W - iw * s) / 2, (H - ih * s) / 2, iw * s, ih * s); x.filter = 'none';
}
function seek(v, t) { if (Math.abs(v.currentTime - t) < .001 && v.readyState >= 2) return Promise.resolve(); return new Promise(res => { const to = setTimeout(done, 2500); function done() { clearTimeout(to); v.removeEventListener('seeked', done); res(); } v.addEventListener('seeked', done); v.currentTime = t; }); }
function freeE(e) { if (!e) return; if (e.c) e.c.width = e.c.height = 0; if (e.v) { e.v.removeAttribute('src'); e.v.load(); URL.revokeObjectURL(e.url); } }
function imgIndex(i) {   // 그림이 없으면 가까운 앞 · 뒤 그림을 빌려 씀
  const own = sc => sc.reuse != null ? (P.scenes[sc.reuse] && P.scenes[sc.reuse].img ? sc.reuse : -1) : (sc.img ? P.scenes.indexOf(sc) : -1);
  let k = own(P.scenes[i]); if (k >= 0) return k;
  for (let d = 1; d < P.scenes.length; d++) { if (i - d >= 0 && (k = own(P.scenes[i - d])) >= 0) return k; if (i + d < P.scenes.length && (k = own(P.scenes[i + d])) >= 0) return k; }
  return -1;
}
async function ensure(C, i) {
  if (!C.cache.has(i)) {
    const sc = P.scenes[i]; let e;
    if (sc.vid) { const b = await fGet('mv:' + i), url = URL.createObjectURL(b), v = document.createElement('video'); v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
      await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = () => rej(new Error(`장면 ${i + 1}의 영상을 읽을 수 없어요. 다시 넣어 주세요.`)); }); e = { v, url, t: -1 }; }
    else { const k = imgIndex(i), bmp = await createImageBitmap(await fGet('mi:' + k)), cv = document.createElement('canvas'); cv.width = C.W; cv.height = C.H; drawFit(cv.getContext('2d', { alpha: false }), bmp, C.W, C.H); bmp.close && bmp.close(); e = { c: cv }; }
    C.cache.set(i, e);
  }
  for (const k of [...C.cache.keys()]) if (k < i - 1 || k > i + 1) { freeE(C.cache.get(k)); C.cache.delete(k); }
  return C.cache.get(i);
}
async function drawBase(C, i, t) {
  const sc = P.scenes[i], x = C.BX, W = C.W, H = C.H, loc = t - sc.s, d = sc.e - sc.s, e = await ensure(C, i);
  if (i + 1 < P.scenes.length) ensure(C, i + 1).catch(() => {});
  if (e.v) { const vt = clamp(loc, 0, Math.max(0, (e.v.duration || d) - .04)); if (Math.abs(e.t - vt) > .001) { await seek(e.v, vt); e.t = vt; } x.fillStyle = '#000'; x.fillRect(0, 0, W, H); drawFit(x, e.v, W, H); }
  else if (P.fx.zoom) { const k = clamp(loc / d, 0, 1), s = 1 + .08 * (i % 2 ? 1 - k : k); x.drawImage(e.c, W * (1 - s) / 2, H * (1 - s) / 2, W * s, H * s); }
  else x.drawImage(e.c, 0, 0);
}
function drawTop(C, x, i, t, total, LT) {
  const sc = P.scenes[i], W = C.W, H = C.H, loc = t - sc.s, td = { fast: .5, normal: 1, slow: 1.6 }[P.fx.speed] || 1;
  if (i > 0 && loc < td && transFor(i) !== 'cut') FX.transition(x, W, H, transFor(i), C.LAST, C.BASE, clamp(loc / td, 0, 1)); else x.drawImage(C.BASE, 0, 0);
  if (P.fx.efx) FX.overlay(x, W, H, { k: P.fx.efx, start: 0, dur: total }, t);
  if (P.fx.titleOn && P.title) FX.drawCaption(x, W, H, { t: P.title, st: 'memory', start: .6, dur: 3.4, y: .45, size: 1.25 }, t);
  if (P.cap.on) { const y = P.ratio === '9:16' ? .62 : .86; LT.forEach((r, j) => { if (t >= r.s && t < r.e) FX.drawCaption(x, W, H, { t: P.lines[j].t, st: P.cap.st, start: r.s, dur: r.e - r.s, y, size: P.ratio === '9:16' ? .8 : .72 }, t); }); }
}

/* ═════════ MP4 ═════════ */
async function pickV(W, H, fps) { const list = Math.min(W, H) >= 1080 ? ['avc1.640028', 'avc1.4d0028', 'avc1.42e028', 'avc1.640032'] : ['avc1.64001f', 'avc1.4d001f', 'avc1.42e01f', 'avc1.640028'];
  for (const codec of list) { const cfg = { codec, width: W, height: H, bitrate: Math.min(W, H) >= 1080 ? 9e6 : 5e6, framerate: fps, avc: { format: 'avc' } }; try { if ((await VideoEncoder.isConfigSupported(cfg)).supported) return cfg; } catch (e) { /* 다음 */ } } return null; }
async function pickA(sr) { if (typeof AudioEncoder === 'undefined') return null; for (const c of [{ codec: 'mp4a.40.2', mux: 'aac', b: 192000 }, { codec: 'opus', mux: 'opus', b: 160000 }]) { const cfg = { codec: c.codec, sampleRate: sr, numberOfChannels: 2, bitrate: c.b }; try { if ((await AudioEncoder.isConfigSupported(cfg)).supported) return { cfg, mux: c.mux }; } catch (e) { /* 다음 */ } } return null; }
async function songBuffer(total, SR) {
  const OAC = g.OfflineAudioContext || g.webkitOfflineAudioContext, ab = await (await fGet('msong')).arrayBuffer();
  const dec = await new Promise((res, rej) => { const c = new OAC(2, 44100, 44100); const q = c.decodeAudioData(ab, res, () => rej(new Error('노래 파일을 읽을 수 없어요 (MP3 · M4A · WAV)'))); if (q && q.then) q.then(res, () => {}); });
  const oc = new OAC(2, Math.ceil(total * SR), SR), gn = oc.createGain(), s = oc.createBufferSource(); s.buffer = dec; s.connect(gn); gn.connect(oc.destination); s.start(0);
  if (P.fx.fadein) { gn.gain.setValueAtTime(0, 0); gn.gain.linearRampToValueAtTime(1, Math.min(1.5, total / 4)); } else gn.gain.setValueAtTime(1, 0);
  if (P.fx.fadeout) { gn.gain.setValueAtTime(1, Math.max(0, total - 3)); gn.gain.linearRampToValueAtTime(0, total); }
  return new Promise((res, rej) => { oc.oncomplete = e => res(e.renderedBuffer); const q = oc.startRendering(); if (q && q.then) q.then(res, rej); });
}
let RESULT = null, BUSY = false;
async function exportMp4(onProg) {
  if (typeof VideoEncoder === 'undefined') throw new Error('이 브라우저는 영상 만들기를 지원하지 않아요. 크롬으로 열어 주세요.');
  if (!P.song) throw new Error('① 노래를 먼저 넣어 주세요.');
  if (!P.scenes.length || imgIndex(0) < 0) throw new Error('④ 그림을 한 장 이상 넣어 주세요.');
  const total = P.song.dur, s = P.q >= 1080 ? 1080 : 720, W = P.ratio === '16:9' ? Math.round(s * 16 / 9 / 2) * 2 : s, H = P.ratio === '16:9' ? s : Math.round(s * 16 / 9 / 2) * 2, fps = 30, SR = 48000;
  const vcfg = await pickV(W, H, fps); if (!vcfg) throw new Error(`이 휴대폰은 ${W}x${H} 영상을 못 만들어요. 「보통 720」으로 바꿔 보세요.`);
  try { await Promise.all(['700 60px "Gowun Batang"', '900 60px "Noto Sans KR"', '900 60px "Black Han Sans"', '900 60px "Jua"', '900 60px "Nanum Pen Script"'].map(f => document.fonts.load(f, (P.title || '') + P.lines.map(l => l.t).join('').slice(0, 200) || '가'))); } catch (e) { /* 기본 */ }
  onProg(0, '🎵 노래 넣는 중…');
  const acfg = await pickA(SR), mux = new g.Mp4Muxer({ video: { width: W, height: H }, audio: acfg ? { codec: acfg.mux, sampleRate: SR, numberOfChannels: 2, bitrate: acfg.cfg.bitrate } : undefined });
  let err = null;
  if (acfg) { const ab = await songBuffer(total, SR), ae = new AudioEncoder({ output: (c, m) => mux.addAudioChunk(c, m), error: e => { err = e; } }); ae.configure(acfg.cfg);
    const L = ab.getChannelData(0), R = ab.numberOfChannels > 1 ? ab.getChannelData(1) : L, N = ab.length, B = 4800;
    for (let i = 0; i < N; i += B) { const n = Math.min(B, N - i), d = new Float32Array(n * 2); d.set(L.subarray(i, i + n), 0); d.set(R.subarray(i, i + n), n); const a = new AudioData({ format: 'f32-planar', sampleRate: SR, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round(i * 1e6 / SR), data: d }); ae.encode(a); a.close(); if (ae.encodeQueueSize > 16) await sleep(1); if (err) throw err; }
    await ae.flush(); ae.close(); if (err) throw err; }
  const mk = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; };
  const C = { W, H, cache: new Map(), BASE: mk(), LAST: mk() }; C.BX = C.BASE.getContext('2d', { alpha: false });
  const cv = mk(), x = cv.getContext('2d', { alpha: false }), LT = lineTimes();
  const ve = new VideoEncoder({ output: (c, m) => mux.addVideoChunk(c, m), error: e => { err = e; } }); ve.configure(vcfg);
  const nF = Math.max(1, Math.round(total * fps)), fd = Math.round(1e6 / fps), t0 = performance.now(); let lastI = -1;
  try {
    for (let f = 0; f < nF; f++) {
      if (err) throw err;
      const t = f / fps; let i = P.scenes.findIndex(sc => t < sc.e); if (i < 0) i = P.scenes.length - 1;
      if (i !== lastI) { if (lastI >= 0) C.LAST.getContext('2d').drawImage(C.BASE, 0, 0); lastI = i; }
      await drawBase(C, i, t); drawTop(C, x, i, t, total, LT);
      let dark = 0; if (P.fx.fadein && t < 1) dark = 1 - t; if (P.fx.fadeout && t > total - 2) dark = Math.max(dark, (t - (total - 2)) / 2);
      if (dark > 0) { x.save(); x.globalAlpha = clamp(dark, 0, 1); x.fillStyle = '#000'; x.fillRect(0, 0, W, H); x.restore(); }
      const vf = new VideoFrame(cv, { timestamp: Math.round(f * 1e6 / fps), duration: fd }); ve.encode(vf, { keyFrame: f % (fps * 2) === 0 }); vf.close();
      while (ve.encodeQueueSize > 6) await sleep(2);
      if (f % 6 === 0 || f === nF - 1) { const el = (performance.now() - t0) / 1000, dn = (f + 1) / nF; onProg(dn, `🎬 ${Math.round(dn * 100)}% · 남은 시간 약 ${fmt(el / dn - el)}`); await sleep(0); }
    }
    await ve.flush(); if (err) throw err;
  } finally { try { ve.close(); } catch (e) { /* 닫힘 */ } C.cache.forEach(freeE); for (const c of [cv, C.BASE, C.LAST]) c.width = c.height = 0; }
  return { blob: new Blob(mux.finalize(), { type: 'video/mp4' }), W, H, dur: total };
}
async function make() {
  if (BUSY) return; BUSY = true; $('make').disabled = true; $('make').textContent = '⏳ 만드는 중… 화면을 켜 두세요';
  let lock = null; try { lock = await navigator.wakeLock.request('screen'); } catch (e) { /* 없음 */ }
  try { const r = await exportMp4((d, m) => { $('bar').style.width = Math.round(d * 100) + '%'; $('prog').textContent = m; });
    if (RESULT) URL.revokeObjectURL(RESULT.url); RESULT = { ...r, url: URL.createObjectURL(r.blob) }; $('out').src = RESULT.url; $('out').style.display = 'block';
    $('prog').textContent = `✅ 다 만들었어요! ${r.W}×${r.H} · ${fmt(r.dur)} · ${(r.blob.size / 1048576).toFixed(1)}MB`; }
  catch (e) { $('prog').textContent = '❌ ' + (e && e.message || e); $('bar').style.width = '0'; }
  finally { BUSY = false; $('make').disabled = false; $('make').textContent = RESULT ? '🔁 다시 만들기' : '🎞 완성본 만들기'; try { lock && lock.release(); } catch (e) { /* 무시 */ } render(); }
}
const fname = () => { const d = new Date(), z = n => String(n).padStart(2, '0'); return `뮤직비디오_${(P.title || '').replace(/[\\/:*?"<>|]/g, '').slice(0, 20) || '작품'}_${z(d.getMonth() + 1)}${z(d.getDate())}${z(d.getHours())}${z(d.getMinutes())}.mp4`; };
function saveFile() { if (!RESULT) return; const a = document.createElement('a'); a.href = RESULT.url; a.download = fname(); document.body.appendChild(a); a.click(); a.remove(); toast('💾 「다운로드」 폴더에 저장했어요', 3500); }
const KAKAO_HELP = '카톡에서 보내는 법: 「💾 휴대폰에 저장」 → 카톡 채팅방 → ＋ → 앨범(또는 파일) → 저장한 영상 고르기';
async function share() { if (!RESULT) return; const f = new File([RESULT.blob], 'music_' + Date.now() + '.mp4', { type: 'video/mp4' });
  if (!navigator.share || !(navigator.canShare && navigator.canShare({ files: [f] }))) { alert('이 휴대폰은 바로 보내기가 안 돼요.\n\n' + KAKAO_HELP); return; }
  try { await navigator.share({ files: [f] }); } catch (e) { if (e && e.name !== 'AbortError') alert('바로 보내기가 안 됐어요 (' + e.name + ').\n\n' + KAKAO_HELP); } }

/* ═════════ 단계 · 노란 버튼 ═════════ */
const TABS = ['song', 'lyr', 'scn', 'img', 'fx', 'make'];
let TAB = 'song';
function show(t) { TAB = t; P.seen[t] = 1; save(); render(); scrollTo(0, 0); }
function setOn(id, v) { $(id).querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === String(v))); }
function chips(id, obj, onPick) { const el = $(id); el.innerHTML = Object.entries(obj).map(([k, v]) => `<button data-v="${k}">${v}</button>`).join(''); el.onclick = e => { const b = e.target.closest('button'); if (!b) return; onPick(b.dataset.v); save(); render(); }; }
function nowText() {
  const N = P.scenes.length, need = P.scenes.filter(sc => sc.reuse == null && !sc.img).length, planned = P.scenes.filter(sc => sc.prompt).length;
  return {
    song: P.song ? '✅ 노래가 들어갔어요. 아래 노란 「다음 ▶」을 누르세요.' : '👉 지금 할 일: 노래(MP3)가 있으면 노란 「🎵 노래 파일 넣기」. 없으면 아래 「수노로 노래 만들기」부터.',
    lyr: P.lines.length ? `✅ 가사 ${P.lines.length}줄. 「다음 ▶」을 누르세요.` : '👉 가사를 붙여 넣고 노란 「✅ 가사 넣기」를 누르세요. (가사 없는 곡이면 「다음 ▶」)',
    scn: !P.song ? '먼저 ① 노래를 넣어 주세요.' : planned ? `✅ 장면 ${N}개 중 ${planned}개에 설명이 들어갔어요. 「다음 ▶」을 누르세요.` : `👉 장면 ${N}개로 나눴어요. 노란 「📋 ① 장면 기획 요청문 복사」 → AI → 답을 붙여 넣기.`,
    img: !N ? '먼저 ③ 장면을 나눠 주세요.' : !P.heroImg ? '👉 먼저 주인공: 노란 「📋 주인공 요청문 복사」 → ChatGPT 새 대화방 → 그림 저장 → 「🖼 주인공 그림 넣기」.' : need ? `👉 그림 ${need}장이 남았어요. 노란 「📋 요청문 복사」부터 차례로 (같은 ChatGPT 대화방에서).` : '✅ 그림이 다 들어갔어요. 움직이게 할 장면만 「✨ 영상」 — 안 해도 돼요. 「다음 ▶」.',
    fx: '👉 마음에 드는 효과를 고르세요. 그대로 둬도 괜찮아요. 다 되면 「다음 ▶」.',
    make: RESULT ? '✅ 완성! 노란 「💾 휴대폰에 저장」을 누르세요.' : '👉 지금 할 일: 노란 「🎞 완성본 만들기」를 누르세요.',
  }[TAB];
}
function render() {
  TABS.forEach(t => $('t-' + t).classList.toggle('on', t === TAB));
  const N = P.scenes.length, done = { song: !!P.song, lyr: P.lines.length > 0, scn: N > 0 && P.scenes.some(s => s.prompt), img: N > 0 && P.scenes.every(s => s.reuse != null || s.img), fx: !!P.seen.fx && TAB !== 'fx', make: !!RESULT };
  $('nav').querySelectorAll('button').forEach(b => { b.classList.toggle('on', b.dataset.t === TAB); b.classList.toggle('done', !!done[b.dataset.t]); });
  if (!BUSY) $('now').textContent = nowText();
  if (P.title) $('pname').textContent = '🎵 ' + P.title;
  // ① 노래
  if (document.activeElement !== $('title')) $('title').value = P.title;
  if (document.activeElement !== $('topic')) $('topic').value = P.topic;
  $('songInfo').textContent = P.song ? `🎵 ${P.song.name} · ${fmt(P.song.dur)}` : '아직 노래가 없어요';
  $('pickSong').textContent = P.song ? '🎵 다른 노래로 바꾸기' : '🎵 노래 파일 넣기 (MP3)'; $('pickSong').classList.toggle('y', TAB === 'song' && !P.song);
  setOn('genre', P.genre); setOn('ai', P.ai); $('openAI').textContent = `🤖 ② ${AI[P.ai][0]} 열기 (붙여 넣고 보내기)`; $('openAI2').textContent = `🤖 ② ${AI[P.ai][0]} 열기 (붙여 넣고 보내기)`;
  // ② 가사
  if (document.activeElement !== $('lyrics')) $('lyrics').value = P.lyricsRaw;
  $('lyrInfo').textContent = P.lines.length ? `✅ 가사 ${P.lines.length}줄 ${P.timed ? '(시간 표시 있음 — 그 시간에 자막)' : '(노래에 고르게 나눠 자막)'}` : '';
  $('applyLyr').classList.toggle('y', TAB === 'lyr' && !!P.lyricsRaw.trim() && !P.lines.length);
  $('capOn').checked = !!P.cap.on; setOn('capSt', P.cap.st);
  // ③ 장면
  setOn('ratio', P.ratio); setOn('sceneLen', P.sceneLen); setOn('style', P.style);
  if (document.activeElement !== $('hero')) $('hero').value = P.hero;
  if (document.activeElement !== $('planAns')) $('planAns').value = P.planAns;
  $('scnSum').textContent = P.song ? `노래 ${fmt(P.song.dur)} ÷ ${P.sceneLen}초 → 장면 ${N}개 (그림 ${P.scenes.filter(s => s.reuse == null).length}장)` : '① 노래를 먼저 넣어 주세요.';
  const planned = P.scenes.some(s => s.prompt);
  $('copyPlan').classList.toggle('y', TAB === 'scn' && N > 0 && !planned && !P.planAns.trim());
  $('applyPlan').classList.toggle('y', TAB === 'scn' && !!P.planAns.trim() && !planned);
  if (TAB === 'scn') renderScn();
  if (TAB === 'img') renderImg();
  // ⑤ 효과
  setOn('trans', P.fx.mix ? '' : P.fx.tr); $('mixBtn').classList.toggle('on', !!P.fx.mix);
  $('mixBtn').textContent = P.fx.mix ? '🎲 골고루 섞기 ✓ 켜짐 (누르면 끄기)' : '🎲 골고루 섞기 (꺼짐 · 누르면 켜기)';
  setOn('speed', P.fx.speed); setOn('color', P.fx.color); setOn('efx', P.fx.efx);
  for (const k of ['titleOn', 'zoom', 'fadein', 'fadeout']) $(k).checked = !!P.fx[k];
  // ⑥ 완성
  setOn('qual', P.q);
  $('sum').textContent = P.song ? `노래 ${fmt(P.song.dur)} · 장면 ${N}개 (영상 ${P.scenes.filter(s => s.vid).length} · 그림 ${P.scenes.filter(s => !s.vid).length}) · ${ratioKo()}` : '① 노래부터 넣어 주세요.';
  $('make').classList.toggle('y', TAB === 'make' && !RESULT && !BUSY); $('save').classList.toggle('y', !!RESULT);
  $('save').style.display = $('share').style.display = RESULT ? 'block' : 'none';
  $('next').parentElement.style.display = TAB === 'make' ? 'none' : '';
  $('next').classList.toggle('y', TAB !== 'song' || !!P.song);
}

async function init() {
  try { const s = await kvGet('music'); if (s) { P = Object.assign(DEF(), s); P.fx = Object.assign(DEF().fx, s.fx || {}); P.cap = Object.assign(DEF().cap, s.cap || {}); } } catch (e) { toast('저장 공간을 열 수 없어요. 크롬으로 열어 주세요'); }
  // ① 노래
  $('title').oninput = e => { P.title = e.target.value; save(); };
  $('topic').oninput = e => { P.topic = e.target.value; save(); };
  chips('genre', GENRES, v => { P.genre = v; });
  $('ai').onclick = e => { const b = e.target.closest('button'); if (!b) return; P.ai = b.dataset.v; save(); render(); };
  $('pickSong').onclick = async () => { const f = await pickFile('audio/*,.mp3,.m4a,.wav'); if (!f) return; const d = await mediaDur(f, false); if (!d) { toast('이 노래 파일은 읽을 수 없어요 (MP3 · M4A · WAV)'); return; }
    await fSet('msong', f); P.song = { name: f.name, dur: d }; if (!P.title) P.title = f.name.replace(/\.[^.]+$/, ''); planScenes(); save(); render(); toast('🎵 노래를 넣었어요'); };
  $('copySong').onclick = () => copyMsg(songReq(), '노래 요청문');
  $('openAI').onclick = () => window.open(AI[P.ai][1], '_blank');
  $('openSuno').onclick = () => window.open(SUNO_URL, '_blank');
  // ② 가사
  $('lyrics').oninput = e => { P.lyricsRaw = e.target.value; save(); render(); };
  $('applyLyr').onclick = () => { const r = parseLyrics(P.lyricsRaw); if (!r.lines.length) { toast('가사를 찾지 못했어요'); return; } P.lines = r.lines; P.timed = r.timed; save(); render(); toast(`✅ 가사 ${r.lines.length}줄을 넣었어요`); };
  $('capOn').onchange = e => { P.cap.on = e.target.checked; save(); };
  chips('capSt', { memory: '추억 명조', basic: '기본 흰 글씨', hand: '손글씨', box: '반투명 상자', neon: '네온', cute: '귀여운' }, v => { P.cap.st = v; });
  // ③ 장면
  $('ratio').onclick = e => { const b = e.target.closest('button'); if (!b) return; P.ratio = b.dataset.v; save(); render(); };
  $('sceneLen').onclick = e => { const b = e.target.closest('button'); if (!b) return; if (P.scenes.some(s => s.img) && !confirm('장면 길이를 바꾸면 장면 수가 바뀌어요. 넣어 둔 그림은 번호대로 남아요. 바꿀까요?')) return; P.sceneLen = +b.dataset.v; planScenes(); save(); render(); };
  chips('style', STYLES, v => { P.style = v; });
  $('hero').oninput = e => { P.hero = e.target.value; save(); };
  $('copyPlan').onclick = () => { if (!P.song) { toast('① 노래를 먼저 넣어 주세요'); return; } copyMsg(planReq(), '장면 기획 요청문'); };
  $('openAI2').onclick = () => window.open(AI[P.ai][1], '_blank');
  $('planAns').oninput = e => { P.planAns = e.target.value; save(); render(); };
  $('applyPlan').onclick = () => { const n = parsePlan(P.planAns); if (!n) { toast('「### 장면 1」 모양의 설명을 찾지 못했어요. AI 답을 그대로 붙여 넣어 주세요', 4000); return; } save(); render(); toast(`✅ 장면 ${n}개에 설명을 넣었어요`); };
  $('scnList').oninput = e => { const i = e.target.dataset.p; if (i == null) return; const sc = P.scenes[+i]; sc.prompt = e.target.value; if (e.target.value.trim()) sc.reuse = null; save(); };
  // ④ 그림
  $('openGpt').onclick = () => window.open(AI.chatgpt[1], '_blank');
  $('heroBox').onclick = async e => { const b = e.target.closest('button'); if (!b) return;
    if (b.hasAttribute('data-hq')) copyMsg(heroReq(), '주인공 요청문');
    if (b.hasAttribute('data-hi')) { if (await putImage('mh')) { P.heroImg = 1; save(); render(); toast('🧑 주인공 그림을 넣었어요'); } } };
  $('imgList').onclick = async e => { const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.sq != null) copyMsg(sceneReq(+b.dataset.sq), `장면 ${+b.dataset.sq + 1} 그림 요청문`);
    if (b.dataset.si != null) { const i = +b.dataset.si; if (await putImage('mi:' + i)) { P.scenes[i].img = 1; save(); render(); toast(`🖼 장면 ${i + 1} 그림을 넣었어요`); } }
    if (b.dataset.vs != null) openSheet(+b.dataset.vs);
    if (b.dataset.nr != null) { const sc = P.scenes[+b.dataset.nr]; sc.reuse = null; sc.prompt = ''; save(); render(); } };
  $('sheet').onclick = e => { if (e.target.id === 'sheet') return closeSheet(); const b = e.target.closest('[data-s]'); if (b) sheetAct(b.dataset.s); };
  // ⑤ 효과
  $('mixBtn').onclick = () => { P.fx.mix = P.fx.mix ? '' : 'all'; save(); render(); toast(P.fx.mix ? '🎲 골고루 섞기를 켰어요' : '골고루 섞기를 껐어요'); };
  const TR = {}; ['fade', 'dissolve', 'blur', 'lightleak', 'sparkle', 'zoomIn', 'black', 'white', 'slide', 'push', 'wipe', 'circle', 'heart', 'filmburn', 'flip', 'cut'].forEach(k => { if (FX.TRANS[k]) TR[k] = FX.TRANS[k]; });
  chips('trans', TR, v => { P.fx.tr = v; P.fx.mix = ''; });
  chips('speed', { fast: '빠르게 0.5초', normal: '보통 1초', slow: '천천히 1.6초' }, v => { P.fx.speed = v; });
  const COL = {}; Object.entries(FX.FILTERS).forEach(([k, v]) => { COL[k] = v[0]; }); chips('color', COL, v => { P.fx.color = v; });
  const EF = { '': '없음' }; ['petal', 'heart', 'snow', 'stars', 'bokeh', 'lightleak', 'glow', 'grain', 'vignette', 'bars', 'rain'].forEach(k => { if (FX.EFX[k]) EF[k] = FX.EFX[k]; }); chips('efx', EF, v => { P.fx.efx = v; });
  for (const k of ['titleOn', 'zoom', 'fadein', 'fadeout']) $(k).onchange = e => { P.fx[k] = e.target.checked; save(); };
  // ⑥ 완성
  $('qual').onclick = e => { const b = e.target.closest('button'); if (!b) return; P.q = +b.dataset.v; save(); render(); };
  $('make').onclick = make; $('save').onclick = saveFile; $('share').onclick = share;
  $('reset').onclick = async () => {
    if (!confirm('지금 뮤직비디오(노래 · 가사 · 그림 · 영상)를 모두 비우고 새로 시작할까요?\n완성본은 먼저 휴대폰에 저장해 두세요.')) return;
    for (const k of ['msong', 'mh']) await fDel(k).catch(() => {});
    for (let i = 0; i < P.scenes.length; i++) { await fDel('mi:' + i).catch(() => {}); await fDel('mv:' + i).catch(() => {}); }
    URLS.forEach(u => u && URL.revokeObjectURL(u)); URLS.clear();
    const keep = { ai: P.ai, q: P.q, fx: P.fx, cap: P.cap, ratio: P.ratio, style: P.style, sceneLen: P.sceneLen }; P = Object.assign(DEF(), keep); RESULT = null;
    $('out').style.display = 'none'; $('prog').textContent = ''; $('bar').style.width = '0'; save(); show('song'); toast('🧹 새 뮤직비디오를 시작해요');
  };
  $('nav').onclick = e => { const b = e.target.closest('button'); if (b && !BUSY) show(b.dataset.t); };
  $('next').onclick = () => { if (TAB === 'song' && !P.song) { toast('먼저 노래(MP3)를 넣어 주세요'); return; } const i = TABS.indexOf(TAB); if (i < TABS.length - 1) show(TABS[i + 1]); };
  render();
}
g.BKMUSIC_M = { P: () => P, parseLyrics, parsePlan, planScenes, exportMp4, render, planReq, sceneReq, flowReq, songReq };
init();
})(window);

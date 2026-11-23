/*! BK공방 드라마 (휴대폰) v0.1 — 보드 방식: 기획(AI) → 그림(ChatGPT) → 영상(Flow) → 자막 → 효과 → MP4
 * 저장: IndexedDB 'bk-gongbang-m' (kv 'drama' · files 'dc:카드' 'di:컷' 'dv:컷' 'dbgm')
 * 대본 형식은 PC BK공방 드라마와 같음(=== 기획 / 카드 / 대본 ===, 【컷 N / 8초】, 이름: 대사)
 */
(function (g) {
'use strict';
const $ = id => document.getElementById(id);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = s => { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + '분 ' + String(s % 60).padStart(2, '0') + '초'; };
const FX = g.BKFX;
const AI = { chatgpt: ['ChatGPT', 'https://chatgpt.com/'], gemini: ['제미나이', 'https://gemini.google.com/app'] };
const FLOW_URL = 'https://labs.google/fx/tools/flow';
const NARR_WHO = ['내레이션', '나레이션', '해설', 'NA', 'N', '내레이터', '나레이터'];
const GATE_SEC = 2;

/* ═════════ 저장 ═════════ */
let DB = null;
function db() { if (DB) return DB; DB = new Promise((res, rej) => { const q = indexedDB.open('bk-gongbang-m', 1); q.onupgradeneeded = () => { const d = q.result; d.createObjectStore('kv'); d.createObjectStore('files'); }; q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); return DB; }
async function op(store, mode, fn) { const d = await db(); return new Promise((res, rej) => { const tx = d.transaction(store, mode), r = fn(tx.objectStore(store)); tx.oncomplete = () => res(r && r.result); tx.onerror = () => rej(tx.error); }); }
const kvGet = k => op('kv', 'readonly', s => s.get(k)), kvSet = (k, v) => op('kv', 'readwrite', s => s.put(v, k));
const fGet = k => op('files', 'readonly', s => s.get(k)), fSet = (k, v) => op('files', 'readwrite', s => s.put(v, k)), fDel = k => op('files', 'readwrite', s => s.delete(k));

const DEF = () => ({ topic: '', ai: 'chatgpt', answer: '', title: '', hook: '', summary: '', cards: [], cuts: [],
  cap: { line: true, narr: true, st: 'basic' }, bgm: null, bgmVol: .25, q: 720,
  fx: { tr: 'fade', mix: '', speed: 'fast', color: 'none', efx: '', gate: true, zoom: true, fadein: true, fadeout: true }, seen: {} });
let P = DEF(), saveT = 0;
function save() { clearTimeout(saveT); saveT = setTimeout(() => kvSet('drama', P).catch(() => {}), 300); }
function toast(m, ms) { const t = $('toast'); t.textContent = m; t.style.display = 'block'; clearTimeout(toast.t); toast.t = setTimeout(() => { t.style.display = 'none'; }, ms || 2600); }
async function copyText(t) {
  try { await navigator.clipboard.writeText(t); return true; }
  catch (e) { const a = document.createElement('textarea'); a.value = t; document.body.appendChild(a); a.select(); let ok = false; try { ok = document.execCommand('copy'); } catch (e2) { /* 실패 */ } a.remove(); return ok; }
}
async function copyMsg(t, what) { toast((await copyText(t)) ? `📋 ${what}을(를) 복사했어요` : '복사가 안 됐어요. 다시 눌러 주세요', 3000); }
function pickFile(accept) { return new Promise(res => { const i = document.createElement('input'); i.type = 'file'; i.accept = accept; i.onchange = () => res(i.files[0] || null); i.click(); }); }
function loadImg(src) { return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('그림을 읽을 수 없어요')); im.src = src; }); }
function toJpeg(img, max, q) { const w0 = img.naturalWidth, h0 = img.naturalHeight, s = Math.min(1, max / Math.max(w0, h0)); const c = document.createElement('canvas'); c.width = Math.round(w0 * s); c.height = Math.round(h0 * s); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); return new Promise(r => c.toBlob(b => { c.width = c.height = 0; r(b); }, 'image/jpeg', q)); }
function mediaDur(blob) { const u = URL.createObjectURL(blob); return new Promise(res => { const v = document.createElement('video'); v.preload = 'metadata'; v.onloadedmetadata = () => { res(isFinite(v.duration) ? v.duration : 0); URL.revokeObjectURL(u); }; v.onerror = () => { res(0); URL.revokeObjectURL(u); }; v.src = u; }); }
const URLS = new Map();
async function fileUrl(k) { if (URLS.has(k)) return URLS.get(k); const b = await fGet(k); const u = b ? URL.createObjectURL(b) : ''; URLS.set(k, u); return u; }
function dropUrl(k) { const u = URLS.get(k); if (u) URL.revokeObjectURL(u); URLS.delete(k); }
async function putImage(key) {
  const f = await pickFile('image/*'); if (!f) return false;
  const u = URL.createObjectURL(f);
  try { const im = await loadImg(u); await fSet(key, await toJpeg(im, 1920, .92)); dropUrl(key); return true; }
  catch (e) { toast('이 그림은 읽을 수 없어요'); return false; } finally { URL.revokeObjectURL(u); }
}

/* ═════════ ① 기획: 요청문 (PC BK공방과 같은 형식) ═════════ */
const FENCE = '```';
function topicRequest() {
  return `너는 한국 유튜브 쇼츠 드라마 채널을 여러 개 100만 조회수 이상으로 키워 본 기획 PD야.
내 채널은 AI로 만드는 60~70초 세로 숏드라마(참교육·사이다·반전) 채널이야.
${P.topic.trim() ? '원하는 방향: ' + P.topic.trim() + '\n' : ''}
요즘 잘 되는 한국 숏드라마 소재(직장 갑질, 시댁, 학교, 이웃, 가게 손님 등)를 참고해서 새 주제 10개를 표로 추천해 줘.
표: 번호 | 한 줄 주제 | 첫 2초 훅 대사 | 반전 | 통쾌한 응징 장면 | 점수(20점)
[조건] 인물 3~4명, 장소 1~2곳, 8~9컷(64~72초). 주인공은 화내지 않고 짧고 차분한 한마디로 되갚는다. 반전은 두 겹.
다른 영상 줄거리를 베끼지 말고 새 이야기로. 실존 인물·회사·상표 금지, 선정적이거나 잔인한 장면 금지.
마지막에 점수가 가장 높은 주제 하나를 "추천 주제: ..." 한 줄로 써 줘.`;
}
function planRequest() {
  const topic = P.topic.trim() || '(주제를 알아서 정해 줘: 참교육·사이다·반전)';
  return `너는 유튜브 쇼츠 드라마 작가야. 아래 주제로 60초가 넘는 세로(9:16) 쇼츠 드라마 1편을 써 줘.

주제: ${topic}

[잘 되는 공식 — 꼭 지켜 줘]
- 첫 컷 첫 대사는 감탄사 + 무시하는 말로 시작(예: "어머! 지방대 계약직이 여길 왜 와?")
- 주인공은 화내지 않는다. 짧고 차분한 한마디로 되갚는다.
- 반전은 두 겹(정체·실력 공개 + 하나 더), 결정타 대사는 짧은 명령형.
- 응징 직전 컷 제목 앞에 ★ 를 붙여 줘(그 앞에 '화면 두 번 톡톡' 정지 화면이 들어간다).
- 마지막 컷은 다음 화가 궁금해지는 한 장면으로.
- 등장인물은 모두 한국 사람, 배경은 한국.

[형식 — 이 모양 그대로만 출력해 줘. 프로그램이 자동으로 읽는다]
**답 전체를 코드 블록 상자 하나(${FENCE}text 로 시작해서 ${FENCE} 로 끝)에 넣어 줘. 상자 밖에는 아무것도 쓰지 마. 그래야 복사 버튼 한 번으로 전부 복사된다.**
=== 기획 ===
제목: (30자 안팎)
훅 문구: (첫 2초 화면에 뜰 큰 글씨, 12자 안팎)
한 줄 요약: (한 문장)
=== 카드 ===
@이름 | 인물 | (영어로 외모: 나이, 한국인, 얼굴, 머리, 옷 색과 종류, 소품) | 모습: (한국어 한 줄, 예: 60대 청소부, 하늘색 작업복) | 목소리: (한국어로: 나이·성별·말투, 예: 거만하고 비웃는 30대 남자 목소리)
@장소이름 | 배경 | (영어로 장소 묘사: 한국의 공간, 빛, 시간대)
=== 대본 ===
【컷 1 / 8초】 (장면 설명, 한국어 한두 문장)
이름: 대사
내레이션: 문장
【컷 2 / 8초】 …

[대본 규칙]
- 컷 8~9개, 컷마다 8초(전체 63~72초).
- 한 컷에 말하는 사람 2명 이하, 대사 한 줄은 15자 안팎(길면 영상 AI가 틀리게 읽는다).
- 대사가 없는 컷이나 대사가 짧은 컷에는 '내레이션:' 한 문장(15~25자)으로 상황을 설명해 줘.
- 인물은 3~4명, 장소는 1~2곳. 카드에 없는 인물·장소를 대본에 쓰지 마.
- 장면 설명(【컷】 뒤 글)에는 그 컷 화면에 나오는 인물 이름을 모두 쓴다(말을 듣는 사람도 포함).
- 대사·내레이션에 실존 인물, 회사, 상표 이름을 쓰지 마.`;
}
const FIX_REQ = `방금 써 준 드라마를 아래 형식으로만 다시 정리해 줘. 내용은 그대로 두고 모양만 바꿔 줘. 다른 설명은 붙이지 마.
**답 전체를 코드 블록 상자 하나(${FENCE}text 로 시작해서 ${FENCE} 로 끝)에 넣어 줘.**

=== 기획 ===
제목: (30자 안팎)
훅 문구: (12자 안팎)
한 줄 요약: (한 문장)
=== 카드 ===
@이름 | 인물 | (영어로 외모) | 모습: (한국어 한 줄) | 목소리: (한국어로: 나이·성별·말투)
@장소이름 | 배경 | (영어로 장소 묘사)
=== 대본 ===
【컷 1 / 8초】 (장면 설명 한두 문장)
이름: 대사
내레이션: 문장

규칙: 컷 8~9개(컷당 8초), 한 컷에 말하는 사람 2명 이하, 대사 15자 안팎, 응징 직전 컷 제목 앞에 ★.`;

/* ── AI 답 읽기 ── */
const CUT_ANY = /^\s*(?:#+\s*)?(?:\*\*)?\s*★?\s*(?:【|\[)?\s*★?\s*(?:컷|씬|장면|scene|s#)\s*#?\s*(\d+)\s*(?:[\/|,·\-]?\s*\(?\s*([\d.]+)\s*(?:초|s|sec)\s*\)?)?\s*(?:】|\])?\s*(?:\*\*)?\s*[:：\-–]?\s*(.*)$/i;
function parsePlan(text) {
  text = String(text || '').replace(/\r/g, '').replace(/^\s*`{3,}[\w-]*\s*$/gm, '');
  const sec = {}; let cur = null;
  for (const line of text.split('\n')) { const m = line.match(/^\s*=+\s*(기획|카드|대본)\s*=+\s*$/); if (m) { cur = m[1]; sec[cur] = []; continue; } if (cur) sec[cur].push(line); }
  if (!sec['대본']) sec['대본'] = text.split('\n');
  const info = (sec['기획'] || []).join('\n'), pick = k => { const m = info.match(new RegExp(k + '\\s*[:：]\\s*(.+)')); return m ? m[1].trim() : ''; };
  const cards = [];
  for (const line of sec['카드'] || []) {
    const m = line.match(/^\s*(@[^|]+?)\s*\|\s*(인물|배경|소품)\s*\|\s*(.+?)\s*$/); if (!m) continue;
    const c = { id: m[1].replace(/\s/g, ''), type: m[2], prompt: '', look: '', voice: '' }, desc = [];
    for (const part of m[3].split('|')) { const k = part.match(/^\s*(목소리|모습)\s*[:：]\s*(.+?)\s*$/); if (k) c[k[1] === '모습' ? 'look' : 'voice'] = k[2]; else if (part.trim()) desc.push(part.trim()); }
    c.prompt = desc.join(' '); cards.push(c);
  }
  const cuts = []; let cut = null;
  for (const raw of sec['대본']) {
    const line = raw.trim(); if (!line) continue;
    const m = line.match(CUT_ANY);
    if (m) { const note = m[3].replace(/^[\s*|\-–:]+|[\s*|\-–:]+$/g, ''); cut = { n: cuts.length + 1, sec: +m[2] || 8, gate: line.slice(0, line.indexOf(m[1])).includes('★') || note.includes('★'), note: note.replace(/★/g, '').trim(), action: [], lines: [], narr: [] }; cuts.push(cut); continue; }
    if (/^#/.test(line) || /^=+.*=+$/.test(line)) { cut = null; continue; }
    if (!cut) continue;
    const l = line.replace(/^[-•*·]\s+/, '').replace(/\*\*/g, '');
    const m2 = l.match(/^([^:：()（）]{1,15})\s*(\([^)]*\))?\s*[:：]\s*(.+)$/);
    if (m2) {
      let who = m2[1].trim(); const said = m2[3].trim().replace(/^["“”'‘’「」]+|["“”'‘’「」]+$/g, '');
      if (NARR_WHO.some(w => w.toUpperCase() === who.toUpperCase())) { cut.narr.push(said); continue; }
      if (['장면', '화면', '지문', '배경', '연출', '카메라', '설명', '상황', '자막'].includes(who)) { cut.action.push(said); continue; }
      cut.lines.push({ who, tone: (m2[2] || '').replace(/[()]/g, ''), text: said }); continue;
    }
    cut.action.push(l.replace(/^[(（]|[)）]$/g, ''));
  }
  if (!cuts.length) throw new Error('FORMAT');
  // 카드에 없는 말하는 사람은 카드를 자동으로 만들기
  const names = new Set(cards.map(c => c.id.replace(/^@/, '')));
  for (const c of cuts) for (const ln of c.lines) if (!names.has(ln.who)) { cards.push({ id: '@' + ln.who, type: '인물', prompt: `A Korean person called ${ln.who}`, look: '', voice: '' }); names.add(ln.who); }
  // 컷마다 나오는 카드 연결 (PC cut_refs와 같은 규칙)
  let prev = [];
  for (const c of cuts) {
    const blob = [c.note, ...c.action, ...c.lines.map(l => l.who + ' ' + l.text)].join(' ');
    const out = cards.filter(k => blob.includes(k.id.replace(/^@/, ''))).map(k => k.id);
    const people = new Set(cards.filter(k => k.type === '인물').map(k => k.id));
    if (c.lines.length && out.filter(x => people.has(x)).length < 2) for (const r of prev) if (people.has(r) && !out.includes(r)) out.push(r);
    const places = cards.filter(k => k.type === '배경').map(k => k.id);
    if (places.length && !out.some(x => places.includes(x))) out.push(places[0]);
    c.refs = out; prev = out;
  }
  return { title: pick('제목'), hook: pick('훅 문구'), summary: pick('한 줄 요약'), cards, cuts };
}

/* ═════════ ② 그림 · ③ 영상 요청문 ═════════ */
function cardReq(k) {
  if (k.type === '인물') return `사진처럼 사실적인 인물 시트 1장을 그려 줘. 가로 16:9, 밝은 회색 배경, 글자·로고 없이.
한 장을 세로로 3칸으로 나눠 **같은 사람**을 나란히: 왼쪽 = 정면 전신, 가운데 = 오른쪽 옆모습(측면) 전신, 오른쪽 = 뒷모습 전신.
세 칸 모두 얼굴·머리·옷·소품이 완전히 같아야 하고, 정면 칸은 얼굴이 또렷하게 보이게. 한국 사람이다.
이 사람(${k.id.replace(/^@/, '')})은 앞으로 드라마 장면에 계속 나온다.

${k.prompt}${k.look ? '\n(' + k.look + ')' : ''}`;
  return `사진처럼 사실적인 장소 사진 1장을 그려 줘. 세로 9:16, 사람 없이, 글자·로고 없이. 한국의 장소다.
앞으로 드라마 장면의 배경(${k.id.replace(/^@/, '')})으로 계속 쓴다.

${k.prompt}`;
}
function cutReq(c) {
  const cards = Object.fromEntries(P.cards.map(k => [k.id, k])), who = (c.refs || []).map(r => cards[r]).filter(Boolean);
  const said = c.lines.map(l => `${l.who}: "${l.text}"`).join(' / '), names = who.filter(k => k.type === '인물').map(k => k.id.replace(/^@/, ''));
  return [`드라마 컷 ${c.n}의 장면 사진 1장을 그려 줘. 세로 9:16, 사진처럼 사실적인 영화 한 장면(콜라주 금지), 글자·로고 없이. 등장인물은 한국 사람, 배경은 한국.`,
    `※ 이 대화에 앞에서 만든 인물·장소 사진(${(c.refs || []).map(r => r.replace(/^@/, '')).join(', ') || '없음'})이 있으면 그 얼굴·옷·장소를 똑같이 유지해 줘. 없으면 먼저 그 사진들을 첨부해 줘.`, '',
    `장면: ${[c.note, ...c.action].filter(Boolean).join(' ')}`,
    said ? `이 장면의 대사(입 모양·표정 참고): ${said}` : '',
    names.length ? `화면에 반드시 나오는 사람: ${names.join(', ')} (한 명도 빠뜨리지 마)` : '',
    '등장 카드:', ...who.map(k => `- ${k.id.replace(/^@/, '')}: ${k.prompt}`),
    '**이 사진은 영상의 첫 장면이다. 위 동작이 시작되기 "바로 직전" 순간을 그려 줘. 동작의 중간이나 끝을 그리지 마.**',
    '인물들이 화면 안에 다 보이고, 말하는 사람과 듣는 사람의 얼굴이 잘 보이게.'].filter(x => x !== '').join('\n');
}
const josa = (w, a, b) => { const ch = (w || ' ').slice(-1), k = ch.charCodeAt(0) - 0xAC00; return w + (k >= 0 && k < 11172 && k % 28 ? a : b); };
function flowModel(c) { return c.lines.length ? ['Omni 1.2 Flash', 24, '대사 있음'] : ['Veo 3.1 - Lite', 10, '대사 없음']; }
function flowReq(c) {
  const cards = Object.fromEntries(P.cards.map(k => [k.id.replace(/^@/, ''), k]));
  const whoTxt = n => cards[n] && cards[n].look ? `${n}(${cards[n].look})` : n;
  const people = P.cards.filter(k => k.type === '인물' && (c.refs || []).includes(k.id)).map(k => k.id.replace(/^@/, ''));
  const speakers = []; for (const l of c.lines) if (!speakers.includes(l.who)) speakers.push(l.who);
  for (const w of speakers) if (!people.includes(w)) people.push(w);
  const place = (P.cards.find(k => k.type === '배경' && (c.refs || []).includes(k.id)) || { id: '' }).id.replace(/^@/, '');
  const out = ['세로 9:16 한국 드라마 한 장면. 첨부한 사진에서 그대로 시작하는 8초짜리 한 컷이다.',
    '모든 사람의 얼굴, 머리, 옷, 서 있는 자리는 사진과 똑같이 유지한다. 등장인물은 모두 한국 사람이고 배경은 한국이다. 카메라는 움직이지 않는다.', '',
    people.length ? `등장인물: ${people.map(whoTxt).join(', ')}` : '등장인물: 사진 속 사람들',
    `동작: ${place ? place + '. ' : ''}사진 속 순간에서 그대로 이어서 시작한다(사진에 없는 물건이 갑자기 나타나지 않는다). ${[c.note, ...c.action].filter(Boolean).join(' ')}`, ''];
  let t = 1;
  if (c.lines.length) {
    out.push('대사:');
    for (const l of c.lines) {
      let v = (cards[l.who] || {}).voice || '자연스러운'; if (!/목소리$/.test(v)) v += ' 목소리';
      out.push(`${t.toFixed(0)}초쯤에 ${josa(l.who, '이', '가')} ${v}${l.tone ? ', ' + l.tone : ''}로, 표준 서울말로 또박또박 딱 한 번 말한다.`, `"${l.text}"`);
      t += Math.max(1.4, l.text.length * .18) + .6;
    }
    out.push('');
  }
  for (const x of people.filter(x => !speakers.includes(x))) out.push(`${josa(x, '은', '는')} 한 마디도 하지 않는다. 입을 꼭 다물고 있고, 입술은 끝까지 움직이지 않는다.`);
  if (!speakers.length) out.push('아무도 말하지 않는다. 모든 사람의 입은 끝까지 다물려 있다.');
  out.push('모든 말은 한국어다. 배경음악, 내레이션, 자막, 화면 글자는 넣지 않는다.');
  return out.join('\n');
}

/* ═════════ 화면 그리기: 보드 ═════════ */
function renderPlanSum() {
  const box = $('planSum'); if (!P.cuts.length) { box.style.display = 'none'; return; }
  box.style.display = 'block';
  box.innerHTML = `<h2>✅ ${esc(P.title || '제목 없음')}</h2><p class="hint">${esc(P.summary)}</p>
    <div>${P.cards.map(k => `<span class="tag">${k.type === '인물' ? '👤' : '🏠'} ${esc(k.id.replace(/^@/, ''))}${k.look ? ' · ' + esc(k.look) : ''}</span>`).join('')}</div>
    <p class="hint">컷 ${P.cuts.length}개 · 대사 ${P.cuts.reduce((a, c) => a + c.lines.length, 0)}줄 · ★ 반전 컷 ${P.cuts.filter(c => c.gate).map(c => c.n).join(', ') || '없음'}</p>`;
}
async function renderImg() {
  const cu = await Promise.all(P.cards.map(k => fileUrl('dc:' + k.id)));
  $('cardsBox').innerHTML = P.cards.map((k, i) => `<div class="row ${k.img ? 'ok' : ''}"><div class="pic ${k.type === '인물' ? 'wide' : ''}">${cu[i] ? `<img src="${cu[i]}">` : '그림 없음'}</div>
    <div><h4>${k.type === '인물' ? '👤' : '🏠'} ${esc(k.id.replace(/^@/, ''))} ${k.img ? '<span class="tag g">✓</span>' : ''}</h4><div class="t">${esc(k.look || k.prompt).slice(0, 80)}</div>
    <div class="b"><button data-ck="${i}" class="${!k.img && i === P.cards.findIndex(x => !x.img) ? 'y' : ''}">📋 요청문 복사</button><button data-ci="${i}">🖼 그림 넣기</button></div></div></div>`).join('') || '<div class="empty">① 기획에서 대본을 먼저 넣어 주세요</div>';
  const allCards = P.cards.every(k => k.img), firstCut = P.cuts.findIndex(c => !c.img);
  const iu = await Promise.all(P.cuts.map(c => fileUrl('di:' + c.n)));
  $('cutsImg').innerHTML = P.cuts.map((c, i) => `<div class="row ${c.img ? 'ok' : ''}"><div class="pic">${iu[i] ? `<img src="${iu[i]}">` : '그림 없음'}</div>
    <div><h4>컷 ${c.n} ${c.gate ? '<span class="tag r">★ 반전</span>' : ''}${c.img ? '<span class="tag g">✓</span>' : ''}</h4><div class="t">${esc([c.note, ...c.action].join(' ')).slice(0, 90)}${c.lines.length ? '<br>💬 ' + esc(c.lines.map(l => l.who + ': ' + l.text).join(' / ')).slice(0, 80) : ''}</div>
    <div class="b"><button data-cq="${i}" class="${allCards && i === firstCut ? 'y' : ''}">📋 요청문 복사</button><button data-cu="${i}">🖼 그림 넣기</button></div></div></div>`).join('');
}
async function renderVid() {
  const first = P.cuts.findIndex(c => c.img && !c.vid);
  const parts = await Promise.all(P.cuts.map(c => c.vid ? fileUrl('dv:' + c.n) : fileUrl('di:' + c.n)));
  $('cutsVid').innerHTML = P.cuts.map((c, i) => { const [m, cr, why] = flowModel(c);
    return `<div class="row ${c.vid ? 'ok' : ''}"><div class="pic">${parts[i] ? (c.vid ? `<video src="${parts[i]}" muted playsinline preload="metadata"></video>` : `<img src="${parts[i]}">`) : '그림 없음'}</div>
    <div><h4>컷 ${c.n} ${c.vid ? '<span class="tag g">🎬 영상 ✓</span>' : ''}</h4><div class="t"><span class="tag">${m} · ${cr}크레딧</span> ${why}</div>
    <div class="b"><button data-vs="${i}" class="${i === first ? 'y' : ''}" ${c.img ? '' : 'disabled'}>${c.vid ? '🎬 영상 바꾸기' : c.img ? '✨ 영상 만들기 (Flow)' : '먼저 ② 그림을 넣으세요'}</button></div></div></div>`; }).join('') || '<div class="empty">① 기획에서 대본을 먼저 넣어 주세요</div>';
}
function renderCap() {
  if (document.activeElement && document.activeElement.closest && document.activeElement.closest('#capList')) return;
  $('capList').innerHTML = P.cuts.map((c, i) => `<div class="capcut"><h4>컷 ${c.n}</h4>
    ${c.lines.map((l, j) => `<div class="who">💬 ${esc(l.who)}</div><input type="text" data-l="${i}:${j}" value="${esc(l.text)}">`).join('')}
    ${c.narr.map((t, j) => `<div class="who">📝 내레이션</div><input type="text" data-n="${i}:${j}" value="${esc(t)}">`).join('')}
    ${!c.lines.length && !c.narr.length ? '<div class="hint">글 없음</div>' : ''}</div>`).join('');
}

/* ═════════ ③ Flow 창 ═════════ */
let SH = -1, SHURL = '';
async function openSheet(i) {
  SH = i; const c = P.cuts[i]; if (!c) return;
  const [m, cr, why] = flowModel(c);
  $('sTitle').textContent = `✨ 컷 ${c.n} 영상 만들기`;
  $('sHint').innerHTML = `이 컷은 <b>${why}</b> → Flow 모델 <b>${m}</b> (${cr}크레딧) · 세로 9:16 · 8초. <b>노란 버튼을 차례로</b> 누르세요.`;
  if (SHURL) { URL.revokeObjectURL(SHURL); SHURL = ''; }
  const box = $('sImg'), vb = c.vid ? await fGet('dv:' + c.n) : null, el = document.createElement(vb ? 'video' : 'img'); el.id = 'sImg';
  if (vb) { SHURL = URL.createObjectURL(vb); el.src = SHURL; el.controls = true; el.playsInline = true; } else el.src = await fileUrl('di:' + c.n);
  box.replaceWith(el); $('sheet').style.display = 'flex'; sheetRender();
}
function sheetRender() {
  const c = P.cuts[SH]; if (!c) return; const st = c.vid ? 9 : (c.vstep || 0);
  $('sheet').querySelectorAll('[data-s]').forEach(b => b.classList.toggle('y', String(st) === b.dataset.s));
  $('sheet').querySelector('[data-s="3"]').textContent = c.vid ? '④ 다른 영상으로 바꾸기' : '④ 받은 영상 넣기';
  $('sDel').style.display = c.vid ? 'block' : 'none';
}
function closeSheet() { $('sheet').style.display = 'none'; const v = $('sImg'); if (v.tagName === 'VIDEO') v.pause(); if (SHURL) { URL.revokeObjectURL(SHURL); SHURL = ''; } SH = -1; render(); }
async function sheetAct(k) {
  const c = P.cuts[SH]; if (!c) return;
  if (k === 'close') return closeSheet();
  if (k === '0') { const b = await fGet('di:' + c.n); const u = URL.createObjectURL(b), a = document.createElement('a'); a.href = u; a.download = `drama_cut${c.n}.jpg`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 4000); toast('📷 그림을 「다운로드」에 저장했어요', 3000); c.vstep = 1; }
  if (k === '1') { if (await copyText(flowReq(c))) { toast('📋 Flow 프롬프트를 복사했어요', 3000); c.vstep = 2; } else toast('복사가 안 됐어요. 다시 눌러 주세요'); }
  if (k === '2') { window.open(FLOW_URL, '_blank'); c.vstep = 3; }
  if (k === '3') { const f = await pickFile('video/*,.mp4'); if (!f) return; const d = await mediaDur(f); if (!d) { toast('이 영상은 읽을 수 없어요 (MP4)'); return; } await fSet('dv:' + c.n, f); dropUrl('dv:' + c.n); c.vid = { dur: d }; save(); toast(`🎬 컷 ${c.n}에 영상을 넣었어요`); return openSheet(SH); }
  if (k === 'del') { if (!confirm('넣은 영상을 빼고 그림으로 되돌릴까요?')) return; await fDel('dv:' + c.n); dropUrl('dv:' + c.n); c.vid = null; c.vstep = 0; save(); return openSheet(SH); }
  save(); sheetRender();
}

/* ═════════ 시간표 ═════════ */
function lineTimes(c) { let t = 1; return c.lines.map(l => { const d = Math.max(1.4, l.text.length * .18) + .6, r = { s: t - .1, d: d }; t += d; return r; }); }
function segments() {
  const segs = []; let t = 0;
  P.cuts.forEach((c, i) => {
    if (!c.img && !c.vid) return;
    if (P.fx.gate && c.gate && segs.length) { segs.push({ kind: 'gate', s: t, d: GATE_SEC }); t += GATE_SEC; }
    const d = c.vid ? (c.vid.dur || 8) : (c.sec || 8);
    segs.push({ kind: c.vid ? 'vid' : 'img', ci: i, s: t, d }); t += d;
  });
  return { segs, total: t };
}
function transFor(k) { const ALL = Object.keys(FX.TRANS).filter(x => !['cut', 'glitch', 'rgb', 'pixel'].includes(x)); return P.fx.mix ? ALL[(k * 7 + 3) % ALL.length] : (P.fx.tr || 'fade'); }

/* ═════════ 그리기 ═════════ */
const colF = () => (FX.FILTERS[P.fx.color] || ['', ''])[1];
function drawFit(x, src, W, H) {   // 9:16에 가까우면 꽉 채우고, 아니면 흐린 배경 + 가운데
  const iw = src.videoWidth || src.width, ih = src.videoHeight || src.height, ra = (iw / ih) / (W / H);
  x.filter = colF() || 'none';
  if (ra > .85 && ra < 1.18) { const s = Math.max(W / iw, H / ih); x.drawImage(src, (W - iw * s) / 2, (H - ih * s) / 2, iw * s, ih * s); x.filter = 'none'; return; }
  const cs = Math.max(W / iw, H / ih) * 1.1; x.filter = (colF() ? colF() + ' ' : '') + `blur(${Math.round(W / 24)}px) brightness(.5)`;
  x.drawImage(src, (W - iw * cs) / 2, (H - ih * cs) / 2, iw * cs, ih * cs);
  x.filter = colF() || 'none'; const s = Math.min(W / iw, H / ih); x.drawImage(src, (W - iw * s) / 2, (H - ih * s) / 2, iw * s, ih * s); x.filter = 'none';
}
function seek(v, t) {
  if (Math.abs(v.currentTime - t) < .001 && v.readyState >= 2) return Promise.resolve();
  return new Promise(res => { const to = setTimeout(done, 2500); function done() { clearTimeout(to); v.removeEventListener('seeked', done); res(); } v.addEventListener('seeked', done); v.currentTime = t; });
}
function freeE(e) { if (!e) return; if (e.c) e.c.width = e.c.height = 0; if (e.v) { e.v.removeAttribute('src'); e.v.load(); URL.revokeObjectURL(e.url); } }
async function ensure(C, si) {
  const sg = C.segs[si]; if (!sg || sg.kind === 'gate') return null;
  if (!C.cache.has(si)) {
    const c = P.cuts[sg.ci]; let e;
    if (sg.kind === 'vid') {
      const b = await fGet('dv:' + c.n), url = URL.createObjectURL(b), v = document.createElement('video'); v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
      await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = () => rej(new Error(`컷 ${c.n}의 영상을 읽을 수 없어요. 영상을 다시 넣어 주세요.`)); });
      e = { v, url, t: -1 };
    } else {
      const bmp = await createImageBitmap(await fGet('di:' + c.n)), cv = document.createElement('canvas'); cv.width = C.W; cv.height = C.H;
      drawFit(cv.getContext('2d', { alpha: false }), bmp, C.W, C.H); bmp.close && bmp.close(); e = { c: cv };
    }
    C.cache.set(si, e);
  }
  for (const k of [...C.cache.keys()]) if (k < si - 1 || k > si + 1) { freeE(C.cache.get(k)); C.cache.delete(k); }
  return C.cache.get(si);
}
/** 바탕(자막 없는 화면)을 BASE에 그리기 */
async function drawBase(C, si, t) {
  const sg = C.segs[si], x = C.BX, W = C.W, H = C.H, loc = t - sg.s;
  if (sg.kind === 'gate') {   // 👆 화면 두 번 톡톡: 앞 장면 흑백 정지
    x.save(); x.filter = 'grayscale(1) brightness(.55)'; x.drawImage(C.LAST, 0, 0); x.restore();
    return;
  }
  const e = await ensure(C, si);
  if (si + 1 < C.segs.length) ensure(C, si + 1).catch(() => {});
  if (e.v) { const vt = clamp(loc, 0, Math.max(0, (e.v.duration || sg.d) - .04)); if (Math.abs(e.t - vt) > .001) { await seek(e.v, vt); e.t = vt; } x.fillStyle = '#000'; x.fillRect(0, 0, W, H); drawFit(x, e.v, W, H); }
  else if (P.fx.zoom) { const s = 1 + .07 * clamp(loc / sg.d, 0, 1); x.drawImage(e.c, W * (1 - s) / 2, H * (1 - s) / 2, W * s, H * s); }
  else x.drawImage(e.c, 0, 0);
}
function drawTop(C, x, si, t, total) {
  const sg = C.segs[si], W = C.W, H = C.H, loc = t - sg.s;
  // 컷 바뀜 효과 (앞 컷 마지막 장면 → 이번 컷)
  const td = { fast: .4, normal: .8, slow: 1.3 }[P.fx.speed] || .4, k = C.segs.slice(0, si).filter(s => s.kind !== 'gate').length;
  if (si > 0 && sg.kind !== 'gate' && C.segs[si - 1].kind !== 'gate' && loc < td && transFor(k) !== 'cut') FX.transition(x, W, H, transFor(k), C.LAST, C.BASE, clamp(loc / td, 0, 1));
  else x.drawImage(C.BASE, 0, 0);
  if (P.fx.efx) FX.overlay(x, W, H, { k: P.fx.efx, start: 0, dur: total }, t);
  if (sg.kind === 'gate') {
    FX.drawCaption(x, W, H, { t: '결말이 궁금하면\n화면 두 번 톡톡! 👆👆', st: 'variety', start: sg.s, dur: sg.d + .5, y: .48, size: 1 }, t);
    return;
  }
  const c = P.cuts[sg.ci];
  if (P.hook && P.hook.trim() && si === 0) FX.drawCaption(x, W, H, { t: P.hook, st: 'variety', start: .2, dur: 2.6, y: .22, size: 1.1 }, t);
  if (P.cap.line) lineTimes(c).forEach((r, j) => { const s = sg.s + r.s; if (t >= s && t < s + r.d && s < sg.s + sg.d) FX.drawCaption(x, W, H, { t: c.lines[j].text, st: P.cap.st, start: s, dur: Math.min(r.d, sg.s + sg.d - s), y: .6, size: .85 }, t); });
  if (P.cap.narr && c.narr.length) {
    const lt = lineTimes(c), end = lt.length ? lt[lt.length - 1].s + lt[lt.length - 1].d : 0, txt = c.narr.join(' ');
    let s = lt.length ? end : .3; if (sg.d - s < 1.5) s = .2;
    const d = lt.length && s === .2 ? .75 : Math.min(sg.d - s, Math.max(2.5, txt.length * .2));
    FX.drawCaption(x, W, H, { t: txt, st: 'box', start: sg.s + s, dur: d, y: .3, size: .72 }, t);
  }
}

/* ═════════ 소리 ═════════ */
async function decodeAudio(blob) {
  const OAC = g.OfflineAudioContext || g.webkitOfflineAudioContext, ab = await blob.arrayBuffer();
  return new Promise(res => { const c = new OAC(2, 44100, 44100); const q = c.decodeAudioData(ab, res, () => res(null)); if (q && q.then) q.then(res, () => res(null)); });
}
async function mixAudio(segs, total, SR) {
  const OAC = g.OfflineAudioContext || g.webkitOfflineAudioContext, oc = new OAC(2, Math.ceil(total * SR), SR), out = oc.createGain(); out.connect(oc.destination);
  let any = false;
  for (const sg of segs) {
    if (sg.kind !== 'vid') continue;
    const buf = await decodeAudio(await fGet('dv:' + P.cuts[sg.ci].n)); if (!buf) continue;
    const s = oc.createBufferSource(); s.buffer = buf; s.connect(out); s.start(sg.s, 0, Math.min(sg.d, buf.duration)); any = true;
  }
  if (P.bgm) {
    const bb = await fGet('dbgm'), dec = bb ? await decodeAudio(bb) : null;
    if (dec) { const gn = oc.createGain(); gn.connect(out); const v = P.bgmVol; gn.gain.setValueAtTime(v, 0); gn.gain.setValueAtTime(v, Math.max(0, total - 2.5)); gn.gain.linearRampToValueAtTime(0, total);
      for (let at = 0; at < total; at += dec.duration) { const s = oc.createBufferSource(); s.buffer = dec; s.connect(gn); s.start(at); if (dec.duration < 1) break; } any = true; }
  }
  if (!any) return null;
  if (P.fx.fadein) { out.gain.setValueAtTime(0, 0); out.gain.linearRampToValueAtTime(1, Math.min(.8, total / 4)); }
  return new Promise((res, rej) => { oc.oncomplete = e => res(e.renderedBuffer); const q = oc.startRendering(); if (q && q.then) q.then(res, rej); });
}

/* ═════════ MP4 ═════════ */
async function pickV(W, H, fps) {
  const list = Math.min(W, H) >= 1080 ? ['avc1.640028', 'avc1.4d0028', 'avc1.42e028', 'avc1.640032'] : ['avc1.64001f', 'avc1.4d001f', 'avc1.42e01f', 'avc1.640028'];
  for (const codec of list) { const cfg = { codec, width: W, height: H, bitrate: Math.min(W, H) >= 1080 ? 9e6 : 5e6, framerate: fps, avc: { format: 'avc' } }; try { if ((await VideoEncoder.isConfigSupported(cfg)).supported) return cfg; } catch (e) { /* 다음 */ } }
  return null;
}
async function pickA(sr) {
  if (typeof AudioEncoder === 'undefined') return null;
  for (const c of [{ codec: 'mp4a.40.2', mux: 'aac', b: 192000 }, { codec: 'opus', mux: 'opus', b: 160000 }]) { const cfg = { codec: c.codec, sampleRate: sr, numberOfChannels: 2, bitrate: c.b }; try { if ((await AudioEncoder.isConfigSupported(cfg)).supported) return { cfg, mux: c.mux }; } catch (e) { /* 다음 */ } }
  return null;
}
let RESULT = null, BUSY = false;
async function exportMp4(onProg) {
  if (typeof VideoEncoder === 'undefined') throw new Error('이 브라우저는 영상 만들기를 지원하지 않아요. 크롬으로 열어 주세요.');
  const miss = P.cuts.filter(c => !c.img && !c.vid).map(c => c.n);
  if (miss.length === P.cuts.length) throw new Error('② 그림을 먼저 넣어 주세요.');
  const { segs, total } = segments(), s = P.q >= 1080 ? 1080 : 720, W = s, H = Math.round(s * 16 / 9 / 2) * 2, fps = 30, SR = 48000;
  const vcfg = await pickV(W, H, fps); if (!vcfg) throw new Error(`이 휴대폰은 ${W}x${H} 영상을 못 만들어요. 「보통 720」으로 바꿔 보세요.`);
  try { await Promise.all(['900 60px "Black Han Sans"', '900 60px "Noto Sans KR"', '900 60px "Jua"'].map(f => document.fonts.load(f, '가나다' + (P.hook || '')))); } catch (e) { /* 기본 글꼴 */ }
  onProg(0, '🎵 소리 합치는 중…');
  const ab = await mixAudio(segs, total, SR), acfg = ab ? await pickA(SR) : null;
  const mux = new g.Mp4Muxer({ video: { width: W, height: H }, audio: acfg ? { codec: acfg.mux, sampleRate: SR, numberOfChannels: 2, bitrate: acfg.cfg.bitrate } : undefined });
  let err = null;
  if (acfg) {
    const ae = new AudioEncoder({ output: (c, m) => mux.addAudioChunk(c, m), error: e => { err = e; } }); ae.configure(acfg.cfg);
    const L = ab.getChannelData(0), R = ab.numberOfChannels > 1 ? ab.getChannelData(1) : L, N = ab.length, B = 4800;
    for (let i = 0; i < N; i += B) { const n = Math.min(B, N - i), d = new Float32Array(n * 2); d.set(L.subarray(i, i + n), 0); d.set(R.subarray(i, i + n), n); const a = new AudioData({ format: 'f32-planar', sampleRate: SR, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round(i * 1e6 / SR), data: d }); ae.encode(a); a.close(); if (ae.encodeQueueSize > 16) await sleep(1); if (err) throw err; }
    await ae.flush(); ae.close(); if (err) throw err;
  }
  const mk = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; };
  const C = { W, H, segs, cache: new Map(), BASE: mk(), LAST: mk() }; C.BX = C.BASE.getContext('2d', { alpha: false });
  const cv = mk(), x = cv.getContext('2d', { alpha: false }); x.imageSmoothingQuality = 'high';
  const ve = new VideoEncoder({ output: (c, m) => mux.addVideoChunk(c, m), error: e => { err = e; } }); ve.configure(vcfg);
  const nF = Math.max(1, Math.round(total * fps)), fd = Math.round(1e6 / fps), t0 = performance.now();
  let lastSi = -1;
  try {
    for (let f = 0; f < nF; f++) {
      if (err) throw err;
      const t = f / fps; let si = segs.findIndex(sg => t >= sg.s && t < sg.s + sg.d); if (si < 0) si = segs.length - 1;
      if (si !== lastSi) { if (lastSi >= 0 && segs[si].kind !== 'gate' || lastSi >= 0 && segs[lastSi].kind !== 'gate') C.LAST.getContext('2d').drawImage(C.BASE, 0, 0); lastSi = si; }
      await drawBase(C, si, t);
      drawTop(C, x, si, t, total);
      let dark = 0; if (P.fx.fadein && t < .8) dark = 1 - t / .8; if (P.fx.fadeout && t > total - 1.5) dark = Math.max(dark, (t - (total - 1.5)) / 1.5);
      if (dark > 0) { x.save(); x.globalAlpha = clamp(dark, 0, 1); x.fillStyle = '#000'; x.fillRect(0, 0, W, H); x.restore(); }
      const vf = new VideoFrame(cv, { timestamp: Math.round(f * 1e6 / fps), duration: fd }); ve.encode(vf, { keyFrame: f % (fps * 2) === 0 }); vf.close();
      while (ve.encodeQueueSize > 6) await sleep(2);
      if (f % 6 === 0 || f === nF - 1) { const el = (performance.now() - t0) / 1000, dn = (f + 1) / nF; onProg(dn, `🎬 ${Math.round(dn * 100)}% · 남은 시간 약 ${fmt(el / dn - el)}`); await sleep(0); }
    }
    await ve.flush(); if (err) throw err;
  } finally { try { ve.close(); } catch (e) { /* 닫힘 */ } C.cache.forEach(freeE); for (const c of [cv, C.BASE, C.LAST]) c.width = c.height = 0; }
  return { blob: new Blob(mux.finalize(), { type: 'video/mp4' }), W, H, dur: total, noSound: !acfg, miss };
}
async function make() {
  if (BUSY) return; BUSY = true; $('make').disabled = true; $('make').textContent = '⏳ 만드는 중… 화면을 켜 두세요';
  let lock = null; try { lock = await navigator.wakeLock.request('screen'); } catch (e) { /* 없음 */ }
  try {
    const r = await exportMp4((d, m) => { $('bar').style.width = Math.round(d * 100) + '%'; $('prog').textContent = m; });
    if (RESULT) URL.revokeObjectURL(RESULT.url); RESULT = { ...r, url: URL.createObjectURL(r.blob) };
    $('out').src = RESULT.url; $('out').style.display = 'block';
    $('prog').textContent = `✅ 다 만들었어요! ${r.W}×${r.H} · ${fmt(r.dur)} · ${(r.blob.size / 1048576).toFixed(1)}MB` + (r.miss.length ? ` · ⚠ 그림 없는 컷 ${r.miss.join(', ')}은 빠졌어요` : '') + (r.noSound ? ' · 소리 없음' : '');
  } catch (e) { $('prog').textContent = '❌ ' + (e && e.message || e); $('bar').style.width = '0'; }
  finally { BUSY = false; $('make').disabled = false; $('make').textContent = RESULT ? '🔁 다시 만들기' : '🎞 완성본 만들기'; try { lock && lock.release(); } catch (e) { /* 무시 */ } render(); }
}
const fname = () => { const d = new Date(), z = n => String(n).padStart(2, '0'); return `드라마_${(P.title || '').replace(/[\\/:*?"<>|]/g, '').slice(0, 20) || '작품'}_${z(d.getMonth() + 1)}${z(d.getDate())}${z(d.getHours())}${z(d.getMinutes())}.mp4`; };
function saveFile() { if (!RESULT) return; const a = document.createElement('a'); a.href = RESULT.url; a.download = fname(); document.body.appendChild(a); a.click(); a.remove(); toast('💾 「다운로드」 폴더에 저장했어요', 3500); }
const KAKAO_HELP = '카톡에서 보내는 법: 「💾 휴대폰에 저장」 → 카톡 채팅방 → ＋ → 앨범(또는 파일) → 저장한 영상 고르기';
async function share() {
  if (!RESULT) return; const f = new File([RESULT.blob], 'drama_' + Date.now() + '.mp4', { type: 'video/mp4' });
  if (!navigator.share || !(navigator.canShare && navigator.canShare({ files: [f] }))) { alert('이 휴대폰은 바로 보내기가 안 돼요.\n\n' + KAKAO_HELP); return; }
  try { await navigator.share({ files: [f] }); } catch (e) { if (e && e.name !== 'AbortError') alert('바로 보내기가 안 됐어요 (' + e.name + ').\n\n' + KAKAO_HELP); }
}

/* ═════════ 단계 · 노란 버튼 ═════════ */
const TABS = ['plan', 'img', 'vid', 'cap', 'fx', 'make'];
let TAB = 'plan';
function show(t) { TAB = t; P.seen[t] = 1; save(); render(); scrollTo(0, 0); }
function setOn(id, v) { $(id).querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === String(v))); }
function chips(id, obj, onPick) { const el = $(id); el.innerHTML = Object.entries(obj).map(([k, v]) => `<button data-v="${k}">${v}</button>`).join(''); el.onclick = e => { const b = e.target.closest('button'); if (!b) return; onPick(b.dataset.v); save(); render(); }; }
function nowText() {
  const N = P.cuts.length, ci = P.cards.filter(k => !k.img).length, cu = P.cuts.filter(c => !c.img).length, vd = P.cuts.filter(c => c.vid).length;
  return {
    plan: !N ? (P.copied ? (P.answer.trim() ? '👉 노란 「✅ ④ 대본 넣기」를 누르세요.' : '👉 AI에 붙여 넣고 보낸 뒤, AI 답의 「복사」 → ③ 칸에 붙여 넣으세요.') : '👉 지금 할 일: 주제를 쓰고 노란 「📋 ① 대본 요청문 복사」를 누르세요.') : `✅ 대본이 들어갔어요(컷 ${N}개). 아래 노란 「다음 ▶」을 누르세요.`,
    img: !N ? '먼저 ① 기획에서 대본을 넣어 주세요.' : ci ? `👉 인물·장소 그림 ${ci}개가 남았어요. 노란 「📋 요청문 복사」부터 차례로.` : cu ? `👉 컷 장면 그림 ${cu}개가 남았어요. 노란 「📋 요청문 복사」부터 차례로.` : '✅ 그림이 다 들어갔어요. 「다음 ▶」을 누르세요.',
    vid: !N ? '먼저 ① 기획에서 대본을 넣어 주세요.' : `🎬 영상 ${vd} / ${N}컷. 노란 「✨ 영상 만들기」를 차례로 누르세요. 다 못 해도 「다음 ▶」으로 넘어가도 돼요(그림으로 들어가요).`,
    cap: '👉 첫 2초 큰 글씨와 자막을 확인하세요. 다 되면 「다음 ▶」.',
    fx: '👉 마음에 드는 효과를 고르세요. 그대로 둬도 괜찮아요. 다 되면 「다음 ▶」.',
    make: RESULT ? '✅ 완성! 노란 「💾 휴대폰에 저장」을 누르세요.' : '👉 지금 할 일: 노란 「🎞 완성본 만들기」를 누르세요.',
  }[TAB];
}
function render() {
  TABS.forEach(t => $('t-' + t).classList.toggle('on', t === TAB));
  const N = P.cuts.length, done = { plan: N > 0, img: N > 0 && P.cuts.every(c => c.img) && P.cards.every(k => k.img), vid: N > 0 && P.cuts.every(c => c.vid), cap: !!P.seen.cap && TAB !== 'cap', fx: !!P.seen.fx && TAB !== 'fx', make: !!RESULT };
  $('nav').querySelectorAll('button').forEach(b => { b.classList.toggle('on', b.dataset.t === TAB); b.classList.toggle('done', !!done[b.dataset.t]); });
  if (!BUSY) $('now').textContent = nowText();
  if (P.title) $('pname').textContent = '🎭 ' + P.title;
  // ① 기획
  if (document.activeElement !== $('topic')) $('topic').value = P.topic;
  if (document.activeElement !== $('answer')) $('answer').value = P.answer;
  setOn('ai', P.ai); $('openAI').textContent = `🤖 ② ${AI[P.ai][0]} 열기 (붙여 넣고 보내기)`;
  $('copyPlan').classList.toggle('y', TAB === 'plan' && !N && !P.copied);
  $('openAI').classList.toggle('y', TAB === 'plan' && !N && !!P.copied && !P.opened && !P.answer.trim());
  $('apply').classList.toggle('y', TAB === 'plan' && !N && !!P.answer.trim());
  renderPlanSum();
  if (TAB === 'img') renderImg();
  if (TAB === 'vid') renderVid();
  if (TAB === 'cap') renderCap();
  if (document.activeElement !== $('hook')) $('hook').value = P.hook;
  $('capLine').checked = !!P.cap.line; $('capNarr').checked = !!P.cap.narr; setOn('capSt', P.cap.st);
  // ⑤ 효과
  setOn('trans', P.fx.mix ? '' : P.fx.tr); $('mixBtn').classList.toggle('on', !!P.fx.mix);
  $('mixBtn').textContent = P.fx.mix ? '🎲 골고루 섞기 ✓ 켜짐 (누르면 끄기)' : '🎲 골고루 섞기 (꺼짐 · 누르면 켜기)';
  setOn('speed', P.fx.speed); setOn('color', P.fx.color); setOn('efx', P.fx.efx);
  for (const k of ['gate', 'zoom', 'fadein', 'fadeout']) $(k).checked = !!P.fx[k];
  $('bgmInfo').textContent = P.bgm ? '🎵 ' + P.bgm.name : '배경음악 없음 (영상 속 대사 소리만)';
  $('pickBgm').textContent = P.bgm ? '🎵 다른 음악으로 바꾸기' : '🎵 배경음악 고르기 (MP3)';
  $('bgmVol').value = P.bgmVol; $('bgmV').textContent = Math.round(P.bgmVol * 100) + '%';
  // ⑥ 완성
  setOn('qual', P.q);
  const { total } = segments();
  $('sum').textContent = N ? `컷 ${N}개 (영상 ${P.cuts.filter(c => c.vid).length} · 그림만 ${P.cuts.filter(c => c.img && !c.vid).length}) → 길이 약 ${fmt(total)} · 세로 9:16` : '① 기획부터 해 주세요.';
  $('make').classList.toggle('y', TAB === 'make' && !RESULT && !BUSY); $('save').classList.toggle('y', !!RESULT);
  $('save').style.display = $('share').style.display = RESULT ? 'block' : 'none';
  $('next').parentElement.style.display = TAB === 'make' ? 'none' : '';
  $('next').classList.toggle('y', TAB !== 'plan' || N > 0);
}

async function init() {
  try { const s = await kvGet('drama'); if (s) { P = Object.assign(DEF(), s); P.fx = Object.assign(DEF().fx, s.fx || {}); P.cap = Object.assign(DEF().cap, s.cap || {}); } } catch (e) { toast('저장 공간을 열 수 없어요. 크롬으로 열어 주세요'); }
  // ① 기획
  $('topic').oninput = e => { P.topic = e.target.value; save(); };
  $('answer').oninput = e => { P.answer = e.target.value; save(); render(); };
  $('ai').onclick = e => { const b = e.target.closest('button'); if (!b) return; P.ai = b.dataset.v; save(); render(); };
  $('copyPlan').onclick = async () => { await copyMsg(planRequest(), '대본 요청문'); P.copied = 1; save(); render(); };
  $('copyTopic').onclick = () => copyMsg(topicRequest(), '주제 추천 요청문');
  $('openAI').onclick = () => { window.open(AI[P.ai][1], '_blank'); P.opened = 1; save(); render(); };
  $('copyFix').onclick = () => copyMsg(FIX_REQ, '형식 정리 요청문');
  $('apply').onclick = async () => {
    if (!P.answer.trim()) { toast('AI 답을 먼저 붙여 넣어 주세요'); return; }
    if (P.cuts.length && !confirm('지금 대본을 새 대본으로 바꿀까요?\n(넣어 둔 그림·영상은 컷 번호가 같으면 그대로 남아요)')) return;
    try {
      const r = parsePlan(P.answer); const oldCards = Object.fromEntries(P.cards.map(k => [k.id, k])), oldCuts = Object.fromEntries(P.cuts.map(c => [c.n, c]));
      r.cards.forEach(k => { if (oldCards[k.id] && oldCards[k.id].img) k.img = 1; });
      r.cuts.forEach(c => { const o = oldCuts[c.n]; if (o) { c.img = o.img; c.vid = o.vid; } });
      Object.assign(P, { title: r.title, hook: r.hook || P.hook, summary: r.summary, cards: r.cards, cuts: r.cuts });
      $('copyFix').style.display = 'none'; save(); render(); toast(`✅ 대본을 넣었어요 · 인물·장소 ${r.cards.length} · 컷 ${r.cuts.length}`, 3500);
    } catch (e) { $('copyFix').style.display = 'block'; $('copyFix').classList.add('y'); toast('AI 답에서 컷(【컷 1】)을 찾지 못했어요. 「🧩 형식 정리 요청문」을 같은 AI 창에 보내 주세요', 5000); }
  };
  // ② 그림
  $('openGpt').onclick = () => window.open(AI.chatgpt[1], '_blank');
  $('cardsBox').onclick = async e => { const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.ck != null) copyMsg(cardReq(P.cards[+b.dataset.ck]), `${P.cards[+b.dataset.ck].id.replace(/^@/, '')} 그림 요청문`);
    if (b.dataset.ci != null) { const k = P.cards[+b.dataset.ci]; if (await putImage('dc:' + k.id)) { k.img = 1; save(); render(); toast('🖼 그림을 넣었어요'); } } };
  $('cutsImg').onclick = async e => { const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.cq != null) copyMsg(cutReq(P.cuts[+b.dataset.cq]), `컷 ${P.cuts[+b.dataset.cq].n} 그림 요청문`);
    if (b.dataset.cu != null) { const c = P.cuts[+b.dataset.cu]; if (await putImage('di:' + c.n)) { c.img = 1; save(); render(); toast(`🖼 컷 ${c.n} 그림을 넣었어요`); } } };
  // ③ 영상
  $('cutsVid').onclick = e => { const b = e.target.closest('button'); if (b && b.dataset.vs != null && !b.disabled) openSheet(+b.dataset.vs); };
  $('sheet').onclick = e => { if (e.target.id === 'sheet') return closeSheet(); const b = e.target.closest('[data-s]'); if (b) sheetAct(b.dataset.s); };
  // ④ 자막
  $('hook').oninput = e => { P.hook = e.target.value; save(); };
  $('capLine').onchange = e => { P.cap.line = e.target.checked; save(); };
  $('capNarr').onchange = e => { P.cap.narr = e.target.checked; save(); };
  chips('capSt', { basic: '기본 흰 글씨', box: '반투명 상자', variety: '예능 노랑', cute: '귀여운', cinema: '영화 자막' }, v => { P.cap.st = v; });
  $('capList').oninput = e => { const l = e.target.dataset.l, n = e.target.dataset.n;
    if (l) { const [i, j] = l.split(':').map(Number); P.cuts[i].lines[j].text = e.target.value; }
    if (n) { const [i, j] = n.split(':').map(Number); P.cuts[i].narr[j] = e.target.value; } save(); };
  // ⑤ 효과
  $('mixBtn').onclick = () => { P.fx.mix = P.fx.mix ? '' : 'all'; save(); render(); toast(P.fx.mix ? '🎲 골고루 섞기를 켰어요' : '골고루 섞기를 껐어요'); };
  const TR = {}; ['cut', 'fade', 'black', 'white', 'zoomIn', 'slide', 'push', 'wipe', 'circle', 'blur', 'lightleak', 'flip', 'bolt', 'doors'].forEach(k => { if (FX.TRANS[k]) TR[k] = FX.TRANS[k]; });
  chips('trans', TR, v => { P.fx.tr = v; P.fx.mix = ''; });
  chips('speed', { fast: '빠르게 0.4초', normal: '보통 0.8초', slow: '천천히 1.3초' }, v => { P.fx.speed = v; });
  const COL = {}; Object.entries(FX.FILTERS).forEach(([k, v]) => { COL[k] = v[0]; }); chips('color', COL, v => { P.fx.color = v; });
  const EF = { '': '없음' }; ['vignette', 'grain', 'lightleak', 'bars', 'glow', 'rain', 'snow', 'petal', 'bokeh'].forEach(k => { if (FX.EFX[k]) EF[k] = FX.EFX[k]; }); chips('efx', EF, v => { P.fx.efx = v; });
  for (const k of ['gate', 'zoom', 'fadein', 'fadeout']) $(k).onchange = e => { P.fx[k] = e.target.checked; save(); };
  $('pickBgm').onclick = async () => { const f = await pickFile('audio/*,.mp3,.m4a,.wav'); if (!f) return; await fSet('dbgm', f); P.bgm = { name: f.name }; save(); render(); toast('🎵 배경음악을 넣었어요'); };
  $('bgmVol').oninput = e => { P.bgmVol = +e.target.value; save(); $('bgmV').textContent = Math.round(P.bgmVol * 100) + '%'; };
  // ⑥ 완성
  $('qual').onclick = e => { const b = e.target.closest('button'); if (!b) return; P.q = +b.dataset.v; save(); render(); };
  $('make').onclick = make; $('save').onclick = saveFile; $('share').onclick = share;
  $('reset').onclick = async () => {
    if (!confirm('지금 드라마(대본 · 그림 · 영상)를 모두 비우고 새로 시작할까요?\n완성본은 먼저 휴대폰에 저장해 두세요.')) return;
    for (const k of P.cards) await fDel('dc:' + k.id).catch(() => {});
    for (const c of P.cuts) { await fDel('di:' + c.n).catch(() => {}); await fDel('dv:' + c.n).catch(() => {}); }
    URLS.forEach(u => u && URL.revokeObjectURL(u)); URLS.clear();
    const keep = { ai: P.ai, q: P.q, fx: P.fx, cap: P.cap, bgm: P.bgm, bgmVol: P.bgmVol }; P = Object.assign(DEF(), keep); RESULT = null; $('out').style.display = 'none'; $('prog').textContent = ''; $('bar').style.width = '0';
    save(); show('plan'); toast('🧹 새 드라마를 시작해요');
  };
  // 단계
  $('nav').onclick = e => { const b = e.target.closest('button'); if (b && !BUSY) show(b.dataset.t); };
  $('next').onclick = () => { if (TAB === 'plan' && !P.cuts.length) { toast('먼저 대본을 넣어 주세요'); return; } const i = TABS.indexOf(TAB); if (i < TABS.length - 1) show(TABS[i + 1]); };
  render();
}
g.BKDRAMA_M = { P: () => P, parsePlan, segments, exportMp4, render, cutReq, flowReq, cardReq };
init();
})(window);

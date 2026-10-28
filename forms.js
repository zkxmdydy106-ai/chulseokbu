/* forms.js — 학생 서류(결석신고서·교외체험학습 신청서·대리 인솔 위임장·결과보고서) 공용 규칙과 학교 서식 그리기. */
/* 학생 웹앱(student.html)과 교사 출석부 웹앱(index.html [서류함])이 함께 쓴다. 서식 모양은 school-forms.js(SCHOOL_FORMS). */
/* 이 파일은 아무 데도 보내지 않는다. 학생 자료는 칸 값으로만 다루고, 그림은 data:image(png/jpeg)만 받아 그린다. */
(function (root) {
  'use strict';

  const KIND = { absence: '결석신고서', 'field-apply': '교외체험학습 신청서', 'field-report': '교외체험학습 결과보고서', 'field-proxy': '대리 인솔 위임장' };
  const ATT = ['결석', '지각', '조퇴', '결과'];
  const AKIND = ['질병', '미인정', '기타', '출석인정'];
  const ASUB = ['경조사', '법정감염병', '생리통', '기타'];
  const LEARN = ['가족행사 참여', '주제가 있는 체험학습', '가정학습', '기타 체험활동'];
  const FACE = '본인임을 확인할 수 있게 얼굴이 정면으로 또렷이 나와야 해요(모자·마스크·선글라스·멀리서 찍은 사진 안 됨). 보호자도 함께 나오게 찍어 주세요.';

  /* ── 날짜(칸 값은 'YYYY-MM-DD') ────────────────────────── */
  const pad = (n) => String(n).padStart(2, '0');
  const DAYS = '일월화수목금토';
  function dateOf(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    if (!m) return null;
    const d = new Date(+m[1], +m[2] - 1, +m[3]);
    return d.getMonth() === +m[2] - 1 ? d : null;
  }
  const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = () => isoOf(new Date());
  const addDays = (iso, n) => { const d = dateOf(iso); d.setDate(d.getDate() + n); return isoOf(d); };
  const isWeekend = (iso) => { const d = dateOf(iso); return !!d && (d.getDay() === 0 || d.getDay() === 6); };
  function weekdays(from, to) {
    const a = dateOf(from), b = dateOf(to);
    if (!a || !b || b < a) return [];
    const out = [];
    for (const d = a; d <= b && out.length < 62; d.setDate(d.getDate() + 1)) if (d.getDay() % 6) out.push(isoOf(d));
    return out;
  }
  const nextSchoolDay = (iso) => { let d = addDays(iso, 1); while (isWeekend(d)) d = addDays(d, 1); return d; };
  const dayName = (iso) => DAYS[dateOf(iso).getDay()];
  const md = (iso) => { const d = dateOf(iso); return d ? `${d.getMonth() + 1}월 ${d.getDate()}일` : ''; };
  const short = (iso) => { const d = dateOf(iso); return d ? `${d.getMonth() + 1}/${d.getDate()}` : ''; };
  const range = (from, to) => (!from ? '' : !to || to === from ? short(from) : `${short(from)}~${short(to)}`);
  /* 결석신고서 제출 날짜: 결석이 끝난 다음 날 이후, 학교 나온 날(주말 아님) */
  function submitDateProblem(to, date) {
    if (!dateOf(date)) return '제출 날짜를 골라 주세요.';
    if (dateOf(to) && date <= to) return '제출 날짜는 결석한 다음 날 이후여야 해요(학교에 나온 날).';
    if (isWeekend(date)) return '제출 날짜가 주말이에요. 학교에 나온 날을 골라 주세요.';
    return '';
  }

  /* ── 학생 확인 ─────────────────────────────────────────── */
  const normName = (s) => String(s || '').replace(/\s+/g, '');
  const classParts = (cls) => { const m = /^(\d)-(\d{1,2})$/.exec(String(cls || '')); return m ? { g: +m[1], c: +m[2] } : null; };
  const hakbunOf = (cls, no) => { const p = classParts(cls); return p ? `${p.g}${pad(p.c)}${pad(+no)}` : ''; };
  /* 학번 5자리(10307) 또는 4자리(1307) → 반·번호. 반 QR의 반과 다르면 null */
  function parseHakbun(s, cls) {
    const t = String(s || '').replace(/\D/g, '');
    const p = classParts(cls);
    if (!p) return null;
    let g, c, no;
    if (t.length === 5) [g, c, no] = [+t[0], +t.slice(1, 3), +t.slice(3)];
    else if (t.length === 4) [g, c, no] = [+t[0], +t[1], +t.slice(2)];
    else return null;
    if (g !== p.g || c !== p.c || !no) return null;
    return { no: String(no) };
  }
  /* 반 비밀값 + 번호 + 이름 → 16자리(다리는 이 값만 명단으로 가진다) */
  async function stuHash(k, no, name) {
    const data = new TextEncoder().encode(`${k}|${String(+no)}|${normName(name)}`);
    const buf = await (root.crypto || globalThis.crypto).subtle.digest('SHA-256', data);
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
  }
  const telOk = (s) => /^0\d{1,2}-?\d{3,4}-?\d{4}$/.test(String(s || '').trim());
  const imgOk = (s) => typeof s === 'string' && s.length < 4e6 && /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(s);

  /* ── 서식 안의 칸(경로) ─────────────────────────────────── */
  /* 경로: 맨 위 문단 'p3', 표 't0', 표 칸 문단 't0.r2c1.p0', 칸 안 표 't8.r0c0.t5.r0c0.p0' */
  const FORMS = () => root.SCHOOL_FORMS || {};
  function walk(blocks, prefix, fn) {
    (blocks || []).forEach((b, i) => {
      if (b.t === 'tbl') { const tp = `${prefix}t${i}`; fn(b, tp); b.cells.forEach((c) => walk(c.body, `${tp}.r${c.r}c${c.c}.`, fn)); }
      else fn(b, `${prefix}p${i}`);
    });
  }
  function paths(kind) { const m = {}; walk((FORMS()[kind] || {}).blocks, '', (b, p) => { if (b.t === 'p') m[p] = b.text; }); return m; }
  const origCache = {};
  const orig = (kind, path) => (origCache[kind] || (origCache[kind] = paths(kind)))[path];
  /* 증빙서류 칸: 결석 종류마다 서식 칸(□ 진료확인서 …)에서 이름을 읽는다 */
  const PROOF_CELL = { 질병: 't0.r8c1', 인정결석: 't0.r8c2', 인정: 't0.r8c6', 기타: 't0.r8c10' };
  function proofGroup(f) {
    if (f.kind === '질병') return '질병';
    if (f.kind === '기타') return '기타';
    if (f.kind === '출석인정') return (f.att || '결석') === '결석' ? '인정결석' : '인정';
    return '';
  }
  const proofLabel = (t) => String(t).replace(/^[□▢]\s*/, '').replace(/\(\s*\)\s*$/, '').trim();
  function proofsFor(f) {
    const cell = PROOF_CELL[proofGroup(f)];
    if (!cell) return [];
    return Object.entries(paths('absence')).filter(([p, t]) => p.startsWith(`${cell}.`) && /^[□▢]/.test(t)).map(([, t]) => proofLabel(t));
  }
  const needsGuardianNote = (f) => (f.proofs || []).some((p) => p.startsWith('보호자확인서'));

  /* ── 검사(제출 전) ─────────────────────────────────────── */
  const blank = (v) => !String(v ?? '').trim();
  function problems(doc) {
    const f = doc.f || {}, out = [];
    const need = (k, msg) => { if (blank(k.split('.').reduce((o, x) => (o || {})[x], f))) out.push({ k, msg }); };
    const sig = (k, who) => { if (!imgOk((f.sig || {})[k])) out.push({ k: `sig.${k}`, msg: `${who} 서명을 해 주세요.` }); };
    const days = (from, to) => {
      if (!dateOf(from)) out.push({ k: 'from', msg: '시작 날짜를 골라 주세요.' });
      else if (!dateOf(to)) out.push({ k: 'to', msg: '끝 날짜를 골라 주세요.' });
      else if (to < from) out.push({ k: 'to', msg: '끝 날짜가 시작보다 앞이에요.' });
      else if (!weekdays(from, to).length) out.push({ k: 'from', msg: '기간에 평일이 없어요.' });
    };
    const period = () => {
      if (f.unit === 'half') {
        if (!dateOf(f.halfDate)) out.push({ k: 'halfDate', msg: '반일 체험 날짜를 골라 주세요.' });
        if (!(+f.p1 >= 1 && +f.p2 >= +f.p1 && +f.p2 <= 9)) out.push({ k: 'p1', msg: '몇 교시부터 몇 교시까지인지 적어 주세요.' });
      } else days(f.from, f.to);
    };
    const people = () => {
      need('gName', '보호자 이름을 적어 주세요.'); need('gRel', '보호자 관계를 적어 주세요.');
      if (!telOk(f.gTel)) out.push({ k: 'gTel', msg: '보호자 연락처를 010-0000-0000처럼 적어 주세요.' });
    };
    if (doc.kind === 'absence') {
      if (!ATT.includes(f.att)) out.push({ k: 'att', msg: '결석·지각·조퇴·결과 중 하나를 골라 주세요.' });
      if (!AKIND.includes(f.kind)) out.push({ k: 'kind', msg: '결석 종류를 골라 주세요.' });
      if (f.kind === '출석인정' && !ASUB.includes(f.sub)) out.push({ k: 'sub', msg: '출석인정 세부(경조사·법정감염병·생리통·기타)를 골라 주세요.' });
      if ((f.att || '결석') === '결석') days(f.from, f.to); else if (!dateOf(f.from)) out.push({ k: 'from', msg: '날짜를 골라 주세요.' });
      if (String(f.reason || '').trim().length < 10) out.push({ k: 'reason', msg: '결석 사유를 구체적으로(10자 이상) 써 주세요.' });
      if (proofGroup(f) && !(f.proofs || []).length) out.push({ k: 'proofs', msg: '낼 증빙서류를 골라 주세요.' });
      if ((f.proofs || []).includes('기타') && blank(f.proofEtc)) out.push({ k: 'proofEtc', msg: '기타 증빙서류 이름을 적어 주세요.' });
      if (needsGuardianNote(f) && String(f.guardianNote || '').trim().length < 10) out.push({ k: 'guardianNote', msg: '보호자 확인서를 보호자가 구체적으로(10자 이상) 써 주세요.' });
      const sd = submitDateProblem((f.att || '결석') === '결석' ? f.to : f.from, f.date);
      if (sd) out.push({ k: 'date', msg: sd });
      if (!dateOf(f.cDate) || !/^\d{1,2}:\d{2}$/.test(f.cTime || '')) out.push({ k: 'cDate', msg: '보호자 연락 날짜·시각을 적어 주세요.' });
      need('parentName', '보호자 이름을 적어 주세요.');
      sig('stu', '학생'); sig('par', '보호자');
    }
    if (doc.kind === 'field-apply') {
      period();
      if (!f.checked) out.push({ k: 'checked', msg: '세부 규정·불허 기간을 확인했는지 체크해 주세요.' });
      if (!LEARN.includes(f.form)) out.push({ k: 'form', msg: '학습 형태를 골라 주세요.' });
      need('purpose', '목적을 적어 주세요.'); need('dest', '목적지를 적어 주세요.');
      people();
      if (f.proxy) {
        need('lName', '인솔자 이름을 적어 주세요.'); need('lRel', '인솔자 관계를 적어 주세요.');
        if (!telOk(f.lTel)) out.push({ k: 'lTel', msg: '인솔자 연락처를 010-0000-0000처럼 적어 주세요.' });
        const px = f.px || {};
        if (String(px.reason || '').trim().length < 10) out.push({ k: 'px.reason', msg: '대리 인솔 위임장: 대리 인솔 사유를 구체적으로(10자 이상) 써 주세요.' });
        need('px.lAddr', '대리 인솔 위임장: 인솔자 주소를 적어 주세요.');
        if (!px.agree) out.push({ k: 'px.agree', msg: '대리 인솔 위임장: 인솔자 개인정보 수집·이용 동의가 필요해요.' });
        if (!imgOk(px.sigLead)) out.push({ k: 'px.sigLead', msg: '대리 인솔 위임장: 대리 인솔자 서명을 받아 주세요.' });
      }
      need('plan', '체험학습 계획을 적어 주세요.');
      if (!f.agree) out.push({ k: 'agree', msg: '확인 사항에 동의해 주세요.' });
      if (!dateOf(f.date)) out.push({ k: 'date', msg: '신청 날짜를 골라 주세요.' });
      sig('stu', '학생'); sig('par', '보호자');
    }
    if (doc.kind === 'field-report') {
      period();
      if (!LEARN.includes(f.form)) out.push({ k: 'form', msg: '학습 형태를 골라 주세요.' });
      need('purpose', '목적을 적어 주세요.'); need('dest', '목적지를 적어 주세요.');
      people();
      need('place', '어디에서 했는지(장소) 적어 주세요.');
      const want = f.unit === 'half' ? (dateOf(f.halfDate) ? [f.halfDate] : []) : weekdays(f.from, f.to);
      const got = Object.fromEntries([].concat(f.days || []).map((d) => [d.date, d]));
      for (const d of want) {
        const e = got[d] || {};
        if (String(e.text || '').trim().length < 10) out.push({ k: `day.${d}`, msg: `${md(d)} 체험 내용을 구체적으로(10자 이상) 써 주세요.` });
        if (!imgOk(e.photo)) out.push({ k: `photo.${d}`, msg: `${md(d)} 사진을 한 장 올려 주세요.` });
      }
      if (String(f.feel || '').trim().length < 10) out.push({ k: 'feel', msg: '소감을 10자 이상 써 주세요.' });
      const end = f.unit === 'half' ? f.halfDate : f.to;
      if (!dateOf(f.date)) out.push({ k: 'date', msg: '제출 날짜를 골라 주세요.' });
      else if (dateOf(end) && f.date <= end) out.push({ k: 'date', msg: '제출 날짜는 체험학습이 끝난 다음이어야 해요.' });
      sig('stu', '학생'); sig('par', '보호자');
    }
    return out;
  }

  /* 교사 목록·출결 연결용 요약(이름·사유 없음) */
  function meta(doc) {
    const f = doc.f || {};
    const half = f.unit === 'half' && doc.kind !== 'absence';
    const from = half ? f.halfDate : f.from;
    const to = half ? f.halfDate : (doc.kind === 'absence' && (f.att || '결석') !== '결석') ? f.from : f.to;
    return { from: from || '', to: to || from || '', att: doc.kind === 'absence' ? f.att || '결석' : '결석', n: doc.kind === 'field-report' ? [].concat(f.days || []).filter((d) => imgOk(d.photo)).length : 0, proxy: doc.kind === 'field-apply' && !!f.proxy };
  }
  function summary(doc) {
    const f = doc.f || {}, m = meta(doc);
    if (doc.kind === 'absence') return `${range(m.from, m.to)} ${f.kind || ''}${m.att}`.trim();
    return `${range(m.from, m.to)} ${f.form || '교외체험학습'}${m.proxy ? ' · 대리 인솔' : ''}${doc.kind === 'field-report' ? ` · 사진 ${m.n}장` : ''}`;
  }

  /* ── 학교 서식에 값 채우기 ───────────────────────────────── */
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const textHtml = (s) => esc(s).replace(/\t/g, '    ').replace(/\r?\n/g, '<br>');
  const V = (s) => `<span class="v">${textHtml(s)}</span>`;
  const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  const ON = '<span class="v">■</span>';
  /* 원래 글의 □/▢ 중 label 앞의 것만 ■ */
  function ticks(text, labels) {
    let h = esc(text);
    for (const l of labels) h = h.replace(new RegExp(`[▢□](\\s?${reEsc(esc(l))})`), `${ON}$1`);
    return h;
  }
  const sigImg = (s) => (imgOk(s) ? `<img class="sf-sig" alt="서명" src="${s}">` : '');
  const signLine = (before, name, mark, s) => ({ html: `${esc(before)}${name ? ` ${V(name)} ` : ''}<span class="sf-sign">${esc(mark)}${sigImg(s)}</span>` });
  const dateLine = (iso) => { const d = dateOf(iso); return d ? { html: `${V(d.getFullYear())}년 ${V(d.getMonth() + 1)}월 ${V(d.getDate())}일` } : undefined; };
  const left = (s) => ({ html: V(s), align: 'left' });
  const ymdLong = (iso) => { const d = dateOf(iso); return d ? `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일` : ''; };
  function gcn(cls, no) { const p = classParts(cls) || { g: '', c: '' }; return { g: p.g, c: p.c, no: no || '' }; }
  /* 칸의 빈 줄(쓰는 자리)을 내용 줄 수만큼 뺀다 */
  function dropBlanks(O, kind, cell, from, count) {
    let i = from;
    for (let n = 0; n < count; i++) { const t = orig(kind, `${cell}.p${i}`); if (t === undefined) break; if (!t.trim()) { O[`${cell}.p${i}`] = { skip: true }; n++; } }
  }
  const linesOf = (s, per = 44) => String(s || '').split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(l.length / per)), 0);

  function fillAbsence(doc) {
    const f = doc.f || {}, O = {}, K = 'absence';
    const att = f.att || '결석', n = gcn(doc.cls, doc.no);
    O['t0.r2c1.p0'] = { html: V(doc.name) };
    O['t0.r2c4.p0'] = { html: `( ${V(n.g)} ) 학년  ( ${V(n.c)} ) 반  ( ${V(n.no)} ) 번` };
    O['t0.r3c1.p0'] = left(f.reason);
    if (dateOf(f.from)) {
      const to = att === '결석' && dateOf(f.to) ? f.to : f.from;
      O['t0.r4c1.p0'] = att === '결석'
        ? { html: `${V(ymdLong(f.from))} ${V(dayName(f.from))}요일 ~ ${V(md(to))} ${V(dayName(to))}요일 ( ${V(weekdays(f.from, to).length)} )일간` }
        : { html: `${V(ymdLong(f.from))} ${V(dayName(f.from))}요일 · ${V(att)}${f.when ? ` (${V(f.when)})` : ''}` };
    }
    /* 결석 종류 칸과 담임 확인서의 같은 줄 */
    const kindHtml = (text) => {
      let h = text;
      if (f.kind === '질병') h = att === '결석' ? ticks(h, ['질병결석']) : ticks(h, ['질병결석']).replace('질병결석', `질병${esc(att)}`);
      else if (f.kind === '기타') h = att === '결석' ? ticks(h, ['기타결석']) : ticks(h, ['기타결석']).replace('기타결석', `기타${esc(att)}`);
      else if (f.kind === '출석인정') h = ticks(h, [att === '결석' ? '출석인정결석' : '출석인정 (지각']);
      else h = esc(h);
      if (f.kind === '미인정') h += `  ${ON}${V(`미인정${att}`)}`;
      return { html: h };
    };
    O['t0.r5c1.p0'] = kindHtml(orig(K, 't0.r5c1.p0'));
    if (f.kind === '출석인정' && att !== '결석') O['t0.r6c6.p1'] = { html: ticks(orig(K, 't0.r6c6.p1'), [att]) };
    if (f.kind === '출석인정' && ASUB.includes(f.sub)) {
      const cell = att === '결석' ? 't0.r7c2' : 't0.r7c6';
      for (let i = 0; i < 4; i++) {
        const t = orig(K, `${cell}.p${i}`) || '';
        if (t.replace('￭', '').trim().startsWith(f.sub)) O[`${cell}.p${i}`] = { html: `${ON}<span class="v" style="text-decoration:underline">${esc(t.replace('￭', '').trim())}</span>` };
      }
    }
    const cell = PROOF_CELL[proofGroup(f)];
    if (cell) {
      for (const [p, t] of Object.entries(paths(K))) {
        if (!p.startsWith(`${cell}.`) || !/^[□▢]/.test(t)) continue;
        const lab = proofLabel(t);
        if (!(f.proofs || []).includes(lab)) continue;
        O[p] = lab === '기타' ? { html: `${ON} 기타( ${V(f.proofEtc || '')} )` } : { html: `${ON}${esc(t.slice(1))}` };
      }
    }
    O.p3 = dateLine(f.date);
    O.p4 = signLine('학생  성명:', doc.name, '(서명 또는 인)', (f.sig || {}).stu);
    O.p5 = signLine('보호자(법정대리인) 성명:', f.parentName, '(서명 또는 인)', (f.sig || {}).par);
    if (!blank(f.guardianNote)) O['t8.r0c0.t5.r0c0.p0'] = left(f.guardianNote);
    O['t9.r0c0.p4'] = kindHtml(orig(K, 't9.r0c0.p4'));
    if (dateOf(f.cDate)) {
      const [hh, mm] = String(f.cTime || '').split(':');
      O['t9.r0c0.p6'] = { html: ticks(orig(K, 't9.r0c0.p6'), ['보호자 연락 일시']) };
      O['t9.r0c0.p7'] = { html: `        ${V(ymdLong(f.cDate))} ${V(dayName(f.cDate))}요일 ( ${V(hh || '')} : ${V(mm || '')} )  ${V(f.cWho || '보호자')} 와/과 ${f.cHow === '문자' ? `▢ 전화 ${ON} 문자` : `${ON} 전화 ▢ 문자`} 연락함` };
    }
    return O;
  }
  /* 신청서·보고서 공통 위쪽(성명·학년반·기간·학습형태·목적·보호자·인솔자) */
  function fillFieldTop(doc, O, R) {
    const f = doc.f || {}, n = gcn(doc.cls, doc.no);
    O['t0.r3c1.p0'] = { html: V(doc.name) };
    O['t0.r3c6.p0'] = { html: `  ${V(n.g)}  학년   ${V(n.c)}  반   ${V(n.no)}  번` };
    if (f.unit === 'half') {
      if (dateOf(f.halfDate)) {
        const d = dateOf(f.halfDate);
        const hours = +f.p2 >= +f.p1 ? +f.p2 - +f.p1 + 1 : '';
        O[R.halfTotal] = { html: ` ( ${V(f.dayTotal || '')} )시간` };
        O[R.half] = { html: `${V(d.getFullYear())}년 ${V(d.getMonth() + 1)}월 ${V(d.getDate())}일 (${V(dayName(f.halfDate))}) ( ${V(f.p1 || '')} )교시~( ${V(f.p2 || '')} )교시/( ${V(hours)} )시간 신청` };
      }
    } else if (dateOf(f.from) && dateOf(f.to)) {
      O[R.day] = { html: ` ${V(dateOf(f.from).getFullYear())}년 ${V(md(f.from))} ~ ${V(md(f.to))} ( ${V(weekdays(f.from, f.to).length)} ) 일간`, align: 'left' };
    }
    if (LEARN.includes(f.form)) {
      let h = esc(orig(doc.kind, R.form));
      h = h.replace(new RegExp(`(${reEsc(f.form)})\\(\\s*\\)`), `$1( ${ON.replace('■', '○')} )`);
      O[R.form] = { html: h };
    }
    O[R.purpose] = { html: V(f.purpose) };
    O[R.dest] = { html: V(f.dest) };
    O[R.gName] = { html: V(f.gName) }; O[R.gRel] = { html: V(f.gRel) }; O[R.gTel] = { html: V(f.gTel) };
    const lead = doc.kind === 'field-apply' && !f.proxy ? { n: f.gName, r: f.gRel, t: f.gTel } : { n: f.lName, r: f.lRel, t: f.lTel };
    O[R.lName] = { html: V(lead.n) }; O[R.lRel] = { html: V(lead.r) }; O[R.lTel] = { html: V(lead.t) };
  }
  function fillApply(doc) {
    const f = doc.f || {}, O = {};
    fillFieldTop(doc, O, { day: 't0.r4c4.p0', halfTotal: 't0.r5c4.p1', half: 't0.r5c8.p0', form: 't0.r7c1.p0', purpose: 't0.r8c1.p0', dest: 't0.r8c12.p0', gName: 't0.r9c1.p0', gRel: 't0.r9c5.p0', gTel: 't0.r9c12.p0', lName: 't0.r10c1.p0', lRel: 't0.r10c5.p0', lTel: 't0.r10c12.p0' });
    if (f.checked) O['t0.r6c12.p0'] = { html: `( <span class="v sf-circ">O</span> ,  X )` };
    O['t0.r11c1.p0'] = left(f.plan);
    if (f.agree) O['t0.r13c1.p0'] = { html: ticks(orig('field-apply', 't0.r13c1.p0'), ['동의']) };
    O.p2 = dateLine(f.date);
    O.p3 = signLine('학  생', doc.name, '(인)', (f.sig || {}).stu);
    O.p4 = signLine('보호자', f.gName, '(인)', (f.sig || {}).par);
    return O;
  }
  function fillProxy(doc) {
    const f = doc.f || {}, px = f.px || {}, O = {}, n = gcn(doc.cls, doc.no);
    O['t0.r1c1.p0'] = { html: `${V(n.g)}학년 ${V(n.c)}반 ${V(n.no)}번` };
    O['t0.r1c3.p0'] = { html: V(doc.name) };
    O['t0.r1c5.p0'] = { html: V(px.stuTel) };
    O['t0.r2c1.p0'] = { html: ` (${V(f.gRel)})`, align: 'left' };
    O['t0.r2c3.p0'] = { html: V(f.gName) };
    O['t0.r2c5.p0'] = { html: V(f.gTel) };
    const half = f.unit === 'half';
    const a = half ? f.halfDate : f.from, b = half ? f.halfDate : f.to;
    if (dateOf(a) && dateOf(b)) {
      const hours = half && +f.p2 >= +f.p1 ? +f.p2 - +f.p1 + 1 : '';
      O['t0.r3c1.p0'] = { html: `${V(ymdLong(a))} ${V(px.t1 || '')}  ~  ${V(md(b))} ${V(px.t2 || '')}, ( ${V(half ? 0 : weekdays(a, b).length)} )일 ( ${V(hours)} )시간` };
    }
    O['t0.r4c1.p0'] = { html: V(f.dest) };
    O['t0.r4c4.p0'] = { html: V(px.stay || '없음(당일)') };
    O['t0.r5c1.p0'] = left(px.reason);
    O['t0.r6c2.p0'] = { html: V(f.lName) };
    O['t0.r7c2.p0'] = { html: `${V(f.lTel)}${f.lRel ? ` (관계: ${V(f.lRel)})` : ''}`, align: 'center' };
    O['t0.r8c2.p0'] = { html: V(px.lAddr) };
    if (px.agree) O['t0.r9c5.p0'] = { html: `( <span class="v sf-circ">○</span> , × )` };
    O['t0.r10c0.p2'] = dateLine(f.date);
    O['t0.r10c0.p3'] = signLine('학  생', doc.name, '(인)', (f.sig || {}).stu);
    O['t0.r10c0.p4'] = signLine('보호자', f.gName, '(인)', (f.sig || {}).par);
    O['t3.r0c0.p4'] = dateLine(f.date);
    O['t3.r0c0.p5'] = signLine('대리 인솔자 :', f.lName, '(인)', px.sigLead);
    return O;
  }
  function fillReport(doc) {
    const f = doc.f || {}, O = {}, K = 'field-report';
    fillFieldTop(doc, O, { day: 't0.r4c4.p0', halfTotal: 't0.r6c4.p1', half: 't0.r6c8.p0', form: 't0.r8c1.p0', purpose: 't0.r9c1.p0', dest: 't0.r9c12.p0', gName: 't0.r10c1.p0', gRel: 't0.r10c5.p0', gTel: 't0.r10c12.p0', lName: 't0.r11c1.p0', lRel: 't0.r11c5.p0', lTel: 't0.r11c12.p0' });
    O['t2.r0c1.p0'] = { html: `▸ ${V(f.place)}`, align: 'left' };
    const days = [].concat(f.days || []).filter((d) => dateOf(d.date)).sort((x, y) => x.date.localeCompare(y.date));
    if (days.length) {
      O['t4.r0c1.p0'] = { html: days.map((d) => `<b>${esc(md(d.date))}(${esc(dayName(d.date))})</b> ${V(d.text || '')}`).join('<br>'), align: 'left', size: 10 };
      dropBlanks(O, K, 't4.r0c1', 1, Math.min(8, days.reduce((n, d) => n + linesOf(d.text), 0)));
    }
    if (!blank(f.feel)) { O['t4.r1c1.p0'] = { html: V(f.feel), align: 'left', size: 10 }; dropBlanks(O, K, 't4.r1c1', 1, Math.min(4, linesOf(f.feel))); }
    const n = days.filter((d) => imgOk(d.photo)).length;
    if (n) O.p5 = { html: `※ 사진 증빙: 뒤쪽 붙임(날짜별 ${V(n)}장)` };
    O.p8 = dateLine(f.date);
    O.p9 = signLine('학  생', doc.name, '(인)', (f.sig || {}).stu);
    O.p10 = signLine('보호자', f.gName, '(인)', (f.sig || {}).par);
    return O;
  }
  const FILL = { absence: fillAbsence, 'field-apply': fillApply, 'field-report': fillReport, 'field-proxy': fillProxy };
  function fill(kind, doc) { return (FILL[kind] || (() => ({})))(doc); }

  /* ── 학교 설정(교사 결정 2026-10-28: 공통 서식 + 학교 이름·결재 칸) ──
     form: 'common'(공통 서식: 제목 + 설정한 결재 칸) / 'gg'(강경고 서식 그대로). name: 'OO학교장 귀하'의 학교 이름 */
  const APPR = ['담임', '부장', '교감', '교장'];
  const HEAD_ROWS = { absence: 2, 'field-apply': 3, 'field-report': 3 };
  function school(o) {
    const x = o || {};
    const appr = (Array.isArray(x.appr) ? x.appr : APPR).map((a) => String(a || '').replace(/\s+/g, ' ').trim().slice(0, 8)).filter(Boolean).slice(0, 7);
    return { form: x.form === 'gg' ? 'gg' : 'common', name: String(x.name || '').trim().slice(0, 30), appr: appr.length ? appr : APPR.slice() };
  }
  let SCH = school();
  const TO_SCHOOL = /^\s*\S*학교장\s*귀하\s*$/;

  /* ── 그리기(길잡이 HwpxEditor의 표 그리기 방식: 칸을 CSS grid로) ── */
  function pHtml(b, path, O) {
    let v = O[path];
    if (v === undefined && SCH.form === 'common' && TO_SCHOOL.test(b.text)) v = { html: esc(`${SCH.name || '학교'}장 귀하`) };
    if (v && v.skip) return '';
    let align = b.align === 'distribute' ? 'justify' : b.align, size = b.size, inner;
    if (v === undefined) inner = textHtml(b.text);
    else if (typeof v === 'string') inner = V(v);
    else { if (v.align) align = v.align; if (v.size) size = v.size; inner = v.html !== undefined ? v.html : V(v.text); }
    const st = [`text-align:${align}`, `font-size:calc(var(--fs, 1) * ${(size * 1.333).toFixed(1)}px)`];
    if (b.bold) st.push('font-weight:700');
    if (b.left) st.push(`padding-left:${(+b.left).toFixed(1)}px`);
    if (b.color && b.color !== '#000000' && v === undefined) st.push(`color:${b.color}`);
    return `<div class="hp${b.serif ? ' serif' : ''}" style="${st.join(';')}">${inner || '&nbsp;'}</div>`;
  }
  function blocksHtml(blocks, prefix, O, from = 0) {
    return (blocks || []).map((b, j) => { const i = j + from; return b.t === 'tbl' ? tblHtml(b, `${prefix}t${i}`, O) : pHtml(b, `${prefix}p${i}`, O); }).join('');
  }
  /* skip: 공통 서식에서 위쪽 제목·결재 줄을 빼고 그린다(그 자리는 headHtml) */
  function tblHtml(t, tp, O, skip = 0) {
    const cols = t.cols.map((w) => `${(+w).toFixed(1)}px`).join(' ');
    const rows = t.rows.slice(skip).map((h) => `minmax(${Math.max(14, +h).toFixed(1)}px,auto)`).join(' ');
    const bw = (n) => (n ? `${n >= 2 ? '2px' : '1px'} solid #111` : '0');
    const cells = t.cells.filter((c) => c.r >= skip).map((c) => {
      const st = [`grid-column:${c.c + 1}/span ${c.cs}`, `grid-row:${c.r - skip + 1}/span ${c.rs}`, `border-left:${bw(c.b.l)}`, `border-right:${bw(c.b.r)}`, `border-top:${bw(c.b.t)}`, `border-bottom:${bw(c.b.b)}`,
        `justify-content:${c.va === 'top' ? 'flex-start' : c.va === 'bottom' ? 'flex-end' : 'center'}`];
      if (c.fill) st.push(`background:${c.fill}`);
      return `<div class="htc" style="${st.join(';')}">${blocksHtml(c.body, `${tp}.r${c.r}c${c.c}.`, O)}</div>`;
    }).join('');
    return `<div class="htbl" style="grid-template-columns:${cols};grid-template-rows:${rows}">${cells}</div>`;
  }
  /* 공통 서식 위쪽: 서식 제목(원래 제목 칸 글) + 설정한 결재 칸 */
  function headHtml(tpl) {
    const t0 = tpl.blocks[0];
    const tc = t0.cells.find((c) => c.r === 0 && c.c === 0) || { body: [] };
    const ps = tc.body.filter((b) => b.t === 'p' && b.text.trim());
    const size = Math.max(...ps.map((b) => b.size || 18), 16);
    const width = t0.cols.reduce((n, w) => n + +w, 0);
    return `<div class="sf-head" style="width:${width.toFixed(1)}px"><div class="sf-title" style="font-size:calc(var(--fs, 1) * ${(size * 1.333).toFixed(1)}px)">${ps.map((b) => esc(b.text.trim())).join('<br>')}</div>
      <table class="sf-appr"><tr><th rowspan="2" class="k">결<br>재</th>${SCH.appr.map((a) => `<th>${esc(a)}</th>`).join('')}</tr><tr>${SCH.appr.map(() => '<td></td>').join('')}</tr></table></div>`;
  }
  function pageHtml(kind, O) {
    const tpl = FORMS()[kind];
    if (!tpl) return `<div class="sf-page"><p>서식(${esc(kind)})이 없어요.</p></div>`;
    const pg = tpl.page;
    const skip = SCH.form === 'common' ? HEAD_ROWS[kind] || 0 : 0;
    const body = skip ? headHtml(tpl) + tblHtml(tpl.blocks[0], 't0', O, skip) + blocksHtml(tpl.blocks.slice(1), '', O, 1) : blocksHtml(tpl.blocks, '', O);
    return `<div class="sf-page" data-form="${esc(kind)}" data-h="${(Math.min(pg.h, 1122.5) - pg.mt - pg.mb - 24).toFixed(1)}" style="padding:${pg.mt}px ${pg.mr}px ${pg.mb}px ${pg.ml}px"><div class="sf-in">${body}</div></div>`;
  }
  function photoPages(doc) {
    const f = doc.f || {};
    const list = [].concat(f.days || []).filter((d) => imgOk(d.photo) && dateOf(d.date)).sort((x, y) => x.date.localeCompare(y.date));
    const out = [];
    for (let i = 0; i < list.length; i += 2) {
      out.push(`<div class="sf-page sf-photos" data-form="photos">
        <div class="sf-ph-head">교외체험학습 사진 증빙 (${i / 2 + 1}/${Math.ceil(list.length / 2)}) · ${esc(hakbunOf(doc.cls, doc.no))} ${esc(doc.name)}</div>
        ${list.slice(i, i + 2).map((d) => `<figure><img class="sf-photo" alt="${esc(md(d.date))} 사진" src="${d.photo}"><figcaption>${esc(md(d.date))}(${esc(dayName(d.date))}) · ${esc(String(d.text || '').slice(0, 60))}</figcaption></figure>`).join('')}
      </div>`);
    }
    return out.join('');
  }
  /* 제출 한 건 → 인쇄할 쪽들(신청서+위임장, 보고서+사진) */
  function pagesHtml(doc, opts) {
    SCH = school(opts && opts.school);
    const out = [pageHtml(doc.kind, fill(doc.kind, doc))];
    if (doc.kind === 'field-apply' && doc.f && doc.f.proxy) out.push(pageHtml('field-proxy', fill('field-proxy', doc)));
    if (doc.kind === 'field-report') out.push(photoPages(doc));
    return out.join('');
  }

  const CSS = `
.sf-pages { display: flex; flex-direction: column; align-items: center; gap: 14px; padding: 10px 0 24px; }
.sf-scale { zoom: var(--sf-z, 1); }
.sf-page { box-sizing: border-box; width: 793.7px; min-height: 1122.5px; background: #fff; color: #111; box-shadow: 0 1px 6px rgb(0 0 0 / .18); font-family: "Malgun Gothic", "맑은 고딕", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif; line-height: 1.45; }
.sf-page .serif { font-family: "Batang", "바탕", "AppleMyungjo", serif; }
.sf-page .hp { min-height: 1.2em; white-space: pre-wrap; overflow-wrap: anywhere; }
.sf-page .htbl { display: grid; }
.sf-page .htc { display: flex; flex-direction: column; padding: 2px 4px; min-width: 0; overflow: hidden; }
.sf-page .v { color: #0d2a6b; font-weight: 600; }
.sf-page .sf-circ { display: inline-block; min-width: 1.3em; border: 1.5px solid #0d2a6b; border-radius: 50%; text-align: center; line-height: 1.2; }
.sf-page .sf-sign { position: relative; display: inline-block; min-width: 4.5em; text-align: center; }
.sf-page .sf-sig { position: absolute; left: 50%; top: 50%; width: 7.5em; height: 3em; object-fit: contain; transform: translate(-50%, -55%); pointer-events: none; }
.sf-head { display: flex; align-items: center; gap: 12px; margin: 0 auto 6px; }
.sf-title { flex: 1; text-align: center; font-weight: 700; line-height: 1.3; }
.sf-appr { border-collapse: collapse; }
.sf-appr th, .sf-appr td { border: 1px solid #111; min-width: 58px; padding: 2px 4px; font-size: calc(var(--fs, 1) * 14.7px); font-weight: 700; text-align: center; }
.sf-appr th.k { min-width: 26px; width: 26px; line-height: 1.4; }
.sf-appr td { height: 52px; }
.sf-photos { padding: 56px 64px; display: flex; flex-direction: column; gap: 18px; }
.sf-ph-head { font-size: 15px; font-weight: 700; border-bottom: 2px solid #111; padding-bottom: 6px; }
.sf-photos figure { margin: 0; display: flex; flex-direction: column; align-items: center; gap: 6px; }
.sf-photos .sf-photo { max-width: 100%; max-height: 440px; object-fit: contain; border: 1px solid #ccc; }
.sf-photos figcaption { font-size: 13.5px; }
@media print {
  html, body { background: #fff !important; }
  @page { size: A4; margin: 0; }
  .sf-pages { display: block; padding: 0; gap: 0; }
  .sf-scale { zoom: 1 !important; }
  .sf-page { box-shadow: none; margin: 0; min-height: 0; break-after: page; page-break-after: always; }
  .sf-page:last-child { break-after: auto; page-break-after: auto; }
  .sf-page .v { color: #000; }
  .sf-page .sf-circ { border-color: #000; }
}`;
  function ensureStyle(doc = root.document) {
    if (!doc || doc.getElementById('sf-style')) return;
    const st = doc.createElement('style');
    st.id = 'sf-style';
    st.textContent = CSS;
    doc.head.appendChild(st);
  }
  /* host 안에 쪽들을 그리고 화면 폭에 맞춘다 */
  function mount(host, doc, opts) {
    ensureStyle(host.ownerDocument);
    host.innerHTML = `<div class="sf-scale"><div class="sf-pages">${pagesHtml(doc, opts)}</div></div>`;
    const sc = host.querySelector('.sf-scale');
    const fit = () => sc.style.setProperty('--sf-z', String(Math.min(1, Math.max(0.3, (host.clientWidth - 8) / 794))));
    /* 한 쪽에 들어가게: 이 기기 글꼴이 한글 서식 글꼴보다 넓으면 글자만 조금씩 줄인다(표 칸 폭은 그대로, 최소 70%). A4 높이 기준 */
    sc.style.setProperty('--sf-z', '1');
    host.querySelectorAll('.sf-page[data-h]').forEach((pg) => {
      const inner = pg.querySelector('.sf-in'), room = +pg.dataset.h;
      for (let fs = 1; fs >= 0.73 && inner.offsetHeight > room; fs = Math.round((fs - 0.03) * 100) / 100) pg.style.setProperty('--fs', String(fs - 0.03));
    });
    fit();
    return { fit, pages: host.querySelectorAll('.sf-page').length };
  }

  /* ── 폰에서 쓰는 도구: 손가락 서명, 사진 줄이기 ───────────── */
  function sigPad(canvas, onChange) {
    const ctx = canvas.getContext('2d');
    let drawing = false, dirty = false, last = null;
    const size = () => {
      const r = canvas.getBoundingClientRect(), dpr = Math.min(2, root.devicePixelRatio || 1);
      if (!r.width) return;
      const keep = dirty ? canvas.toDataURL('image/png') : '';
      canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineWidth = 2.6; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#111';
      if (keep) { const im = new Image(); im.onload = () => ctx.drawImage(im, 0, 0, r.width, r.height); im.src = keep; }
    };
    const pt = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', (e) => { drawing = true; last = pt(e); try { canvas.setPointerCapture(e.pointerId); } catch { /* 일부 브라우저 */ } ctx.beginPath(); ctx.arc(last[0], last[1], 1.2, 0, Math.PI * 2); ctx.fillStyle = '#111'; ctx.fill(); dirty = true; });
    canvas.addEventListener('pointermove', (e) => {
      if (!drawing) return;
      const p = pt(e);
      ctx.beginPath(); ctx.moveTo(last[0], last[1]); ctx.lineTo(p[0], p[1]); ctx.stroke();
      last = p; dirty = true;
    });
    const end = () => { if (!drawing) return; drawing = false; if (onChange) onChange(api.value()); };
    canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end); canvas.addEventListener('pointerleave', end);
    const api = {
      value: () => (dirty ? canvas.toDataURL('image/png') : ''),
      clear: () => { ctx.clearRect(0, 0, canvas.width, canvas.height); dirty = false; if (onChange) onChange(''); },
      load: (src) => {
        if (!imgOk(src)) return;
        const im = new Image();
        im.onload = () => { const r = canvas.getBoundingClientRect(); ctx.drawImage(im, 0, 0, r.width, r.height); dirty = true; };
        im.src = src;
      },
      size,
    };
    size();
    return api;
  }
  /* 사진: 폰에서 긴 변 1280px, JPEG로 줄여 올린다(얼굴 확인용으로 충분, 용량은 보통 100~250KB) */
  async function shrinkPhoto(file, max = 1280, q = 0.72) {
    let src;
    try { src = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch {
      src = await new Promise((ok, no) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => no(new Error('사진을 읽지 못했어요.')); im.src = URL.createObjectURL(file); });
    }
    const w = src.width, h = src.height, z = Math.min(1, max / Math.max(w, h));
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(w * z)); cv.height = Math.max(1, Math.round(h * z));
    const cx = cv.getContext('2d');
    cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height);
    cx.drawImage(src, 0, 0, cv.width, cv.height);
    return cv.toDataURL('image/jpeg', q);
  }

  root.StudentForms = {
    KIND, ATT, AKIND, ASUB, LEARN, FACE,
    dateOf, isoOf, today, addDays, isWeekend, weekdays, nextSchoolDay, dayName, md, range, submitDateProblem,
    normName, classParts, hakbunOf, parseHakbun, stuHash, telOk, imgOk,
    proofGroup, proofsFor, needsGuardianNote, problems, meta, summary,
    paths, fill, pagesHtml, mount, ensureStyle, sigPad, shrinkPhoto, esc, school, APPR,
  };
})(typeof window !== 'undefined' ? window : globalThis);

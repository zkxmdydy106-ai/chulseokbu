/* hwpx-fill.js — 학생 서류를 학교 원본 한글 파일(hwpx)에 바로 채운다(교사 요청 2026-11-02: 원본과 똑같이, 강경고 길잡이와 같은 방식). */
/* 표·테두리·글꼴·칸 크기는 원본 파일 그대로 두고, 값이 들어가는 문단의 글자만 고치고 서명·사진 그림을 더한다. */
/* 브라우저 안에서만 돈다. 아무 데도 보내지 않고, 만든 파일은 교사가 내려받아 한글에서 열어 인쇄한다. */
(function (root) {
  'use strict';

  const NS = {
    hp: 'http://www.hancom.co.kr/hwpml/2011/paragraph',
    hc: 'http://www.hancom.co.kr/hwpml/2011/core',
    hh: 'http://www.hancom.co.kr/hwpml/2011/head',
    opf: 'http://www.idpf.org/2007/opf/',
  };
  const MM = 283.465; /* 1mm = HWPUNIT */
  const FIELD_PAGE = { 'field-apply': 0, 'field-report': 1, 'field-report-more': 2, 'field-proxy': 3 };
  const KIND_NAME = { absence: '결석신고서', 'field-apply': '교외체험학습 신청서', 'field-report': '교외체험학습 결과보고서' };
  /* 위쪽 결재 칸: 표 맨 앞 몇 줄이 제목·결재 칸인지, 칸 이름이 몇 번째 열부터인지 */
  const HEAD = { absence: { rows: 2, col: 7 }, field: { rows: 3, col: 7 } };
  /* 서명 그림 크기(mm): 서명 칸 글자((인) 등) 위에 얹는다 */
  const SIGN_MM = { w: 20, h: 9 };

  /* ── zip 읽기·쓰기(길잡이 HwpxEditor와 같은 방식: 풀기는 브라우저 기본 기능, 저장은 압축 없이) ── */
  const b64ToBytes = (b64) => { const s = atob(b64), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; };
  async function inflateRaw(bytes) {
    const ds = new DecompressionStream('deflate-raw');
    return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer());
  }
  async function unzip(bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let eocd = bytes.length - 22;
    while (eocd >= 0 && dv.getUint32(eocd, true) !== 0x06054b50) eocd--;
    if (eocd < 0) throw new Error('서식 파일이 망가졌어요.');
    const count = dv.getUint16(eocd + 10, true), dec = new TextDecoder(), files = [];
    let p = dv.getUint32(eocd + 16, true);
    for (let i = 0; i < count; i++) {
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
      const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), lho = dv.getUint32(p + 42, true);
      const name = dec.decode(bytes.subarray(p + 46, p + 46 + nlen));
      const start = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true);
      const raw = bytes.subarray(start, start + csize);
      files.push({ name, data: method === 0 ? raw.slice() : await inflateRaw(raw) });
      p += 46 + nlen + xlen + clen;
    }
    return files;
  }
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (u) => { let c = 0xffffffff; for (let i = 0; i < u.length; i++) c = CRC[(c ^ u[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  function zipStored(files) {
    const enc = new TextEncoder(), parts = [], central = [];
    let off = 0;
    for (const f of files) {
      const name = enc.encode(f.name), crc = crc32(f.data), size = f.data.length;
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
      lh.setUint32(14, crc, true); lh.setUint32(18, size, true); lh.setUint32(22, size, true); lh.setUint16(26, name.length, true);
      parts.push(new Uint8Array(lh.buffer), name, f.data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
      ch.setUint32(16, crc, true); ch.setUint32(20, size, true); ch.setUint32(24, size, true); ch.setUint16(28, name.length, true); ch.setUint32(42, off, true);
      central.push(new Uint8Array(ch.buffer), name);
      off += 30 + name.length + size;
    }
    const csize = central.reduce((s, u) => s + u.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, csize, true); end.setUint32(16, off, true);
    return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/hwp+zip' });
  }

  /* ── XML 도우미 ── */
  const parseXml = (bytes) => new DOMParser().parseFromString(new TextDecoder().decode(bytes), 'application/xml');
  const toBytes = (doc) => new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>${new XMLSerializer().serializeToString(doc.documentElement)}`);
  const kids = (el, name) => Array.from(el.children).filter((c) => c.localName === name);
  const kid = (el, name) => kids(el, name)[0];
  const mk = (doc, pfx, name, attrs) => { const e = doc.createElementNS(NS[pfx], `${pfx}:${name}`); for (const k in attrs || {}) e.setAttribute(k, attrs[k]); return e; };
  let idSeq = 0;
  const newId = () => String(1900000000 + (++idSeq) * 7);

  /* 머리(header.xml)에 글자·문단·테두리 모양을 더한다: 원본 번호는 그대로 두고 뒤에 붙인다 */
  function heads(hdoc) {
    const all = (name) => Array.from(hdoc.getElementsByTagNameNS(NS.hh, name));
    const byId = (name, id) => all(name).find((e) => e.getAttribute('id') === String(id));
    const add = (listName, src, edit) => {
      const list = all(listName)[0], maxId = Math.max(...Array.from(list.children).map((e) => +e.getAttribute('id')));
      const c = src.cloneNode(true);
      c.setAttribute('id', String(maxId + 1));
      edit(c);
      list.appendChild(c);
      list.setAttribute('itemCnt', String(list.children.length));
      return String(maxId + 1);
    };
    const memo = new Map();
    const once = (key, make) => { if (!memo.has(key)) memo.set(key, make()); return memo.get(key); };
    return {
      /* 글자 폭 어림(HWPUNIT): 한글 1em, 빈칸·영문·숫자 0.5em × 장평 × (1 + 자간) */
      charWidth(id, c, size) {
        const src = byId('charPr', id);
        const h = size ? size * 100 : src ? +src.getAttribute('height') : 1000;
        const ra = src && kid(src, 'ratio'), sp = src && kid(src, 'spacing');
        const k = ((ra ? +ra.getAttribute('hangul') : 100) / 100) * (1 + (sp ? +sp.getAttribute('hangul') : 0) / 100);
        return (c.charCodeAt(0) < 127 ? 0.5 : 1) * h * k;
      },
      alignOf(id) { const src = byId('paraPr', id), a = src && src.getElementsByTagNameNS(NS.hh, 'align')[0]; return a ? a.getAttribute('horizontal') : 'JUSTIFY'; },
      colored(id) { const src = byId('charPr', id); return !!src && (src.getAttribute('textColor') || '#000000').toUpperCase() !== '#000000'; },
      sizeOf(id) { const src = byId('charPr', id); return src ? +src.getAttribute('height') / 100 : 10; },
      lineSpacing(id) { const src = byId('paraPr', id), l = src && src.getElementsByTagNameNS(NS.hh, 'lineSpacing')[0]; return l && l.getAttribute('type') === 'PERCENT' ? +l.getAttribute('value') : 160; },
      char(id, o) { /* o: { black, size(pt), bold, plain(굵기 뺌) } */
        const src = byId('charPr', id);
        if (!src) return String(id);
        const needBlack = o.black && (src.getAttribute('textColor') || '#000000').toUpperCase() !== '#000000';
        const needSize = o.size && +src.getAttribute('height') !== o.size * 100;
        const needBold = o.bold && !kid(src, 'bold');
        const needPlain = o.plain && !o.bold && !!kid(src, 'bold');
        if (!needBlack && !needSize && !needBold && !needPlain) return String(id);
        return once(`c${id}|${needBlack}|${needSize ? o.size : ''}|${needBold}|${needPlain}`, () => add('charProperties', src, (c) => {
          if (needPlain) c.removeChild(kid(c, 'bold'));
          if (needBlack) c.setAttribute('textColor', '#000000');
          if (needSize) c.setAttribute('height', String(o.size * 100));
          if (needBold) { const b = mk(hdoc, 'hh', 'bold'), off = kid(c, 'offset'); off ? off.after(b) : c.appendChild(b); }
        }));
      },
      para(id, align, ls) { /* 문단 맞춤·줄 간격(%)을 바꾼 모양 */
        const src = byId('paraPr', id);
        if (!src) return String(id);
        const a = src.getElementsByTagNameNS(NS.hh, 'align')[0], want = align ? String(align).toUpperCase() : (a ? a.getAttribute('horizontal') : '');
        if (a && a.getAttribute('horizontal') === want && !ls) return String(id);
        return once(`p${id}|${want}|${ls || ''}`, () => add('paraProperties', src, (c) => {
          const x = c.getElementsByTagNameNS(NS.hh, 'align')[0];
          if (x && want) x.setAttribute('horizontal', want);
          if (ls) Array.from(c.getElementsByTagNameNS(NS.hh, 'lineSpacing')).forEach((l) => { if (l.getAttribute('type') === 'PERCENT') l.setAttribute('value', String(ls)); });
        }));
      },
      /* 테두리: from의 side 면(rightBorder 등)을 of의 같은 면으로 바꾼 모양 */
      border(id, ofId, side) {
        const src = byId('borderFill', id), of = byId('borderFill', ofId);
        if (!src || !of) return String(id);
        return once(`b${id}|${ofId}|${side}`, () => add('borderFills', src, (c) => { const a = kid(c, side), b = kid(of, side); if (a && b) c.replaceChild(b.cloneNode(true), a); }));
      },
    };
  }

  /* ── 문단 글자: 고친 글자만 바꾸고 나머지 글자의 모양은 원본 그대로 ── */
  const CH = { tab: '\t', lineBreak: '\n', fwSpace: '　', nbSpace: ' ' };
  const CH_BACK = { '\t': 'tab', '\n': 'lineBreak', '　': 'fwSpace', ' ': 'nbSpace' };
  function paraChars(p) {
    const out = [];
    kids(p, 'run').forEach((r, ri) => kids(r, 't').forEach((t) => t.childNodes.forEach((n) => {
      if (n.nodeType === 3) for (const c of n.nodeValue) out.push({ c, ri });
      else if (CH[n.localName]) out.push({ c: CH[n.localName], ri });
    })));
    return out;
  }
  const paraText = (p) => paraChars(p).map((x) => x.c).join('');
  /* 원본 글자와 새 글자를 맞대어(같은 글자는 같은 자리), 새 글자마다 어느 run의 모양을 쓸지 정한다 */
  function align(oldC, newS, whole) {
    const a = oldC.map((x) => x.c), b = Array.from(newS), n = a.length, m = b.length;
    if (whole) return b.map((c) => ({ c, ri: n ? oldC[0].ri : 0, kept: false }));
    const w = n + 1, L = new Uint16Array(w * (m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i + j * w] = a[i] === b[j] ? L[i + 1 + (j + 1) * w] + 1 : Math.max(L[i + 1 + j * w], L[i + (j + 1) * w]);
    /* 안내 글('각 일정별로…')처럼 남는 글자가 절반도 안 되거나 새 글이 훨씬 길면 통째로 바꾼다(회색·작은 글자가 군데군데 남지 않게) */
    const solid = (c) => c.trim() !== '';
    const oldSolid = a.filter(solid).length;
    if (oldSolid && b.filter(solid).length > oldSolid * 3) return align(oldC, newS, true);
    let keepSolid = 0;
    for (let i = 0, j = 0; i < n && j < m;) {
      if (a[i] === b[j]) { if (solid(a[i])) keepSolid++; i++; j++; } else if (L[i + 1 + j * w] >= L[i + (j + 1) * w]) i++; else j++;
    }
    const first = n ? oldC[0].ri : 0;
    if (oldSolid && keepSolid * 2 < oldSolid) return b.map((c) => ({ c, ri: first, kept: false }));
    const out = [];
    let i = 0, j = 0, last = first, gap = null; /* gap: 바로 앞에서 지운 글자의 모양(바꿔 쓴 글자는 그 모양을 잇는다) */
    while (j < m) {
      if (i < n && a[i] === b[j]) { last = oldC[i].ri; gap = null; out.push({ c: b[j], ri: last, kept: true }); i++; j++; }
      else if (i < n && L[i + 1 + j * w] >= L[i + (j + 1) * w]) { if (gap === null) gap = oldC[i].ri; i++; }
      else { out.push({ c: b[j], ri: gap === null ? last : gap, kept: false }); j++; }
    }
    return out;
  }
  function fillT(doc, t, chars) {
    let buf = '';
    const flush = () => { if (buf) { t.appendChild(doc.createTextNode(buf)); buf = ''; } };
    for (const x of chars) {
      if (CH_BACK[x.c]) { flush(); t.appendChild(mk(doc, 'hp', CH_BACK[x.c])); } else buf += x.c;
    }
    flush();
  }
  /* segs: [{ text, bold }] */
  function setPara(p, segs, o, H) {
    const doc = p.ownerDocument, runs = kids(p, 'run');
    if (!runs.length) runs.push(p.insertBefore(mk(doc, 'hp', 'run', { charPrIDRef: '0' }), p.firstChild));
    const old = paraChars(p);
    const newS = segs.map((s) => s.text).join('');
    const bolds = [];
    segs.forEach((s) => { for (const c of Array.from(s.text)) bolds.push(!!s.bold && c !== ' '); });
    const baseOf = (ri) => (runs[ri] ? runs[ri].getAttribute('charPrIDRef') : '0');
    let opt = o;
    let mapped = align(old, newS, o.whole || (old.length > 0 && old.every((x) => H.colored(baseOf(x.ri)))));
    mapped.forEach((x, i) => { x.bold = bolds[i]; });
    /* 줄 배치: 원본에서 한 줄이던 문단이 그대로 한 줄에 들어가면 한글이 저장한 줄 배치를 둔다(다시 계산하면 줄 높이가 조금 달라진다). 넘치면 지워 한글이 다시 나누게 */
    const lineW = mapped.reduce((n, x) => n + H.charWidth(baseOf(x.ri), x.c, x.kept ? 0 : o.size), 0);
    const seg = kids(p, 'linesegarray').flatMap((a) => kids(a, 'lineseg'));
    const oldW = old.reduce((n, x) => n + H.charWidth(baseOf(x.ri), x.c, 0), 0); /* 원본 글이 들어가던 폭 이하면 어림과 상관없이 들어간다(□ → ☑ 등) */
    const keepSeg = seg.length === 1 && !newS.includes('\n') && !o.size && (lineW <= oldW * 1.01 || lineW <= +seg[0].getAttribute('horzsize') * 0.97);
    /* 표 칸보다 글이 길면 칸이 늘어 쪽이 넘어간다 → 글자(와 줄 간격)를 줄여 칸 안에 넣는다 */
    if (!keepSeg && !o.size && mapped.length) {
      const fit = fitInCell(p, newS, baseOf(mapped[0].ri), H);
      if (fit) {
        opt = { ...o, size: fit.size, ls: fit.ls };
        mapped = align(old, newS, true);
        mapped.forEach((x, i) => { x.bold = bolds[i]; });
      }
    }
    runs.forEach((r, ri) => {
      const mine = mapped.filter((x) => x.ri === ri);
      const ts = kids(r, 't');
      const at = ts.length ? ts[ts.length - 1].nextSibling : null;
      ts.forEach((t) => r.removeChild(t));
      if (!mine.length) return;
      /* 같은 모양끼리 묶어 run으로: 첫 묶음은 이 run에, 다른 모양은 바로 뒤 새 run에 */
      const base = r.getAttribute('charPrIDRef');
      const groups = [];
      for (const x of mine) {
        const id = H.char(base, { black: !x.kept, size: !x.kept ? opt.size : 0, bold: x.bold, plain: opt.plain && !x.kept });
        if (groups.length && groups[groups.length - 1].id === id) groups[groups.length - 1].chars.push(x);
        else groups.push({ id, chars: [x] });
      }
      let tail = r;
      groups.forEach((g, gi) => {
        const t = mk(doc, 'hp', 't');
        fillT(doc, t, g.chars);
        if (gi === 0) {
          const hasOther = Array.from(r.children).some((c) => c.localName !== 't');
          if (g.id !== base && hasOther) { const nr = mk(doc, 'hp', 'run', { charPrIDRef: g.id }); nr.appendChild(t); tail.after(nr); tail = nr; } else { r.setAttribute('charPrIDRef', g.id); r.insertBefore(t, at); }
        } else { const nr = mk(doc, 'hp', 'run', { charPrIDRef: g.id }); nr.appendChild(t); tail.after(nr); tail = nr; }
      });
    });
    if (!keepSeg) kids(p, 'linesegarray').forEach((n) => p.removeChild(n));
    if (opt.align || opt.ls) p.setAttribute('paraPrIDRef', H.para(p.getAttribute('paraPrIDRef'), opt.align, opt.ls));
  }
  /* 칸 크기(HWPUNIT): 안쪽 폭·높이. 칸 밖 문단이면 null */
  function cellBox(p) {
    const tc = p.parentNode && p.parentNode.localName === 'subList' ? p.parentNode.parentNode : null;
    if (!tc || tc.localName !== 'tc') return null;
    const z = kid(tc, 'cellSz'), m = kid(tc, 'cellMargin');
    const has = tc.getAttribute('hasMargin') === '1' && m;
    const top = has ? +m.getAttribute('top') : 141, bottom = has ? +m.getAttribute('bottom') : 141, left = has ? +m.getAttribute('left') : 141, right = has ? +m.getAttribute('right') : 141;
    return { w: +z.getAttribute('width') - left - right, h: +z.getAttribute('height') - top - bottom };
  }
  /* 글자 크기 s로 몇 줄이 되는지(어림, 빈칸에서 우선 나눔) */
  function lineCount(text, width, id, s, H) {
    let lines = 0;
    for (const part of String(text).split('\n')) {
      let x = 0, n = 1, word = 0;
      for (const c of part) {
        const w = H.charWidth(id, c, s);
        if (c === ' ') { x += word + w; word = 0; continue; }
        word += w;
        if (x + word > width) { if (x > 0) { n++; x = 0; } if (word > width) { n += Math.floor(word / width); word %= width; } }
      }
      lines += n;
    }
    return lines;
  }
  function fitInCell(p, text, id, H) {
    const box = cellBox(p);
    if (!box || box.h <= 0 || box.w <= 0) return null;
    /* 같은 칸의 다른 문단이 차지하는 높이 */
    const others = kids(p.parentNode, 'p').filter((x) => x !== p).reduce((n, q) => n + kids(q, 'linesegarray').flatMap((a) => kids(a, 'lineseg')).reduce((k, g) => k + +g.getAttribute('vertsize') + +g.getAttribute('spacing'), 0), 0);
    const room = box.h - others, ls0 = H.lineSpacing(p.getAttribute('paraPrIDRef')), s0 = H.sizeOf(id);
    const fits = (s, ls) => lineCount(text, box.w * 0.97, id, s, H) * s * ls <= room;
    if (fits(s0, ls0)) return null;
    for (let s = s0 - 0.5; s >= 7; s -= 0.5) if (fits(s, ls0)) return { size: s };
    for (let s = 9; s >= 7; s -= 0.5) if (fits(s, 110)) return { size: s, ls: 110 };
    return { size: 7, ls: 110 };
  }
  /* 서명 표시 글자((인) 등)의 가운데가 문단 왼쪽에서 얼마나 떨어졌는지(HWPUNIT) */
  function markCenter(p, mark, H) {
    const chars = paraChars(p), runs = kids(p, 'run');
    const widthOf = (x) => H.charWidth(runs[x.ri] ? runs[x.ri].getAttribute('charPrIDRef') : '0', x.c, 0);
    const text = chars.map((x) => x.c).join('');
    const at = text.lastIndexOf(mark);
    const before = chars.slice(0, Math.max(0, at)).reduce((n, x) => n + widthOf(x), 0);
    const markW = chars.slice(at, at + mark.length).reduce((n, x) => n + widthOf(x), 0);
    const total = chars.reduce((n, x) => n + widthOf(x), 0);
    const paraW = paraWidth(p);
    const how = H.alignOf(p.getAttribute('paraPrIDRef'));
    const start = how === 'RIGHT' ? paraW - total : how === 'CENTER' ? (paraW - total) / 2 : 0;
    return start + before + markW / 2;
  }

  /* fill()의 html → 글자 묶음 + 서명 그림 */
  function readHtml(html) {
    const body = new DOMParser().parseFromString(`<!doctype html><body>${html}`, 'text/html').body;
    const segs = [], sigs = [];
    let mark = '';
    const walk = (n, bold) => {
      /* XML에 넣을 수 없는 제어 글자는 빼고, 줄바꿈은 \n 하나로(학생이 어떤 글을 내도 파일이 망가지지 않게) */
      if (n.nodeType === 3) { const t = n.nodeValue.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, ''); if (t) segs.push({ text: t, bold }); return; }
      if (n.nodeType !== 1) return;
      const cl = n.classList;
      if (n.nodeName === 'BR') { segs.push({ text: '\n', bold }); return; }
      if (n.nodeName === 'IMG') { if (cl.contains('sf-sig')) sigs.push({ src: n.getAttribute('src'), mark }); return; }
      /* 동그라미 친 O·○: 원본 글꼴에 있는 글자로 */
      if (cl.contains('sf-circ')) { segs.push({ text: n.textContent.trim() === 'O' ? 'ⓞ' : '◎', bold }); return; }
      if (cl.contains('sf-sign')) mark = Array.from(n.childNodes).filter((x) => x.nodeType === 3).map((x) => x.nodeValue).join('').trim();
      if (cl.contains('ln') && segs.length) segs.push({ text: '\n', bold });
      n.childNodes.forEach((x) => walk(x, bold || n.nodeName === 'B'));
    };
    body.childNodes.forEach((x) => walk(x, false));
    return { segs, sigs };
  }

  /* ── 경로(forms.js의 walk와 같은 이름): 맨 위 문단 'p3', 표 't0', 표 칸 문단 't0.r2c1.p0', 칸 안 표 't8.r0c0.t5.r0c0.p0', 글상자 안 문단 'x6.p0' ── */
  function indexPaths(paras, prefix, map) {
    let i = 0;
    for (const p of paras) {
      const inRun = (name) => kids(p, 'run').flatMap((r) => kids(r, name));
      const tbls = inRun('tbl'), rects = inRun('rect');
      if (tbls.length) {
        for (const tb of tbls) {
          const tp = `${prefix}t${i++}`;
          map.set(tp, tb);
          kids(tb, 'tr').forEach((tr) => kids(tr, 'tc').forEach((tc) => {
            const a = kid(tc, 'cellAddr'), sub = kid(tc, 'subList');
            if (sub) indexPaths(kids(sub, 'p'), `${tp}.r${a.getAttribute('rowAddr')}c${a.getAttribute('colAddr')}.`, map);
          }));
        }
      } else if (rects.length) {
        const xp = `${prefix}x${i++}`;
        map.set(xp, rects[0]);
        const dt = kid(rects[0], 'drawText'), sub = dt && kid(dt, 'subList');
        if (sub) indexPaths(kids(sub, 'p'), `${xp}.`, map);
      } else map.set(`${prefix}p${i++}`, p);
    }
    return map;
  }

  /* ── 그림 ── */
  function pngSize(bytes) {
    if (bytes[0] === 0x89) { const d = new DataView(bytes.buffer, bytes.byteOffset); return { w: d.getUint32(16), h: d.getUint32(20) }; }
    let i = 2; /* JPEG */
    while (i < bytes.length) {
      if (bytes[i] !== 0xff) { i++; continue; }
      const m = bytes[i + 1];
      if (m >= 0xc0 && m <= 0xc3) return { h: (bytes[i + 5] << 8) | bytes[i + 6], w: (bytes[i + 7] << 8) | bytes[i + 8] };
      i += 2 + ((bytes[i + 2] << 8) | bytes[i + 3]);
    }
    return { w: 1, h: 1 };
  }
  function dataBytes(src) {
    const m = /^data:image\/(png|jpeg);base64,(.*)$/.exec(src || '');
    return m ? { ext: m[1] === 'png' ? 'png' : 'jpg', mime: m[1] === 'png' ? 'image/png' : 'image/jpeg', bytes: b64ToBytes(m[2]) } : null;
  }
  function picEl(doc, binId, px, W, H, pos) {
    const pic = mk(doc, 'hp', 'pic', { id: newId(), zOrder: String(1000 + idSeq), numberingType: 'PICTURE', textWrap: pos.inline ? 'TOP_AND_BOTTOM' : 'IN_FRONT_OF_TEXT', textFlow: 'BOTH_SIDES', lock: '0', dropcapstyle: 'None', href: '', groupLevel: '0', instid: newId(), reverse: '0' });
    const add = (pfx, name, attrs, parent = pic) => { const e = mk(doc, pfx, name, attrs); parent.appendChild(e); return e; };
    add('hp', 'offset', { x: 0, y: 0 });
    add('hp', 'orgSz', { width: W, height: H });
    add('hp', 'curSz', { width: W, height: H });
    add('hp', 'flip', { horizontal: 0, vertical: 0 });
    add('hp', 'rotationInfo', { angle: 0 });
    const ri = add('hp', 'renderingInfo');
    const mat = (name) => add('hc', name, { e1: 1, e2: 0, e3: 0, e4: 0, e5: 1, e6: 0 }, ri);
    mat('transMatrix'); mat('scaMatrix'); mat('rotMatrix');
    const rc = add('hp', 'imgRect');
    [['pt0', 0, 0], ['pt1', W, 0], ['pt2', W, H], ['pt3', 0, H]].forEach(([n, x, y]) => add('hc', n, { x, y }, rc));
    add('hp', 'imgClip', { left: 0, right: px.w * 75, top: 0, bottom: px.h * 75 });
    add('hp', 'inMargin', { left: 0, right: 0, top: 0, bottom: 0 });
    add('hc', 'img', { binaryItemIDRef: binId, bright: 0, contrast: 0, effect: 'REAL_PIC', alpha: 0 });
    add('hp', 'effects');
    add('hp', 'sz', { width: W, widthRelTo: 'ABSOLUTE', height: H, heightRelTo: 'ABSOLUTE', protect: 0 });
    add('hp', 'pos', pos.inline
      ? { treatAsChar: 1, affectLSpacing: 0, flowWithText: 1, allowOverlap: 0, holdAnchorAndSO: 0, vertRelTo: 'PARA', horzRelTo: 'PARA', vertAlign: 'TOP', horzAlign: 'LEFT', vertOffset: 0, horzOffset: 0 }
      : { treatAsChar: 0, affectLSpacing: 0, flowWithText: 1, allowOverlap: 1, holdAnchorAndSO: 0, vertRelTo: 'PARA', horzRelTo: 'PARA', vertAlign: 'TOP', horzAlign: 'LEFT', vertOffset: Math.round(pos.y), horzOffset: Math.round(pos.x) });
    add('hp', 'outMargin', { left: 0, right: 0, top: 0, bottom: 0 });
    return pic;
  }

  /* ── 결재 칸(공통 서식): 칸 이름·수·맨 끝 칸 전결. 강경고 칸과 같으면 원본 그대로 ── */
  function cellOf(tc) {
    const a = kid(tc, 'cellAddr'), s = kid(tc, 'cellSpan'), z = kid(tc, 'cellSz');
    return { tc, r: +a.getAttribute('rowAddr'), c: +a.getAttribute('colAddr'), rs: +s.getAttribute('rowSpan'), cs: +s.getAttribute('colSpan'), w: +z.getAttribute('width') };
  }
  function setCell(tc, r, c, rs, cs, w, h) {
    const a = kid(tc, 'cellAddr'), s = kid(tc, 'cellSpan'), z = kid(tc, 'cellSz');
    a.setAttribute('rowAddr', r); a.setAttribute('colAddr', c);
    s.setAttribute('rowSpan', rs); s.setAttribute('colSpan', cs);
    z.setAttribute('width', w);
    if (h !== undefined) z.setAttribute('height', h);
  }
  function applyAppr(tbl, kind, sch, H) {
    const G = HEAD[kind === 'absence' ? 'absence' : 'field'];
    const trs = kids(tbl, 'tr');
    const cells = trs.flatMap((tr) => kids(tr, 'tc').map(cellOf));
    const area = cells.filter((x) => x.r < G.rows && x.c >= G.col);
    const names = area.filter((x) => x.r === 0).sort((a, b) => a.c - b.c);
    const orig = names.map((x) => paraText(kid(kid(x.tc, 'subList'), 'p')).replace(/\s+/g, ''));
    const want = sch.appr.map((a) => a.replace(/\s+/g, ''));
    const same = orig.length === want.length && orig.every((n, i) => n === want[i]);
    if (same && sch.jeon) return;
    const sameCount = want.length === names.length;
    if (sameCount && sch.jeon) { /* 칸 수가 같으면 이름만 */
      names.forEach((x, i) => { setPara(kid(kid(x.tc, 'subList'), 'p'), [{ text: sch.appr[i] }], { whole: true }, H); });
      return;
    }
    /* 칸 수가 다르거나 전결이 없으면 위쪽 칸을 다시 나눈다: 표의 열 경계를 모아 새 경계를 더하고, 모든 칸의 열 번호를 다시 매긴다 */
    const xs = { 0: 0 };
    for (let k = 0; k < cells.length + 2; k++) for (const x of cells) if (x.c in xs && !(x.c + x.cs in xs)) xs[x.c + x.cs] = xs[x.c] + x.w;
    const old = Object.values(xs);
    /* 있던 경계에 아주 가까우면 그 경계를 쓴다(폭이 거의 없는 열이 생기면 한글이 표를 망가뜨림) */
    const snap = (x) => old.reduce((best, v) => (Math.abs(v - x) < Math.abs(best - x) ? v : best), Infinity);
    const near = (x) => (Math.abs(snap(x) - x) < 200 ? snap(x) : x);
    const X0 = xs[G.col], X1 = Math.max(...old), N = want.length, W = (X1 - X0) / N;
    const edges = Array.from({ length: N + 1 }, (_, i) => (i === 0 ? X0 : i === N ? X1 : near(Math.round(X0 + i * W))));
    const lastHalf = kind !== 'absence' && sch.jeon ? near(Math.round((edges[N - 1] + X1) / 2)) : null;
    const line = Array.from(new Set([...old, ...edges, ...(lastHalf === null ? [] : [lastHalf])])).sort((a, b) => a - b);
    const col = (x) => line.indexOf(x);
    for (const x of cells) {
      if (area.includes(x)) continue;
      const a = xs[x.c], b = xs[x.c + x.cs];
      setCell(x.tc, x.r, col(a), x.rs, col(b) - col(a), x.w);
    }
    const nameMid = names[0], nameLast = names[names.length - 1];
    const signMid = area.filter((x) => x.r === 1).sort((a, b) => a.c - b.c)[0];
    const subs = area.filter((x) => x.r >= 1 && x.c >= nameLast.c).sort((a, b) => a.r - b.r || a.c - b.c);
    const rowsNew = Array.from({ length: G.rows }, () => []);
    const place = (tc, r, a, b, rs, w) => { setCell(tc, r, col(a), rs, col(b) - col(a), w === undefined ? b - a : w); return tc; };
    for (let i = 0; i < N; i++) {
      const lastOne = i === N - 1, a = edges[i], b = edges[i + 1];
      const nm = place((lastOne ? nameLast : nameMid).tc.cloneNode(true), 0, a, b, 1);
      const np = kid(kid(nm, 'subList'), 'p'), id = kids(np, 'run').slice(-1)[0].getAttribute('charPrIDRef');
      let fs = H.sizeOf(id);
      const room = (b - a) - 300;
      while (fs > 6 && Array.from(sch.appr[i]).reduce((n, c) => n + H.charWidth(id, c, fs), 0) > room) fs -= 0.5;
      setPara(np, [{ text: sch.appr[i] }], { whole: true, size: fs < H.sizeOf(id) ? fs : 0 }, H);
      rowsNew[0].push(nm);
      if (lastOne && sch.jeon) {
        if (kind === 'absence') rowsNew[1].push(place(subs[0].tc.cloneNode(true), 1, a, b, 1));
        else subs.forEach((x) => { const left = x.c === nameLast.c; rowsNew[x.r].push(place(x.tc.cloneNode(true), x.r, left ? a : lastHalf, left ? lastHalf : b, x.rs)); });
        continue;
      }
      const sg = place((kind === 'absence' && lastOne ? subs[0] : signMid).tc.cloneNode(true), 1, a, b, G.rows - 1);
      if (lastOne && kind !== 'absence') sg.setAttribute('borderFillIDRef', H.border(signMid.tc.getAttribute('borderFillIDRef'), nameLast.tc.getAttribute('borderFillIDRef'), 'rightBorder'));
      if (lastOne && kind === 'absence') kids(kid(sg, 'subList'), 'p').forEach((q) => setPara(q, [], {}, H));
      rowsNew[1].push(sg);
    }
    trs.slice(0, G.rows).forEach((tr, r) => {
      kids(tr, 'tc').forEach((tc) => { if (area.some((y) => y.tc === tc)) tr.removeChild(tc); });
      rowsNew[r].forEach((tc) => tr.appendChild(tc));
    });
    /* 칸이 하나도 없는 줄(전결을 뺀 체험학습 서식의 셋째 줄)은 지우고 아래 칸 번호를 당긴다(빈 줄이 있으면 한글이 파일을 못 연다) */
    trs.slice(0, G.rows).forEach((tr, r) => {
      if (kids(tr, 'tc').length) return;
      tbl.removeChild(tr);
      for (const t of kids(tbl, 'tr')) for (const tc of kids(t, 'tc')) {
        const c = cellOf(tc);
        if (c.r > r) kid(tc, 'cellAddr').setAttribute('rowAddr', c.r - 1);
        else if (c.r + c.rs > r) kid(tc, 'cellSpan').setAttribute('rowSpan', c.rs - 1);
      }
      tbl.setAttribute('rowCnt', String(kids(tbl, 'tr').length));
    });
    tbl.setAttribute('colCnt', String(line.length - 1));
  }

  /* ── 서식 한 쪽 채우기 ── */
  const REPLACE_SCHOOL = /^\s*\S*학교장\s*귀하\s*$/;
  function applyPage(paras, O, ctx) {
    const map = indexPaths(paras, '', new Map());
    for (const path of Object.keys(O)) {
      const v = O[path], p = map.get(path);
      if (!p || !v || p.localName !== 'p') continue;
      if (v.skip) { const up = p.parentNode; if (kids(up, 'p').length > 1) up.removeChild(p); continue; }
      const html = typeof v === 'string' ? ctx.SF.esc(v) : v.html !== undefined ? v.html : ctx.SF.esc(v.text);
      const { segs, sigs } = readHtml(html);
      setPara(p, segs, { align: v.align, size: v.size, plain: v.plain }, ctx.H);
      for (const s of sigs) ctx.sign(p, s);
    }
    /* 공통 서식: 'OO학교장 귀하'를 설정한 학교 이름으로 */
    if (ctx.sch.form === 'common') {
      for (const [path, p] of map) {
        if (p.localName !== 'p' || O[path]) continue;
        if (REPLACE_SCHOOL.test(paraText(p))) setPara(p, [{ text: `${ctx.sch.name || '학교'}장 귀하` }], {}, ctx.H);
      }
    }
  }

  /* 사진 쪽: 웹 인쇄의 photoPages와 같은 차례(한 쪽에 두 장) */
  function photoParas(doc, S, sec, ctx, proto) {
    const f = doc.f || {};
    const list = [].concat(f.days || []).filter((d) => S.imgOk(d.photo) && S.dateOf(d.date)).sort((x, y) => x.date.localeCompare(y.date));
    const out = [];
    const para = (text, first) => {
      const p = mk(sec.ownerDocument, 'hp', 'p', { id: '0', paraPrIDRef: proto.para, styleIDRef: '0', pageBreak: first ? '1' : '0', columnBreak: '0', merged: '0' });
      const r = mk(sec.ownerDocument, 'hp', 'run', { charPrIDRef: proto.char });
      if (text) { const t = mk(sec.ownerDocument, 'hp', 't'); t.textContent = text; r.appendChild(t); }
      p.appendChild(r);
      return { p, r };
    };
    const total = Math.ceil(list.length / 2);
    list.forEach((d, i) => {
      if (i % 2 === 0) out.push(para(`교외체험학습 사진 증빙 (${i / 2 + 1}/${total}) · ${S.hakbunOf(doc.cls, doc.no)} ${doc.name}`, true).p);
      const img = dataBytes(d.photo);
      if (!img) return;
      const px = pngSize(img.bytes), maxW = 170 * MM, maxH = 110 * MM, z = Math.min(maxW / px.w, maxH / px.h);
      const pp = para('', false);
      pp.r.appendChild(picEl(sec.ownerDocument, ctx.bin(img), px, Math.round(px.w * z), Math.round(px.h * z), { inline: true }));
      out.push(pp.p); /* 사진 아래 설명은 넣지 않는다(교사 요청 2026-11-03) */
    });
    return out;
  }

  /* ── 전체: 제출 한 건 → .hwpx 파일 ── */
  async function build(doc, opts) {
    const S = root.StudentForms, T = root.SCHOOL_HWPX;
    if (!S || !T) throw new Error('서식 파일을 불러오지 못했어요.');
    const sch = S.school(opts && opts.school);
    const tplKey = doc.kind === 'absence' ? 'absence' : 'field';
    const files = await unzip(b64ToBytes(T[tplKey]));
    const fileOf = (n) => files.find((f) => f.name === n);
    const sdoc = parseXml(fileOf('Contents/section0.xml').data);
    const hdoc = parseXml(fileOf('Contents/header.xml').data);
    const mdoc = parseXml(fileOf('Contents/content.hpf').data);
    const sec = sdoc.documentElement;
    const H = heads(hdoc);

    /* 그림 등록: 같은 그림은 한 번만 */
    const bins = new Map();
    const manifest = mdoc.getElementsByTagNameNS(NS.opf, 'manifest')[0];
    const bin = (img, key) => {
      const k = key || img.bytes;
      if (bins.has(k)) return bins.get(k);
      const id = `image${bins.size + 1}`, name = `BinData/${id}.${img.ext}`;
      files.push({ name, data: img.bytes });
      const it = mdoc.createElementNS(NS.opf, 'opf:item');
      it.setAttribute('id', id); it.setAttribute('href', name); it.setAttribute('media-type', img.mime); it.setAttribute('isEmbeded', '1');
      manifest.appendChild(it);
      bins.set(k, id);
      return id;
    };
    /* 서명: 끝이 잘리지 않게 여백을 덜고 굵게 만든 그림을 (인) 위에 얹는다 */
    const sigCache = new Map();
    const thick = async (src) => { if (!sigCache.has(src)) sigCache.set(src, S.thickSig ? await S.thickSig(src, SIGN_MM.w, SIGN_MM.h) : src); return sigCache.get(src); };
    const pendingSigs = [];
    const sign = (p, s) => pendingSigs.push({ p, s });

    /* 쪽 나누기: 맨 위 문단의 쪽 나눔 표시로 */
    const top = kids(sec, 'p');
    const pages = [];
    let cur = [];
    for (const p of top) { if (p.getAttribute('pageBreak') === '1' && cur.length) { pages.push(cur); cur = []; } cur.push(p); }
    pages.push(cur);
    const secRun = kids(top[0], 'run').find((r) => kid(r, 'secPr'));

    const ctx = { S, SF: S, H, sch, sign, bin };
    const want = [];
    if (doc.kind === 'absence') want.push({ page: pages[0], O: S.fill('absence', doc), key: 'absence' });
    else {
      want.push({ page: pages[FIELD_PAGE[doc.kind]], O: S.fill(doc.kind, doc), key: doc.kind });
      if (doc.kind === 'field-apply' && doc.f && doc.f.proxy) want.push({ page: pages[FIELD_PAGE['field-proxy']], O: S.fill('field-proxy', doc), key: 'field-proxy' });
      if (doc.kind === 'field-report') S.fillMore(doc).forEach((O) => want.push({ page: pages[FIELD_PAGE['field-report-more']], O, key: 'field-report-more' }));
    }

    const outParas = [];
    for (const w of want) {
      const clones = w.page.map((p) => p.cloneNode(true));
      clones.forEach((p) => {
        /* 복사한 쪽에는 쪽 설정이 또 있으면 안 된다 */
        kids(p, 'run').forEach((r) => { if (kid(r, 'secPr')) p.removeChild(r); });
        Array.from(p.getElementsByTagNameNS(NS.hp, 'tbl')).forEach((t) => t.setAttribute('id', newId()));
      });
      /* 표 머리(결재 칸)는 채우기 전에: 칸 경로가 바뀌지 않게 위쪽 칸만 고친다 */
      if (sch.form === 'common' && (w.key === 'absence' || w.key === 'field-apply' || w.key === 'field-report')) {
        const firstTbl = clones.flatMap((p) => kids(p, 'run').flatMap((r) => kids(r, 'tbl')))[0];
        const O = w.O;
        applyPage(clones, O, ctx); /* 경로는 원본 열 번호라 채우기가 먼저 */
        applyAppr(firstTbl, w.key, sch, H);
      } else applyPage(clones, w.O, ctx);
      clones[0].setAttribute('pageBreak', outParas.length ? '1' : '0');
      outParas.push(...clones);
    }
    /* 쪽 설정은 맨 앞 문단에 */
    outParas[0].insertBefore(secRun.cloneNode(true), outParas[0].firstChild);

    /* 서명 그림 넣기 */
    for (const { p, s } of pendingSigs) {
      const src = await thick(s.src), img = dataBytes(src);
      if (!img) continue;
      const px = pngSize(img.bytes), z = Math.min(SIGN_MM.w * MM / px.w, SIGN_MM.h * MM / px.h);
      const W = Math.round(px.w * z), Ht = Math.round(px.h * z);
      /* 표시 글자((인) 등) 가운데에 서명 가운데를 맞춘다. 오른쪽 여백을 많이 넘지 않게 왼쪽으로 조금 당긴다 */
      const x = Math.min(markCenter(p, s.mark, H) - W / 2, paraWidth(p) + 4 * MM - W);
      const y = -(Ht / 2 - 2.1 * MM);
      const run = mk(sdoc, 'hp', 'run', { charPrIDRef: kids(p, 'run').slice(-1)[0].getAttribute('charPrIDRef') });
      run.appendChild(picEl(sdoc, bin(img, s.src), px, W, Ht, { x, y }));
      p.appendChild(run);
    }

    /* 사진 쪽(결과보고서) */
    if (doc.kind === 'field-report') {
      const lastP = outParas[outParas.length - 1];
      const proto = { para: H.para(lastP.getAttribute('paraPrIDRef'), 'LEFT'), char: kids(lastP, 'run').slice(-1)[0].getAttribute('charPrIDRef') };
      outParas.push(...photoParas(doc, S, sec, ctx, proto));
    }

    /* 구역을 새 문단들로 */
    top.forEach((p) => sec.removeChild(p));
    outParas.forEach((p) => sec.appendChild(p));

    fileOf('Contents/section0.xml').data = toBytes(sdoc);
    fileOf('Contents/header.xml').data = toBytes(hdoc);
    fileOf('Contents/content.hpf').data = toBytes(mdoc);
    const mt = files.findIndex((f) => f.name === 'mimetype');
    if (mt > 0) files.unshift(files.splice(mt, 1)[0]);
    return { blob: zipStored(files), name: fileName(doc) };
  }
  /* 문단이 놓인 폭(HWPUNIT): 표 칸 안이면 칸 폭 - 여백, 맨 위면 단 폭 */
  function paraWidth(p) {
    const up = p.parentNode;
    if (up && up.localName === 'subList') {
      const tc = up.parentNode;
      if (tc && tc.localName === 'tc') {
        const z = kid(tc, 'cellSz'), m = kid(tc, 'cellMargin');
        const left = m ? +m.getAttribute('left') : 141, right = m ? +m.getAttribute('right') : 141;
        return +z.getAttribute('width') - left - right;
      }
    }
    return 48190;
  }
  /* 파일 이름에는 학생 이름을 넣지 않는다(내려받기 폴더에 남아도 이름이 안 보이게) */
  function fileName(doc) {
    const safe = (s) => String(s || '').replace(/[\\/:*?"<>|\s]+/g, '');
    return `${KIND_NAME[doc.kind] || '서류'}_${safe(doc.c || doc.cls)}_${safe(doc.no)}번.hwpx`;
  }

  root.HwpxFill = { build, fileName, _unzip: unzip, _b64: b64ToBytes, _align: align };
})(typeof window !== 'undefined' ? window : globalThis);

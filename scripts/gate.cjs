#!/usr/bin/env node
/**
 * dsh-judge-loop gate v2
 *
 * 双团队模型：
 *   professor（教授团队）产出 <work>/rubric.json —— 决定上限，不看导师的稿
 *   tutor（导师团队）产出 runs/<N>/draft-v*.md + score-v*.json —— 冲向满分
 *   gate（这个脚本）只做机械判定：它不信任何一方的口头声明
 *
 * 退出码：
 *   0 通过 / 2 结构或判据非法 / 3 不满分 / 4 命中硬否决
 *   5 缺外部判分记录 / 6 轮次超限或缺 BLOCKED / 7 用法错 / 8 rubric 不合法
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ALLOWED_SCORES = [0, 4, 7, 10];
const MAX_ROUNDS = 5;
const MIN_DIMS = 4, MAX_DIMS = 6, MIN_W = 10, MAX_W = 30;
// 判据必须含一个能被外部抽查的对象
const CONCRETE = /(路径|文件|行号|命令|退出码|输出|原文|引用|链接|样本|数字|条|字|秒|词|字节|hash|https?:\/\/|\.md|\.json|\.cjs|[A-Za-z]:\\|[\/\\][\w.-]+)/;

const E = { OK: 0, INVALID: 2, NOT_100: 3, VETO: 4, NO_REVIEW: 5, NO_BLOCK: 6, USAGE: 7, RUBRIC: 8 };

function die(code, msg) { console.error(msg); process.exit(code); }
function readJson(p) {
  const raw = fs.readFileSync(p, 'utf8');
  return JSON.parse(raw.replace(/^\uFEFF/, ''));
}
function sha256File(p) { return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); }
function rounds(work) {
  const rd = path.join(work, 'runs');
  if (!fs.existsSync(rd)) return [];
  return fs.readdirSync(rd)
    .filter(n => /^\d+$/.test(n) && fs.statSync(path.join(rd, n)).isDirectory())
    .map(Number).sort((a, b) => a - b);
}
function versions(work, N) {
  const dir = path.join(work, 'runs', String(N));
  if (!fs.existsSync(dir)) return [];
  const out = new Set();
  for (const f of fs.readdirSync(dir)) {
    const m = /^draft-v(\d+)\.md$/.exec(f);
    if (m) out.add(Number(m[1]));
  }
  return [...out].sort((a, b) => a - b);
}

/** 校验 professor 产出的 rubric.json —— 这是整套东西的上限 */
function validateRubric(work) {
  const p = path.join(work, 'rubric.json');
  if (!fs.existsSync(p)) return { errors: [`缺 ${p}（先让教授团队出 rubric，导师不许自己写）`] };
  let r;
  try { r = readJson(p); } catch (e) { return { errors: [`rubric.json 不是合法 JSON: ${e.message}`] }; }

  const errors = [];
  if (!Array.isArray(r.dims)) return { errors: ['rubric.json 缺 dims 数组'] };
  if (r.dims.length < MIN_DIMS || r.dims.length > MAX_DIMS) errors.push(`维度 ${r.dims.length} 个，要求 ${MIN_DIMS}–${MAX_DIMS}`);

  const ids = new Set();
  let sum = 0;
  r.dims.forEach((d, i) => {
    const tag = `dims[${i}]${d && d.id ? '(' + d.id + ')' : ''}`;
    if (!d || !d.id) { errors.push(`${tag}: 缺 id`); return; }
    if (ids.has(String(d.id))) errors.push(`${tag}: id 重复`);
    ids.add(String(d.id));
    if (!d.name || String(d.name).length < 2) errors.push(`${tag}: 缺 name`);
    const w = Number(d.weight);
    if (!Number.isFinite(w) || w < MIN_W || w > MAX_W) errors.push(`${tag}: 权重 ${d.weight}，要求 ${MIN_W}–${MAX_W}`);
    else sum += w;
    const c = String(d.criterion || '');
    if (c.length < 12) errors.push(`${tag}: criterion 少于 12 字，写不出判据就是没标准`);
    else if (!CONCRETE.test(c)) errors.push(`${tag}: criterion 里没有任何可抽查的对象（路径/文件/行号/命令/退出码/原文/数字…）——「有深度」这种判不了`);
    const pe = String(d.pass_example || ''), fe = String(d.fail_example || '');
    if (pe.length < 8 || fe.length < 8) errors.push(`${tag}: pass_example / fail_example 各要 ≥8 字（写不出两个具体样子就是没法判）`);
    else if (pe === fe) errors.push(`${tag}: pass_example 与 fail_example 相同`);
  });
  if (Math.abs(sum - 100) > 0.001) errors.push(`权重合计 ${sum}，必须正好 100`);

  if (!Array.isArray(r.vetoes) || r.vetoes.length < 1) errors.push('缺 vetoes（硬否决至少 1 条，否则高分可以买通一切）');
  else r.vetoes.forEach((v, i) => {
    if (!v || !v.id || !v.name) errors.push(`vetoes[${i}]: 缺 id 或 name`);
    if (!v.why || String(v.why).length < 10) errors.push(`vetoes[${i}]: why 太短——说不出「为什么不能用分数换」，这条否决就守不住`);
  });

  return { errors, rubric: r };
}

/** 校验一轮 */
function checkRound(work, N, rubric) {
  const dir = path.join(work, 'runs', String(N));
  const errors = [];
  if (!fs.existsSync(dir)) return { errors: [`轮次目录不存在: runs/${N}`], total: null, vetoes: [] };

  const vs = versions(work, N);
  if (vs.length < 2) errors.push(`runs/${N} 只有 ${vs.length} 版稿（要有初稿和改后稿，每版都有判分记录）`);

  let lastTotal = null, lastVs = null;

  for (const v of vs) {
    const draftP = path.join(dir, `draft-v${v}.md`);
    const scoreP = path.join(dir, `score-v${v}.json`);
    if (!fs.existsSync(scoreP)) { errors.push(`缺 score-v${v}.json`); continue; }
    const draft = fs.readFileSync(draftP, 'utf8');
    let sc;
    try { sc = readJson(scoreP); } catch (e) { errors.push(`score-v${v}.json 不合法: ${e.message}`); continue; }
    if (!Array.isArray(sc.dims)) { errors.push(`score-v${v}: 缺 dims`); continue; }

    const byId = {};
    sc.dims.forEach(d => { byId[String(d.id)] = d; });
    let sum = 0, okAll = true;

    for (const spec of rubric.dims) {
      const d = byId[String(spec.id)];
      if (!d) { errors.push(`score-v${v}: 缺维度 ${spec.id}`); okAll = false; continue; }
      const s = Number(d.score);
      if (!ALLOWED_SCORES.includes(s)) errors.push(`score-v${v}: ${spec.id} 给了 ${d.score}，只允许 0 / 4 / 7 / 10`);
      sum += s * Number(spec.weight) / 10;

      const q = String(d.quote || '').trim();
      if (q.length < 12) errors.push(`score-v${v}: ${spec.id} 的 quote 少于 12 字（必须抄稿里逐字存在的一段）`);
      else if (draft.indexOf(q) < 0) errors.push(`score-v${v}: ${spec.id} 的 quote 在 draft-v${v}.md 里找不到：「${q.slice(0, 24)}…」`);

      if (s < 10) {
        const ds = Array.isArray(d.deductions) ? d.deductions : [];
        if (!ds.length) errors.push(`score-v${v}: ${spec.id} 给了 ${s} 分却没写 deductions`);
        ds.forEach((dd, i) => {
          const fix = String((dd && dd.fix) || dd || '');
          const m = /^把\s*draft-v(\d+)\.md:(\d+)\s*的\s*[「"]([\s\S]{12,}?)[」"]\s*改成\s*[「"]([\s\S]+)[」"]\s*$/.exec(fix);
          if (!m) { errors.push(`score-v${v}: ${spec.id} deductions[${i}] 不是「把 draft-vX.md:NN 的「原文≥12字」改成「新句」」`); return; }
          const src = path.join(dir, `draft-v${Number(m[1])}.md`);
          if (!fs.existsSync(src)) { errors.push(`score-v${v}: ${spec.id} deductions[${i}] 指向不存在的 draft-v${m[1]}.md`); return; }
          if (fs.readFileSync(src, 'utf8').indexOf(m[3]) < 0) errors.push(`score-v${v}: ${spec.id} deductions[${i}] 引的原文在那版稿里找不到`);
          if (String(m[4] || '').trim().length < 4) errors.push(`score-v${v}: ${spec.id} deductions[${i}] 的替换句太短`);
        });
      }
    }

    for (const k of Object.keys(byId)) {
      if (!rubric.dims.some(d => String(d.id) === k)) errors.push(`score-v${v}: 出现了 rubric 里没有的维度 ${k}`);
    }

    const total = Math.round(sum * 10) / 10;
    if (Math.abs(Number(sc.total) - total) > 0.001) errors.push(`score-v${v}: 写 total=${sc.total}，按 rubric 重算=${total}`);

    const bs = Array.isArray(sc.beyond_spec) ? sc.beyond_spec : [];
    if (total === 100) {
      if (!bs.length) errors.push(`score-v${v}: 满分但缺 beyond_spec（只满足细则不算超出）`);
      bs.forEach((b, i) => {
        if (!b || !b.what || !b.reason) { errors.push(`score-v${v}: beyond_spec[${i}] 缺 what 或 reason`); return; }
        if (draft.indexOf(String(b.what)) < 0) errors.push(`score-v${v}: beyond_spec[${i}] 说的内容在稿里找不到`);
        if (String(b.reason).length < 10) errors.push(`score-v${v}: beyond_spec[${i}].reason 太短（要写清「他为什么没想到」）`);
      });
    }

    lastTotal = total; lastVs = v;
  }

  const vetoP = path.join(dir, 'veto.json');
  let vetoes = [];
  const knownVeto = (rubric.vetoes || []).map(v => String(v.id));
  if (fs.existsSync(vetoP)) {
    try {
      const vj = readJson(vetoP);
      if (!Array.isArray(vj.vetoes_hit)) errors.push('veto.json: vetoes_hit 必须是数组');
      else vetoes = vj.vetoes_hit.map(String);
      const bad = vetoes.filter(x => !knownVeto.includes(x));
      if (bad.length) errors.push(`veto.json: 未知否决编号 ${bad.join(',')}（rubric 里只定义了 ${knownVeto.join(',')}）`);
    } catch (e) { errors.push(`veto.json 不合法: ${e.message}`); }
  }

  return { errors, total: lastTotal, vetoes, lastVs, dir };
}

function checkWork(work) {
  const vr = validateRubric(work);
  if (vr.errors.length) {
    return { rubricErrors: true, rubric: null, rounds: [], last: null, total: null, vetoes: [],
      errors: { form: vr.errors.map(e => `rubric: ${e}`), block: [], review: [] } };
  }
  const rubric = vr.rubric;
  const form = [], block = [], review = [];

  const rs = rounds(work);
  if (!rs.length) {
    form.push('runs/ 下没有轮次');
    return { rubric, rounds: [], last: null, total: null, vetoes: [], errors: { form, block, review } };
  }
  // 轮次 = 同一份交付改了多少版，不是 runs/ 下有几个用例目录。
  // 数目录会让「一个用例改十版」永远过不了闸门，而「十个用例各改一版」被误杀。
  // 上限优先读 rubric 的 max_rounds（由教授定），没写才用 MAX_ROUNDS。
  const limit = Number(rubric.max_rounds) > 0 ? Number(rubric.max_rounds) : MAX_ROUNDS;
  const src = Number(rubric.max_rounds) > 0 ? 'rubric.max_rounds' : 'MAX_ROUNDS 默认值';
  const maxV = Math.max(0, ...rs.map(N => versions(work, N).length));
  if (maxV > limit) block.push(`同一轮里改了 ${maxV} 版（runs/ 下最多的那轮），超过上限 ${limit} 版（来源：${src}；「不完美不许交」必须有终点）`);

  let last = null;
  for (const N of rs) {
    const r = checkRound(work, N, rubric);
    r.errors.forEach(e => form.push(`runs/${N}: ${e}`));
    last = { N, ...r };
  }

  if (!form.length && last.total !== 100) {
    const bp = path.join(last.dir, 'BLOCKED.md');
    if (!fs.existsSync(bp)) block.push(`runs/${last.N}: 总分 ${last.total} 未达 100，但缺 BLOCKED.md（不许硬凑，也不许直接交）`);
    else {
      const t = fs.readFileSync(bp, 'utf8');
      if (!rubric.dims.some(d => t.includes(String(d.id)))) form.push(`runs/${last.N}/BLOCKED.md: 没写卡在哪一维（要出现某一维的 id）`);
      if (!/\d/.test(t)) form.push(`runs/${last.N}/BLOCKED.md: 没写当前总分`);
      if (t.length < 60) form.push(`runs/${last.N}/BLOCKED.md: 太短，要写清「需要你给什么输入」`);
    }
  }

  if (last.total === 100 && last.lastVs) {
    const want = sha256File(path.join(last.dir, `draft-v${last.lastVs}.md`));
    const rd = path.join(work, 'reviews');
    let found = null;
    if (fs.existsSync(rd)) {
      for (const f of fs.readdirSync(rd)) {
        if (!/^r-\d{5}-[0-9a-f]{8}\.json$/.test(f)) continue;
        let j; try { j = readJson(path.join(rd, f)); } catch { continue; }
        if (String(j.draft_sha256 || '').toLowerCase() === want && j.reviewer && String(j.reviewer) !== 'self') found = f;
      }
    }
    if (!found) review.push(`满分必须有至少一条外部判分记录（reviews/r-NNNNN-<hash8>.json，draft_sha256=${want.slice(0, 16)}…，reviewer 不是 self）——否则那个 100 是自己盖的章`);
  }

  return { rubric, rounds: rs, last, total: last.total, vetoes: last.vetoes, errors: { form, block, review } };
}

function allErrors(r) {
  return [...(r.errors.form || []), ...(r.errors.block || []), ...(r.errors.review || [])];
}

// ---------- 命令 ----------

function cmdRubric(work) {
  const vr = validateRubric(work);
  if (vr.errors.length) {
    console.error('rubric 不合法（教授团队要改的是这个文件）：');
    vr.errors.forEach(e => console.error('  - ' + e));
    process.exit(E.RUBRIC);
  }
  const r = vr.rubric;
  console.log(`rubric 有效：${r.dims.length} 维 / 权重合计 ${r.dims.reduce((a, d) => a + Number(d.weight), 0)} / 否决 ${r.vetoes.length} 条`);
  r.dims.forEach(d => console.log(`  ${d.id} ${d.weight} ${d.name}`));
  process.exit(E.OK);
}

function cmdCheck(work) {
  const r = checkWork(work);
  const all = allErrors(r);
  if (all.length) {
    console.error('check 失败：');
    all.forEach(e => console.error('  - ' + e));
    if (r.rubricErrors) process.exit(E.RUBRIC);
    if ((r.errors.block || []).length) process.exit(E.NO_BLOCK);
    if ((r.errors.form || []).length) process.exit(E.INVALID);
    if ((r.errors.review || []).length) process.exit(E.NO_REVIEW);
    process.exit(E.INVALID);
  }
  console.log(`check 通过：${r.rounds.length} 个轮次，最新总分 ${r.total}，否决 ${r.vetoes.length} 条`);
  process.exit(E.OK);
}

function cmdScore(work, N) {
  const vr = validateRubric(work);
  if (vr.errors.length) die(E.RUBRIC, 'rubric 不合法，先跑 gate rubric <work>');
  const r = checkRound(work, N, vr.rubric);
  if (r.errors.length) {
    console.error('这一轮的判分记录有问题：');
    r.errors.forEach(e => console.error('  - ' + e));
    process.exit(E.INVALID);
  }
  console.log(`runs/${N} 总分 ${r.total}`);
  process.exit(r.total === 100 ? E.OK : E.NOT_100);
}

function cmdReview(work, N, scoresFile) {
  const idx = process.argv.indexOf('--reviewer');
  const reviewer = idx > 0 ? process.argv[idx + 1] : '';
  if (reviewer !== 'self' && !/^[A-Za-z0-9._-]{4,}$/.test(reviewer || '')) {
    die(E.USAGE, `--reviewer 只能是 self 或一个 ≥4 字符不含空格的标识（当前：${reviewer || '空'}）`);
  }
  const vr = validateRubric(work);
  if (vr.errors.length) die(E.RUBRIC, 'rubric 不合法');
  const r = checkRound(work, N, vr.rubric);
  if (r.errors.length) {
    console.error('判分记录不合法，拒绝落记录：');
    r.errors.forEach(e => console.error('  - ' + e));
    process.exit(E.INVALID);
  }
  const dir = path.join(work, 'runs', String(N));
  const draftP = path.join(dir, `draft-v${r.lastVs}.md`);
  const sha = sha256File(draftP);
  const rec = {
    judge_version: 2,
    ts: new Date().toISOString(),
    round: N,
    draft_file: `runs/${N}/draft-v${r.lastVs}.md`,
    draft_sha256: sha,
    reviewer,
    total: r.total,
    dims: JSON.parse(fs.readFileSync(scoresFile, 'utf8')).dims,
  };
  const rd = path.join(work, 'reviews');
  fs.mkdirSync(rd, { recursive: true });
  const name = `r-${String(N).padStart(5, '0')}-${sha.slice(0, 8)}.json`;
  fs.writeFileSync(path.join(rd, name), JSON.stringify(rec, null, 2), 'utf8');
  console.log(`已记录 reviews/${name}  稿 sha256 ${sha.slice(0, 16)}…  reviewer=${reviewer}  总分 ${r.total}`);
  process.exit(r.total === 100 && reviewer !== 'self' ? E.OK : E.NOT_100);
}

function cmdPromote(work) {
  const rs0 = rounds(work);
  if (rs0.length) {
    const lastDir = path.join(work, 'runs', String(rs0[rs0.length - 1]));
    let vh = [];
    const vp = path.join(lastDir, 'veto.json');
    if (fs.existsSync(vp)) {
      try { const vj = readJson(vp); if (Array.isArray(vj.vetoes_hit)) vh = vj.vetoes_hit; } catch { /* check 会报 */ }
    }
    const fd0 = path.join(work, 'final');
    if (vh.length && fs.existsSync(fd0) && fs.readdirSync(fd0).length > 0) {
      console.error(`拒绝放行：命中硬否决 ${vh.join(', ')}，但 final/ 里已经有文件——否决被当成扣分了。`);
      process.exit(E.VETO);
    }
  }

  const r = checkWork(work);
  const all = allErrors(r);
  if (all.length) {
    console.error('拒绝放行：');
    all.forEach(e => console.error('  - ' + e));
    if (r.rubricErrors) process.exit(E.RUBRIC);
    if ((r.errors.block || []).length) process.exit(E.NO_BLOCK);
    if ((r.errors.form || []).length) process.exit(E.INVALID);
    if ((r.errors.review || []).length) process.exit(E.NO_REVIEW);
  }
  if (r.vetoes.length) { console.error(`拒绝放行：命中硬否决 ${r.vetoes.join(', ')}。分数多高都不算。`); process.exit(E.VETO); }
  if (r.total !== 100) { console.error(`拒绝放行：总分 ${r.total}，不是 100。`); process.exit(E.NOT_100); }

  const last = r.last;
  const src = path.join(last.dir, `draft-v${last.lastVs}.md`);
  const fd = path.join(work, 'final');
  fs.mkdirSync(fd, { recursive: true });
  const dst = path.join(fd, path.basename(src));
  fs.copyFileSync(src, dst);
  console.log(`放行 → ${dst}`);
  console.log(`依据：runs/${last.N} 总分 100 · 否决 0 条 · 外部记录已对上稿 sha256 · rubric ${r.rubric.dims.length} 维`);
  process.exit(E.OK);
}

function cmdStatus(work) {
  const vr = validateRubric(work);
  console.log(vr.errors.length ? `rubric: 不合法（${vr.errors.length} 处，先跑 gate rubric）` : `rubric: 有效（${vr.rubric.dims.length} 维）`);
  const rs = rounds(work);
  if (!rs.length) { console.log('runs/: 还没开始'); process.exit(E.OK); }
  for (const N of rs) {
    const r = vr.errors.length ? { errors: [], total: null } : checkRound(work, N, vr.rubric);
    const mark = r.errors.length ? '✗' : (r.total === 100 ? '✓' : '·');
    console.log(`${mark} runs/${N}  总分 ${r.total}  ${versions(work, N).length} 版  否决 ${(r.vetoes || []).length}${r.errors.length ? `  问题 ${r.errors.length} 处` : ''}`);
    if (r.errors.length) r.errors.slice(0, 3).forEach(e => console.log('    - ' + e));
  }
  const f = path.join(work, 'final');
  console.log(fs.existsSync(f) && fs.readdirSync(f).length ? 'final/: 有交付物' : 'final/: 空');
  process.exit(E.OK);
}

function usage() {
  console.log(`dsh-judge-loop gate v2

  gate rubric  <work>                                   校验教授团队的 rubric.json
  gate check   <work>                                   六维结构 + 证据是否成立
  gate score   <work> <N>                               这一轮总分，不满分 exit 3
  gate review  <work> <N> <scores.json> --reviewer <self|ID>
  gate promote <work>                                   只有满分 + 无否决 + 有外部记录才写 final/
  gate status  <work>

目录：
  <work>/rubric.json                 教授团队产出（导师不许写）
  <work>/runs/<N>/task.md            题目与硬约束
  <work>/runs/<N>/draft-v<n>.md      导师的稿
  <work>/runs/<N>/score-v<n>.json    判分（含 quote）
  <work>/runs/<N>/veto.json          {"vetoes_hit": []}
  <work>/runs/<N>/BLOCKED.md         未满分时必须存在
  <work>/reviews/r-<5位>-<hash8>.json
  <work>/final/                      只有 promote 能写

退出码：0 通过 / 2 结构非法 / 3 不满分 / 4 命中否决 / 5 缺外部评审 / 6 轮次超限或缺 BLOCKED / 7 用法错 / 8 rubric 不合法`);
  process.exit(E.USAGE);
}

const [cmd, work, a1, a2] = process.argv.slice(2);
if (!cmd || !work) usage();
switch (cmd) {
  case 'rubric': cmdRubric(work); break;
  case 'check': cmdCheck(work); break;
  case 'score': if (!a1) usage(); cmdScore(work, Number(a1)); break;
  case 'review': if (!a1 || !a2) usage(); cmdReview(work, Number(a1), a2); break;
  case 'promote': cmdPromote(work); break;
  case 'status': cmdStatus(work); break;
  default: usage();
}

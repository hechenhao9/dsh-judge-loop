import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const GATE = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'gate.cjs');

function run(args) {
  const r = spawnSync(process.execPath, [GATE, ...args], { encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

const C1 = '每个结论都要指向一个具名机制，并给出对应文件的路径与行号';
const C2 = '每个数字后面要指出它来自哪个文件的第几行';
const C3 = '至少写出一条什么情况下不适用的边界，并对应素材里一条限制';
const C4 = '全文给出至少一条可以直接复制给别人用的命令或话术';

function rubric(over = {}) {
  return {
    version: 1,
    topic: '测试题',
    professor: { blind: true, basis: '只读 task.md' },
    dims: [
      { id: 'd1', name: '机制', weight: 30, criterion: C1, pass_example: '因为它带前一条的 hash，所以删中间那条就对不上（gate.cjs:296-317）', fail_example: '这套机制设计得很严谨，能有效防止篡改', intent: '防看起来专业但抽一句就没出处的稿', vision: '每句都能反查到源头', evidence: 'quote' },
      { id: 'd2', name: '数字', weight: 25, criterion: C2, pass_example: '281,023 行（精华企业库.csv，185.1 MB）', fail_example: '这个数字大约是二十八万条', intent: '防编数字', vision: '每个数都能翻到', evidence: 'count' },
      { id: 'd3', name: '边界', weight: 25, criterion: C3, pass_example: '只做批次验货，不做工厂审核（PDF 第 1 页 SCOPE）', fail_example: '当然也有局限，要看具体情况', intent: '防只讲好话', vision: '对方读完知道什么不该找我', evidence: 'quote' },
      { id: 'd4', name: '可复用', weight: 20, criterion: C4, pass_example: '把「Worth a 15-minute call?」原句发给对方', fail_example: '建议你多沟通，保持联系', intent: '防读完不知道干什么', vision: '能直接复制去用', evidence: 'artifact' },
    ],
    vetoes: [{ id: 'D1', name: '编造引文或数据', why: '编一条引文可以骗过所有维度，只能用一票否决挡' }],
    ...over,
  };
}

function mkwork(opts = {}) {
  const w = mkdtempSync(join(tmpdir(), 'jl-'));
  const rb = ('rubric' in opts) ? opts.rubric : rubric();
  if (rb) writeFileSync(join(w, 'rubric.json'), JSON.stringify(rb, null, 2));
  const N = opts.round || 1;
  const dir = join(w, 'runs', String(N));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'task.md'), '题目：给一个品牌写 60 秒介绍。硬约束：英文、不超过 160 词。');
  return { w, dir, N };
}

function score(dims, extra = {}) {
  const total = Math.round(dims.reduce((a, d) => a, 0) * 0) || undefined;
  return {
    round: 1,
    total: extra.total ?? sumTotal(dims),
    dims,
    beyond_spec: extra.beyond_spec || [],
    ...extra.rest,
  };
}
function sumTotal(dims) {
  const W = { d1: 30, d2: 25, d3: 25, d4: 20 };
  return Math.round(dims.reduce((a, d) => a + d.score * W[d.id] / 10, 0) * 10) / 10;
}

const DRAFT = [
  '我的机制很简单：因为它每次写入都带前一条的 hash，所以删中间那条就对不上（judge.cjs:296-317）。',
  '数据这边，281,023 行（精华企业库.csv，185.1 MB，38 列），不是三十万也不是二十万。',
  '边界要说清：只做批次验货，不做工厂审核（PDF 第 1 页 SCOPE AND LIMITS 段）。',
  '可以直接用的一句：把「Worth a 15-minute call?」原样发给对方。',
].join('\n');

function fullScores(over = {}) {
  return [
    { id: 'd1', score: 10, quote: '因为它每次写入都带前一条的 hash', deductions: [] },
    { id: 'd2', score: 10, quote: '281,023 行（精华企业库.csv，185.1 MB，38 列）', deductions: [] },
    { id: 'd3', score: 10, quote: '只做批次验货，不做工厂审核', deductions: [] },
    { id: 'd4', score: 10, quote: '把「Worth a 15-minute call?」原样发给对方', deductions: [] },
  ].map(d => ({ ...d, ...(over[d.id] || {}) }));
}

test('缺 rubric 直接 exit 8', () => {
  const { w } = mkwork({ rubric: null });
  assert.equal(run(['rubric', w]).code, 8);
});

test('合法 rubric exit 0', () => {
  const { w } = mkwork();
  const r = run(['rubric', w]);
  assert.equal(r.code, 0, r.out);
});

test('判据写成形容词 exit 8', () => {
  const rb = rubric();
  rb.dims[0].criterion = '内容要有深度，逻辑清晰连贯';
  const { w } = mkwork({ rubric: rb });
  assert.equal(run(['rubric', w]).code, 8);
});

test('pass_example 与 fail_example 相同 exit 8', () => {
  const rb = rubric();
  rb.dims[1].fail_example = rb.dims[1].pass_example;
  const { w } = mkwork({ rubric: rb });
  assert.equal(run(['rubric', w]).code, 8);
});

test('权重合计不是 100 exit 8', () => {
  const rb = rubric();
  rb.dims[0].weight = 25;
  const { w } = mkwork({ rubric: rb });
  assert.equal(run(['rubric', w]).code, 8);
});

test('缺否决 exit 8', () => {
  const rb = rubric({ vetoes: [] });
  const { w } = mkwork({ rubric: rb });
  assert.equal(run(['rubric', w]).code, 8);
});

test('正常一版满分 + 外部记录 → promote 写 final', () => {
  const { w, dir } = mkwork();
  for (const v of [1, 2]) {
    writeFileSync(join(dir, `draft-v${v}.md`), DRAFT);
    writeFileSync(join(dir, `score-v${v}.json`), JSON.stringify(score(fullScores(), {
      beyond_spec: [{ what: '可以直接用的一句', reason: '判据只要求可复用，没说先发给谁，这句省了他一次改写' }],
    }), null, 2));
  }
  let r = run(['check', w]);
  assert.notEqual(r.code, 0, '没有外部记录时不应通过'); // 缺外部记录
  r = run(['review', w, '1', join(dir, 'score-v2.json'), '--reviewer', 'subagent-abc123']);
  assert.equal(r.code, 0, r.out);
  r = run(['promote', w]);
  assert.equal(r.code, 0, r.out);
  assert.ok(existsSync(join(w, 'final', 'draft-v2.md')));
});

test('quote 在稿里找不到 exit 2', () => {
  const { w, dir } = mkwork();
  writeFileSync(join(dir, 'draft-v1.md'), DRAFT);
  writeFileSync(join(dir, 'draft-v2.md'), DRAFT);
  const ds = fullScores({ d2: { quote: '这段话在稿里根本不存在吧' } });
  writeFileSync(join(dir, 'score-v1.json'), JSON.stringify(score(ds)));
  writeFileSync(join(dir, 'score-v2.json'), JSON.stringify(score(ds)));
  const r = run(['check', w]);
  assert.equal(r.code, 2, r.out);
});

test('扣分写成形容词 exit 2', () => {
  const { w, dir } = mkwork();
  writeFileSync(join(dir, 'draft-v1.md'), DRAFT);
  writeFileSync(join(dir, 'draft-v2.md'), DRAFT);
  const ds = fullScores({ d2: { score: 7, deductions: [{ fix: '数字部分深度不足，可以更清楚' }] } });
  writeFileSync(join(dir, 'score-v1.json'), JSON.stringify(score(ds)));
  writeFileSync(join(dir, 'score-v2.json'), JSON.stringify(score(ds)));
  const r = run(['check', w]);
  assert.equal(r.code, 2, r.out);
});

test('分数给了 9 分 exit 2', () => {
  const { w, dir } = mkwork();
  writeFileSync(join(dir, 'draft-v1.md'), DRAFT);
  writeFileSync(join(dir, 'draft-v2.md'), DRAFT);
  const ds = fullScores({ d3: { score: 9 } });
  writeFileSync(join(dir, 'score-v1.json'), JSON.stringify(score(ds)));
  writeFileSync(join(dir, 'score-v2.json'), JSON.stringify(score(ds)));
  assert.equal(run(['check', w]).code, 2);
});

test('total 与 rubric 重算不符 exit 2', () => {
  const { w, dir } = mkwork();
  writeFileSync(join(dir, 'draft-v1.md'), DRAFT);
  writeFileSync(join(dir, 'draft-v2.md'), DRAFT);
  const ds = fullScores({ d2: { score: 7 } });
  writeFileSync(join(dir, 'score-v1.json'), JSON.stringify(score(ds, { total: 100 })));
  writeFileSync(join(dir, 'score-v2.json'), JSON.stringify(score(ds, { total: 100 })));
  assert.equal(run(['check', w]).code, 2);
});

test('满分缺 beyond_spec exit 2', () => {
  const { w, dir } = mkwork();
  writeFileSync(join(dir, 'draft-v1.md'), DRAFT);
  writeFileSync(join(dir, 'draft-v2.md'), DRAFT);
  const ds = fullScores();
  writeFileSync(join(dir, 'score-v1.json'), JSON.stringify(score(ds)));
  writeFileSync(join(dir, 'score-v2.json'), JSON.stringify(score(ds)));
  assert.equal(run(['check', w]).code, 2);
});

test('未满分缺 BLOCKED exit 6', () => {
  const { w, dir } = mkwork();
  writeFileSync(join(dir, 'draft-v1.md'), DRAFT);
  writeFileSync(join(dir, 'draft-v2.md'), DRAFT);
  const ds = fullScores({ d2: { score: 7, deductions: [{ fix: '把 draft-v2.md:2 的「281,023 行（精华企业库.csv，185.1 MB，38 列）」改成「281,023 行（精华企业库.csv）」' }] } });
  writeFileSync(join(dir, 'score-v1.json'), JSON.stringify(score(ds)));
  writeFileSync(join(dir, 'score-v2.json'), JSON.stringify(score(ds)));
  const r = run(['promote', w]);
  assert.equal(r.code, 6, r.out);
});

test('未满分有 BLOCKED 也不许 promote（exit 3）', () => {
  const { w, dir } = mkwork();
  writeFileSync(join(dir, 'draft-v1.md'), DRAFT);
  writeFileSync(join(dir, 'draft-v2.md'), DRAFT);
  const ds = fullScores({ d2: { score: 7, deductions: [{ fix: '把 draft-v2.md:2 的「281,023 行（精华企业库.csv，185.1 MB，38 列）」改成「281,023 行（精华企业库.csv）」' }] } });
  writeFileSync(join(dir, 'score-v1.json'), JSON.stringify(score(ds)));
  writeFileSync(join(dir, 'score-v2.json'), JSON.stringify(score(ds)));
  writeFileSync(join(dir, 'BLOCKED.md'), '# 卡在 d2\n当前总分：92.5\n缺什么：素材里没有更细的字段\n需要你给什么：一份含字段说明的文件\n你不给时我停在 draft-v2.md');
  const r = run(['promote', w]);
  assert.equal(r.code, 3, r.out);
});

test('只有一版稿 exit 2', () => {
  const { w, dir } = mkwork();
  writeFileSync(join(dir, 'draft-v1.md'), DRAFT);
  writeFileSync(join(dir, 'score-v1.json'), JSON.stringify(score(fullScores(), {
    beyond_spec: [{ what: '可以直接用的一句', reason: '判据只要求可复用，没说先发给谁，这句省了他一次改写' }],
  })));
  assert.equal(run(['check', w]).code, 2);
});

test('命中否决且 final 里有文件 exit 4', () => {
  const { w, dir } = mkwork();
  writeFileSync(join(dir, 'draft-v1.md'), DRAFT);
  writeFileSync(join(dir, 'draft-v2.md'), DRAFT);
  writeFileSync(join(dir, 'score-v1.json'), JSON.stringify(score(fullScores(), { beyond_spec: [{ what: '可以直接用的一句', reason: '判据只要求可复用，没说先发给谁，这句省了他一次改写' }] })));
  writeFileSync(join(dir, 'score-v2.json'), JSON.stringify(score(fullScores(), { beyond_spec: [{ what: '可以直接用的一句', reason: '判据只要求可复用，没说先发给谁，这句省了他一次改写' }] })));
  writeFileSync(join(dir, 'veto.json'), JSON.stringify({ vetoes_hit: ['D1'] }));
  mkdirSync(join(w, 'final'), { recursive: true });
  writeFileSync(join(w, 'final', 'draft-v2.md'), DRAFT);
  const r = run(['promote', w]);
  assert.equal(r.code, 4, r.out);
});

test('未知否决编号 exit 2', () => {
  const { w, dir } = mkwork();
  writeFileSync(join(dir, 'draft-v1.md'), DRAFT);
  writeFileSync(join(dir, 'draft-v2.md'), DRAFT);
  writeFileSync(join(dir, 'score-v1.json'), JSON.stringify(score(fullScores(), { beyond_spec: [{ what: '可以直接用的一句', reason: '判据只要求可复用，没说先发给谁，这句省了他一次改写' }] })));
  writeFileSync(join(dir, 'score-v2.json'), JSON.stringify(score(fullScores(), { beyond_spec: [{ what: '可以直接用的一句', reason: '判据只要求可复用，没说先发给谁，这句省了他一次改写' }] })));
  writeFileSync(join(dir, 'veto.json'), JSON.stringify({ vetoes_hit: ['D9'] }));
  assert.equal(run(['check', w]).code, 2);
});

test('同一轮里改了 6 版 exit 6（轮次数的是版本，不是 runs/ 下的目录数）', () => {
  const { w, dir } = mkwork();
  const bs = { beyond_spec: [{ what: '可以直接用的一句', reason: '判据只要求可复用，没说先发给谁，这句省了他一次改写' }] };
  for (let v = 1; v <= 6; v++) {
    writeFileSync(join(dir, `draft-v${v}.md`), DRAFT);
    writeFileSync(join(dir, `score-v${v}.json`), JSON.stringify(score(fullScores(), bs)));
  }
  assert.equal(run(['check', w]).code, 6);
});

test('多个 runs/ 目录各改两版不算轮次超限', () => {
  const { w } = mkwork();
  const bs = { beyond_spec: [{ what: '可以直接用的一句', reason: '判据只要求可复用，没说先发给谁，这句省了他一次改写' }] };
  for (let n = 1; n <= 6; n++) {
    const d = join(w, 'runs', String(n));
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, 'task.md'), 'x');
    writeFileSync(join(d, 'draft-v1.md'), DRAFT);
    writeFileSync(join(d, 'draft-v2.md'), DRAFT);
    writeFileSync(join(d, 'score-v1.json'), JSON.stringify(score(fullScores(), bs)));
    writeFileSync(join(d, 'score-v2.json'), JSON.stringify(score(fullScores(), bs)));
  }
  assert.notEqual(run(['check', w]).code, 6, '六个用例各两版，不该被当成六轮');
});

test('reviewer 写 self 不给满分通过', () => {
  const { w, dir } = mkwork();
  writeFileSync(join(dir, 'draft-v1.md'), DRAFT);
  writeFileSync(join(dir, 'draft-v2.md'), DRAFT);
  const s = score(fullScores(), { beyond_spec: [{ what: '可以直接用的一句', reason: '判据只要求可复用，没说先发给谁，这句省了他一次改写' }] });
  writeFileSync(join(dir, 'score-v1.json'), JSON.stringify(s));
  writeFileSync(join(dir, 'score-v2.json'), JSON.stringify(s));
  const r = run(['review', w, '1', join(dir, 'score-v2.json'), '--reviewer', 'self']);
  assert.equal(r.code, 3, r.out);
});

test('缺外部记录时 promote 不给过', () => {
  const { w, dir } = mkwork();
  writeFileSync(join(dir, 'draft-v1.md'), DRAFT);
  writeFileSync(join(dir, 'draft-v2.md'), DRAFT);
  const s = score(fullScores(), { beyond_spec: [{ what: '可以直接用的一句', reason: '判据只要求可复用，没说先发给谁，这句省了他一次改写' }] });
  writeFileSync(join(dir, 'score-v1.json'), JSON.stringify(s));
  writeFileSync(join(dir, 'score-v2.json'), JSON.stringify(s));
  const r = run(['promote', w]);
  assert.notEqual(r.code, 0, r.out);
  assert.ok(!existsSync(join(w, 'final', 'draft-v2.md')));
});

#!/usr/bin/env node
/**
 * 一键演示：造一个最小工程，走完 rubric → 自评 → 外部判分 → 放行。
 * 只用于让人看清命令长什么样，不是真实评分。
 *
 *   node test/e2e-demo.mjs
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const GATE = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'gate.cjs');
const NODE = process.execPath;

function gate(args) {
  const r = spawnSync(NODE, [GATE, ...args], { encoding: 'utf8' });
  const out = ((r.stdout || '') + (r.stderr || '')).trim();
  console.log(`\n$ gate ${args.join(' ')}\n${out ? out.split('\n').map(l => '  ' + l).join('\n') : '  (no output)'}\n  exit=${r.status}`);
  return r.status;
}

const W = mkdtempSync(join(tmpdir(), 'jl-demo-'));
const R = join(W, 'runs', '1');
mkdirSync(R, { recursive: true });

const rubric = {
  version: 1,
  topic: '给采购方写一段能直接念的英文介绍',
  professor: { blind: true, basis: '只读了 task.md 与素材清单，未读任何稿' },
  dims: [
    { id: 'd1', name: '机制说清', weight: 30,
      criterion: '每个卖点后面要跟一个能点开的素材文件路径与行号',
      pass_example: '拼柜与物流优化（01_定位与定价.md:12）',
      fail_example: '我们提供一站式供应链解决方案',
      intent: '防那种听起来很全、抽一句就找不到出处的稿', vision: '每句都能反查到源头', evidence: 'quote' },
    { id: 'd2', name: '数字有出处', weight: 25,
      criterion: '每个数字后面要指出它来自哪个文件的第几行',
      pass_example: '时薪低于 $80 的单不接（01_定位与定价.md:39）',
      fail_example: '我们服务过上百家客户',
      intent: '防编数字', vision: '每个数都能翻到', evidence: 'count' },
    { id: 'd3', name: '边界说清', weight: 25,
      criterion: '至少写出一条什么情况下不适用，并对应素材里一条限制',
      pass_example: '不做纯比价，也不接仿牌（06_coaching/03_接单决策树.md:58）',
      fail_example: '当然我们也有需要改进的地方',
      intent: '防只讲好话', vision: '对方读完知道什么不该找我', evidence: 'quote' },
    { id: 'd4', name: '可直接用', weight: 20,
      criterion: '至少给出一条能原样复制发出去的话或命令',
      pass_example: '把「Worth a 15-minute call?」原样发给对方（03_话术库.md:25）',
      fail_example: '建议保持沟通，及时跟进',
      intent: '防读完不知道下一步做什么', vision: '复制就能发', evidence: 'artifact' },
  ],
  vetoes: [
    { id: 'D1', name: '编造引文或数据', why: '编一条引文能骗过所有打分维度，只能用一票否决挡' },
    { id: 'D2', name: '越过闸门交付', why: '没满分的稿一旦发出去，前面所有检查都白做' },
  ],
};
writeFileSync(join(W, 'rubric.json'), JSON.stringify(rubric, null, 2));
writeFileSync(join(R, 'task.md'), '题目：给去 Expo 的采购方写一段 60 秒英文介绍。\n硬约束：英文、约 60 秒、每个数字要有出处。');

const draftV1 = [
  '我们提供一站式的供应链解决方案，覆盖从选厂到出货的每一个环节。',
  '我们有丰富的行业经验和专业的团队，服务过上百家客户。',
  '当然我们也有需要改进的地方，会持续优化。',
  '建议保持沟通，及时跟进。',
].join('\n');

const draftV2 = [
  'Four things I do: factory shortlisting, payment staging, pre-shipment inspection, and consolidation.',
  'The fourth one is consolidation and freight optimisation (sourcing_agent/01_playbook/01_定位与定价.md:12).',
  'I turn down anything under $80 an hour (sourcing_agent/01_playbook/01_定位与定价.md:39).',
  'I do not do pure price shopping, and I do not touch counterfeit goods (sourcing_agent/06_coaching/03_接单决策树.md:58).',
  'If that fits, the sentence to send me is: "Worth a 15-minute call?" (sourcing_agent/01_playbook/03_话术库.md:25)',
].join('\n');

writeFileSync(join(R, 'draft-v1.md'), draftV1);
writeFileSync(join(R, 'draft-v2.md'), draftV2);

const full = [
  { id: 'd1', score: 10, quote: 'consolidation and freight optimisation (sourcing_agent/01_playbook/01_定位与定价.md:12)', deductions: [] },
  { id: 'd2', score: 10, quote: 'anything under $80 an hour (sourcing_agent/01_playbook/01_定位与定价.md:39)', deductions: [] },
  { id: 'd3', score: 10, quote: 'I do not do pure price shopping, and I do not touch counterfeit goods', deductions: [] },
  { id: 'd4', score: 10, quote: '"Worth a 15-minute call?"', deductions: [] },
];
const weak = [
  { id: 'd1', score: 7, quote: '我们提供一站式的供应链解决方案', deductions: [
    { fix: '把 draft-v1.md:1 的「我们提供一站式的供应链解决方案，覆盖从选厂到出货的每一个环节。」改成「Four things I do: factory shortlisting, payment staging, pre-shipment inspection, and consolidation.」' }] },
  { id: 'd2', score: 4, quote: '我们有丰富的行业经验和专业的团队，服务过上百家客户。', deductions: [
    { fix: '把 draft-v1.md:2 的「我们有丰富的行业经验和专业的团队，服务过上百家客户。」改成「I turn down anything under $80 an hour (sourcing_agent/01_playbook/01_定位与定价.md:39).」' }] },
  { id: 'd3', score: 4, quote: '当然我们也有需要改进的地方，会持续优化。', deductions: [
    { fix: '把 draft-v1.md:3 的「当然我们也有需要改进的地方，会持续优化。」改成「I do not do pure price shopping, and I do not touch counterfeit goods (sourcing_agent/06_coaching/03_接单决策树.md:58).」' }] },
  { id: 'd4', score: 4, quote: '建议保持沟通，及时跟进。', deductions: [
    { fix: '把 draft-v1.md:4 的「建议保持沟通，及时跟进。」改成「If that fits, the sentence to send me is: "Worth a 15-minute call?"」' }] },
];
const W_ = { d1: 30, d2: 25, d3: 25, d4: 20 };
const total = dims => Math.round(dims.reduce((a, d) => a + d.score * W_[d.id] / 10, 0) * 10) / 10;

writeFileSync(join(R, 'score-v1.json'), JSON.stringify({ round: 1, total: total(weak), dims: weak, beyond_spec: [] }, null, 2));
writeFileSync(join(R, 'score-v2.json'), JSON.stringify({
  round: 2, total: 100, dims: full,
  beyond_spec: [{ what: 'Worth a 15-minute call?', reason: '判据只要求可复用的句子，没说先发哪一句；给他这一句省掉一次改写' }],
}, null, 2));
writeFileSync(join(R, 'veto.json'), JSON.stringify({ vetoes_hit: [] }));

console.log(`工作目录：${W}`);
gate(['status', W]);
gate(['rubric', W]);
gate(['check', W]);
console.log('  ↑ exit=5 是「满分但还没有外部判分记录」，这正是它要拦的东西\n');
gate(['review', W, '1', join(R, 'score-v2.json'), '--reviewer', 'subagent-demo0001']);
gate(['promote', W]);

const fin = join(W, 'final');
console.log(`final/ 内容：${existsSync(fin) ? readFileSync(join(fin, 'draft-v2.md'), 'utf8').split('\n').length + ' 行' : '空（不该为空）'}`);
console.log('\n演示结束。真实用法见 README：教授先出 rubric，导师再写稿。');

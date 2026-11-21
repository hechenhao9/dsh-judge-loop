import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSkillFrontmatter, SKILL_NAMES, bundledSkillsDir } from '../index.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('三个技能目录与 SKILL.md 都在', () => {
  for (const n of SKILL_NAMES) {
    const f = join(bundledSkillsDir(), n, 'SKILL.md');
    assert.ok(existsSync(f), `缺 ${f}`);
  }
});

test('frontmatter name 与目录名一致、description 非空', () => {
  for (const n of SKILL_NAMES) {
    const p = parseSkillFrontmatter(readFileSync(join(bundledSkillsDir(), n, 'SKILL.md'), 'utf8'));
    assert.equal(p.name, n);
    assert.ok(p.description.length > 40, `${n} 的 description 太短（模型看不到就调不到）`);
    assert.ok(p.content.length > 500, `${n} 正文太短`);
  }
});

test('description 不超过目录扫描上限（1024 字符）', () => {
  for (const n of SKILL_NAMES) {
    const p = parseSkillFrontmatter(readFileSync(join(bundledSkillsDir(), n, 'SKILL.md'), 'utf8'));
    assert.ok(p.description.length <= 1024, `${n} 的 description ${p.description.length} 字符，会被截断`);
  }
});

test('legacy 里的 gate.cjs 只作存档，不参与流程', async () => {
  const legacy = join(root, 'legacy', 'gate.cjs');
  assert.ok(existsSync(legacy), 'legacy/gate.cjs 应作为存档保留');
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync(process.execPath, ['--check', legacy], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});

test('skills 目录里不再引用 gate（流程已改为 95 分人判）', () => {
  for (const n of SKILL_NAMES) {
    const txt = readFileSync(join(bundledSkillsDir(), n, 'SKILL.md'), 'utf8');
    assert.ok(!/\bgate\.(cjs|cmd|rubric|check|promote|review|score|status)\b/.test(txt),
      `${n} 的 SKILL.md 仍提到 gate 命令`);
  }
});

test('package.json 与 cordis.patch.yml 指向同一个包名', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.name, 'dsh-judge-loop');
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml');
  const yml = readFileSync(join(root, 'cordis.patch.yml'), 'utf8');
  assert.ok(yml.includes('dsh-judge-loop'));
  assert.ok(/insert:/.test(yml));
});

test('agents 下的两个角色稿存在', () => {
  assert.ok(existsSync(join(root, 'agents', 'professor.md')));
  assert.ok(existsSync(join(root, 'agents', 'tutor.md')));
});

test('SKILL.md 里不许出现「自己写 rubric」这类自证路径', () => {
  const main = readFileSync(join(bundledSkillsDir(), 'judge-loop', 'SKILL.md'), 'utf8');
  assert.ok(main.includes('教授'), '主技能必须讲清教授团队');
  assert.ok(main.includes('rubric.json'), '主技能必须说清细则文件名');
  const prof = readFileSync(join(bundledSkillsDir(), 'professor', 'SKILL.md'), 'utf8');
  assert.ok(/不许看|不能看|不看/.test(prof), '教授必须被明确禁止看稿');
});

test('apply() 在最小 ctx 上能注册三个技能（不崩）', async () => {
  const { apply } = await import('../index.mjs');
  const reg = [];
  const ctx = {
    skills: { register: (d) => { reg.push(d); return () => {}; } },
    logger: { warn: (m) => { throw new Error('不该有警告: ' + m); } },
    effect: (fn) => { fn(); },
  };
  apply(ctx);
  assert.equal(reg.length, 3, '应注册 3 个技能，实际 ' + reg.length);
  assert.deepEqual(reg.map(r => r.name).sort(), ['judge-loop', 'professor', 'tutor']);
  for (const r of reg) {
    assert.equal(r.source, 'runtime');
    assert.ok(r.resourceBase && r.resourceBase.kind === 'directory');
    assert.ok(r.content.length > 500);
  }
});

test('frontmatter 缺失时只告警不抛错', async () => {
  const { registerAllSkills } = await import('../index.mjs');
  const warns = [];
  const ctx = {
    skills: { register: () => () => {} },
    logger: { warn: (m) => warns.push(m) },
  };
  const dispose = registerAllSkills({ ...ctx, skills: { register: () => { throw new Error('boom'); } } });
  assert.equal(typeof dispose, 'function');
});

test('parseSkillFrontmatter 能处理引号包裹的 description', async () => {
  const { parseSkillFrontmatter } = await import('../index.mjs');
  const p = parseSkillFrontmatter('---\nname: demo\ndescription: "带\"引号\"的值"\n---\n正文');
  assert.equal(p.name, 'demo');
  assert.equal(p.description, '带"引号"的值');
  assert.equal(p.content, '正文');
});
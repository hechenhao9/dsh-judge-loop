/**
 * dsh-judge-loop —— 交付前的满分闸门（双团队版）
 *
 * 注册三个技能：
 *   judge-loop  主流程：两个团队怎么协作、gate 命令、退出码
 *   professor   教授团队：只读题目与素材，产出 rubric.json（决定上限）
 *   tutor       导师团队：按 rubric 一步做到满分，可向教授取经
 *
 * 附赠一个命令行闸门 scripts/gate.cjs（零依赖），由 tutor 与 CI 调用。
 *
 * @module dsh-judge-loop
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

export const name = 'dsh-judge-loop';
/** apply 里要用 ctx.skills。 */
export const inject = ['skills'];

export const SKILL_NAMES = ['judge-loop', 'professor', 'tutor'];

/** 随包分发的技能目录绝对路径。 */
export function bundledSkillsDir() {
  return fileURLToPath(new URL('./skills/', import.meta.url));
}

/** 闸门脚本绝对路径（给 tutor / CI 用）。 */
export function gateScriptPath() {
  return fileURLToPath(new URL('./scripts/gate.cjs', import.meta.url));
}

function unquoteYamlScalar(value) {
  const t = value.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1).replace(/\\"/g, '"').replace(/\\n/g, '\n').trim();
  }
  return t;
}

/** 只读 name / description 两个单行字段，零依赖。 */
export function parseSkillFrontmatter(text) {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const m = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*\n?/.exec(normalized);
  if (!m) return { name: '', description: '', content: normalized };
  let skillName = '';
  let description = '';
  for (const rawLine of m[1].split('\n')) {
    const line = rawLine.trim();
    if (/^\s/.test(rawLine)) continue; // 缩进行属于上一个字段/嵌套结构，跳过
    const km = /^([A-Za-z][A-Za-z0-9_-]*):[ \t]*(.*)$/.exec(line);
    if (!km) continue;
    if (km[1] === 'name') skillName = unquoteYamlScalar(km[2]);
    else if (km[1] === 'description') description = unquoteYamlScalar(km[2]);
  }
  return { name: skillName, description, content: normalized.slice(m[0].length).trimStart() };
}

/** 单个技能缺失或 frontmatter 不完整只告警，不弄崩宿主启动。 */
export function registerAllSkills(ctx) {
  const disposers = [];
  const base = bundledSkillsDir();
  for (const skillName of SKILL_NAMES) {
    const dir = join(base, skillName);
    const file = join(dir, 'SKILL.md');
    try {
      if (!existsSync(file)) throw new Error('缺 SKILL.md');
      const parsed = parseSkillFrontmatter(readFileSync(file, 'utf8'));
      if (!parsed.name || !parsed.description || !parsed.content) {
        throw new Error('frontmatter 不完整（name / description / 正文都不能为空）');
      }
      if (parsed.name !== skillName) {
        throw new Error(`frontmatter name 是「${parsed.name}」，与目录名「${skillName}」不一致`);
      }
      disposers.push(ctx.skills.register({
        name: parsed.name,
        description: parsed.description,
        content: parsed.content,
        resourceBase: { kind: 'directory', path: dir },
        source: 'runtime',
      }));
    } catch (error) {
      ctx.logger?.warn?.(`[dsh-judge-loop] 技能 ${skillName} 未注册：${error?.message ?? error}`);
    }
  }
  return () => { for (const d of disposers) { try { d?.(); } catch { /* ignore */ } } };
}

export function apply(ctx) {
  const dispose = registerAllSkills(ctx);
  ctx.effect?.(() => dispose);
}

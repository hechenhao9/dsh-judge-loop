#!/usr/bin/env node
/**
 * wc-v1 —— rubric.json 里 conventions.wc_v1 的唯一参考实现
 *
 * 用法：
 *   node wc-v1.cjs <file>           打印整数词数
 *   node wc-v1.cjs <file> --tokens  打印整数 + 逐个 token（用于复核争议处）
 *
 * 五步（与 rubric 判据逐条对应，改这里就必须同步改 rubric.json 的 conventions.wc_v1.steps）：
 *   1. 每一处 `//` 替换为一个空格
 *   2. `-` U+002D / `/` U+002F / `–` U+2013 / `—` U+2014 各替换为一个空格
 *   3. 按任意空白切分，丢空串
 *   4. 丢弃只由 Markdown 装饰符组成的 token（^[#*_`|>~]+$）
 *   5. 剩余 token 个数即词数（整数，不四舍五入、不写"约"）
 */
'use strict';
const fs = require('fs');

const file = process.argv[2];
const showTokens = process.argv.includes('--tokens');
if (!file || file === '--help' || file === '-h') {
  console.log('用法: node wc-v1.cjs <file> [--tokens]');
  console.log('五步: ' + '①`//`→空格 ②[-/–—]→空格 ③按空白切分去空串 ④丢纯装饰符 token ⑤取长度');
  console.log('样例: landed-cost→2  end-to-end→3  8–15%→2  $900–$2,500→2  **free**→1');
  process.exit(file ? 0 : 7);
}

const src = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');

const step1 = src.split('//').join(' ');
const step2 = step1.replace(/[-/\u2013\u2014]/g, ' ');
const step3 = step2.split(/\s+/).filter(Boolean);
const step4 = step3.filter(t => !/^[#*_`|>~]+$/.test(t));

if (showTokens) {
  step4.forEach((t, i) => console.log(String(i + 1).padStart(4, ' ') + '  ' + JSON.stringify(t)));
  console.log('---');
}
console.log(step4.length);
process.exit(0);

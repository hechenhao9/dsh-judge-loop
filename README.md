# dsh-judge-loop

**交付前的满分闸门（双团队版）** —— 给 DeepSeek Harness 用的技能插件。

一份答案能到多少分，上限在**评分细则**，不在写的人。所以这里把它拆成两个互不隶属的角色：

| 团队 | 干什么 | 不许干什么 |
|---|---|---|
| **教授**（`professor`） | 只读题目与素材，产出 `rubric.json`。这一份决定作品上限 | 不许看导师写的任何一版稿 |
| **导师**（`tutor`） | 按 `rubric.json` 一步做到满分，可向教授取经 | 不许改 `rubric.json`，不许自己造判据 |

`gate.cjs` 是那个不安慰人的裁判：它只认文件、哈希、退出码，不认「我已经做到了」。

> 为什么必须有「不看稿」这条：如果细则作者看过稿，他会不自觉地把稿的特征抄成判据——出题人和考生变成同一个人，那个 100 分就没有意义。这是 v1 失败的唯一原因，也是本插件存在的理由。

## 安装

```bash
# GitHub 直装
dsh plugin --profile web add https://github.com/<you>/dsh-judge-loop

# 本地目录
dsh plugin --profile web add /path/to/dsh-judge-loop
```

装完重启 DSH。三个技能出现在技能目录：

- `judge-loop`：主流程（两个团队怎么协作、命令、退出码、这套东西堵不住什么）
- `professor`：怎么定细则
- `tutor`：怎么做到满分

不需要任何账号、密钥或网络。

## 在新对话里怎么启动

装完重启后，**任意一个对话**里都有三条路能把它叫起来：

| 启动方式 | 效果 |
|---|---|
| `/judge-loop` | 走完整流程：教授定细则 → 导师做到满分 → 外部判分 → 放行 |
| `/professor` | 只要细则。已经有稿子想反查标准、或者想先知道「什么样叫满分」时用 |
| `/tutor` | 只要作品。`rubric.json` 已经在手上时用 |

不记得命令也行——说「评委」「满分」「这答案能交吗」「按细则改到满分」，同样会进 `judge-loop`；这三句写在技能描述里，属于触发词。

第一次进某个工作目录时，先跑一次：

```bash
node scripts/gate.cjs status <work>
```

它会告诉你三件事：尺子有没有、改到第几版、`final/` 里有没有东西。`<work>` 是你给这次交付新建的目录，`rubric.json`、`runs/`、`final/` 都会长在里面。

## 三步用起来

### 1. 让教授出细则

派一个 subagent，系统提示词用 `agents/professor.md`，用户消息里只放：

- 题面（用户原话，一字不改）
- 素材路径清单
- 硬约束（字数、语言、交付形态）

**不给它任何稿子。** 它产出 `<work>/rubric.json`，然后：

```bash
node scripts/gate.cjs rubric <work>
```

`exit 8` 就把报的每一条改掉——**别带着坏尺子往下走**。

### 2. 让导师写

派另一个 subagent，系统提示词用 `agents/tutor.md`，给它题面、素材、`rubric.json`。它：

1. 把每条判据翻译成「稿里必须出现的那一句」
2. 先造证据句，再连成文
3. 自评 `score-v1.json`（只给 0/4/7/10，每维 quote 逐字命中）
4. 改出 `draft-v2.md`（至少删一处）
5. 满分要带 `beyond_spec`

遇到读不懂的判据，它可以问教授**初衷与愿景**——不许问「怎么写才能满分」。

### 3. 外部判分 + 放行

```bash
node scripts/gate.cjs review <work> 2 runs/2/score-v2.json --reviewer subagent-<id>
node scripts/gate.cjs promote <work>
```

`promote` 非 0 就不许交；0 才写 `final/`。

## 命令

```
gate rubric  <work>                                  校验 rubric.json
gate check   <work>                                  整份工程是否成立
gate score   <work> <N>                              这一轮总分
gate review  <work> <N> <scores.json> --reviewer <self|ID>
gate promote <work>                                  满分 + 无否决 + 有外部记录才写 final/
gate status  <work>                                  一屏看进度
```

Windows 用 `scripts\gate.cmd`（纯 ASCII，三级 node 回退）。**不要加管道**——`| more` 会把退出码吞成 0。

| 退出码 | 含义 |
|---|---|
| 0 | 通过 |
| 2 | 结构或判分记录非法（quote 没命中、扣分写成形容词、分数给了 9、total 与重算不符…） |
| 3 | 不满分 |
| 4 | 命中硬否决 |
| 5 | 满分但缺外部判分记录 |
| 6 | 轮次超限，或未满分却没写 `BLOCKED.md` |
| 7 | 用法错 |
| 8 | rubric 不合法（判据空话、权重不齐、缺否决…） |

## 目录约定

```
<work>/
  rubric.json                     教授产出（导师不许改）
  runs/<N>/
    task.md                       题目原文 + 用户硬约束
    draft-v1.md / score-v1.json    初稿与自评
    draft-v2.md / score-v2.json    改后稿与复评
    veto.json                     {"vetoes_hit": []}
    BLOCKED.md                    未满分时必须存在
  reviews/r-00001-<hash8>.json    外部判分记录
  final/                          只有 gate promote 能写
```

## rubric.json

```json
{
  "version": 1,
  "topic": "一句话题目",
  "professor": { "blind": true, "basis": "只读了 task.md 与素材清单" },
  "dims": [
    {
      "id": "d1", "name": "机制说清", "weight": 30,
      "criterion": "每个结论都要指向一个具名机制，并给出对应文件的路径与行号",
      "pass_example": "因为它每次写入都带前一条的 hash，所以删中间那条就对不上（gate.cjs:296-317）",
      "fail_example": "这套机制设计得很严谨，能有效防止篡改",
      "intent": "防那种读起来很专业、但抽一句就发现没出处的稿",
      "vision": "满分稿读完，任何一句都能被反查到源头",
      "evidence": "quote"
    }
  ],
  "vetoes": [
    { "id": "D1", "name": "编造引文或数据", "why": "编一条引文可以骗过所有打分维度，只能用一票否决挡" }
  ]
}
```

脚本会逐条判：4–6 维、每维 10–30、合计 100、`criterion` ≥12 字且含可抽查对象、`pass_example`/`fail_example` 各 ≥8 字且不同、`vetoes` ≥1 条且 `why` ≥10 字。

## 判分记录

```json
{
  "round": 2,
  "total": 100,
  "dims": [
    { "id": "d1", "score": 10, "quote": "稿里逐字存在的 ≥12 字段落", "deductions": [] },
    { "id": "d2", "score": 7, "quote": "…",
      "deductions": [
        { "fix": "把 draft-v2.md:2 的「281,023 行（精华企业库.csv，185.1 MB）」改成「281,023 行（精华企业库.csv，185.1 MB，38 列）」" }
      ] }
  ],
  "beyond_spec": [
    { "what": "可以直接用的一句", "reason": "判据只要求可复用，没说先发给谁，这句省了他一次改写" }
  ]
}
```

## 这套东西堵不住什么

| 缺口 | 现状 |
|---|---|
| 教授也是模型 | 它的「专业性」靠两件事：没看过稿 + 判据必须可抽查。不靠它真当过评委 |
| 教授与导师可能价值观趋同 | 只靠「不许看稿」和「reviewer 不是 self」两道 |
| `rubric.json` 可被手改 | 改了之后旧 `score-*.json` 的 `quote` 与 `total` 立刻对不上，exit 2 |
| 高分 ≠ 真实好评 | 判据只覆盖抽得出来的东西；`beyond_spec` 逼一条判据外的增量，最终仍要人看 |

## 开发

```bash
npm test                 # 27 个用例：技能契约 + 闸门行为
node --test "test/*.test.mjs"
```

发布到 GitHub 前要改的只有 `package.json` 里的 `repository` / `homepage` / `author`。

```bash
git init && git add -A && git commit -m "feat: dsh-judge-loop v2"
gh repo create dsh-judge-loop --public --source=. --push
```

## License

MIT

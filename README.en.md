# dsh-judge-loop

**A pre-delivery perfect-score gate (two-team edition)** for DeepSeek Harness.

How good an answer can get is decided by the **rubric**, not by the writer. So the work is split into two independent roles:

| Team | Does | Must not |
|---|---|---|
| **Professor** (`professor`) | Reads only the task and source material, writes `rubric.json`. This sets the ceiling | Must not read any draft written by the tutor |
| **Tutor** (`tutor`) | Meets the rubric in one pass, may ask the professor for intent/vision | Must not edit `rubric.json`, must not invent criteria |

`gate.cjs` is the referee that does not console you: it only believes files, hashes and exit codes.

> Why "blind to the draft" is mandatory: a rubric author who has seen the draft will copy the draft's features into the criteria. Then the examiner and the examinee are the same person, and the 100 means nothing. That was the single reason v1 failed.

## Install

```bash
dsh plugin --profile web add https://github.com/<you>/dsh-judge-loop
# or a local directory
dsh plugin --profile web add /path/to/dsh-judge-loop
```

Restart DSH. Three skills appear: `judge-loop`, `professor`, `tutor`. No account, key or network needed.

## Use

1. Spawn a subagent with `agents/professor.md` as its system prompt; give it only the task, the source list and the hard constraints. It writes `<work>/rubric.json`.
2. `node scripts/gate.cjs rubric <work>` — exit 8 means fix the rubric first.
3. Spawn another subagent with `agents/tutor.md`; give it the task, sources and `rubric.json`. It writes `runs/<N>/draft-v1.md` + `score-v1.json`, then `draft-v2.md` + `score-v2.json`.
4. `node scripts/gate.cjs review <work> <N> runs/<N>/score-v2.json --reviewer subagent-<id>`
5. `node scripts/gate.cjs promote <work>` — non-zero means it does not ship. Zero copies the draft to `final/`.

## Commands

```
gate rubric  <work>
gate check   <work>
gate score   <work> <N>
gate review  <work> <N> <scores.json> --reviewer <self|ID>
gate promote <work>
gate status  <work>
```

| Exit | Meaning |
|---|---|
| 0 | pass |
| 2 | malformed score record (quote not found, deduction not a rewrite instruction, score not in 0/4/7/10, total mismatch) |
| 3 | below 100 |
| 4 | hard veto hit |
| 5 | perfect score but no external review record |
| 6 | too many rounds, or below 100 without `BLOCKED.md` |
| 7 | usage |
| 8 | invalid rubric |

Do not pipe the command — `| more` swallows the exit code.

## What this does not stop

- The professor is also a model; its professionalism comes from blindness plus "criteria must be checkable", not from being a real examiner.
- Professor and tutor may share values; only two barriers exist (no draft access, reviewer ≠ self).
- `rubric.json` is writable by the tutor; editing it invalidates every old `score-*.json` (exit 2).
- A high score is not the same as a real endorsement. `beyond_spec` forces one increment outside the rubric; a human still has to read it.

## Dev

```bash
npm test     # 27 cases: skill contract + gate behaviour
```

MIT.

# Changelog

## 2.0.0

- 双团队：professor（只读题目与素材，产出 rubric.json，不看稿）+ 	utor（按细则做到满分，可向教授问初衷与愿景）。
- gate.cjs 改为从 <work>/rubric.json 动态读维度，新增 gate rubric 与退出码 8。
- 新增 beyond_spec（判据外的增量）、BLOCKED.md（未满分的唯一合法出口）、轮次上限 5。
- 三个技能 + 两个角色稿 + 27 个测试。

## 1.0.0（已废弃）

- 六维写死的细则、单一角色自评自审。
- 废弃原因：细则由实现者自己写，会把稿的特征抄成判据，满分失去意义。
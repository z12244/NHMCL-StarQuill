# 字体安全防护（minecraft2shell）

## 背景

2026 年 11 月公开的 **minecraft2shell** 漏洞利用 Minecraft 资源包里的 TrueType 字体：玩家加入恶意服务器并接受其资源包后，字体的 hinting 字节码会通过游戏自带的 FreeType（`lwjgl-freetype`）执行，从而在客户端上运行任意代码。FreeType **2.15.0** 修复了该问题，但截至 2026-11-25 Mojang 尚未发布带新版本 FreeType 的游戏版本。

受影响范围（来自社区核对版本清单）：

| Minecraft | 内置 FreeType | 是否受影响 |
|---|---|---|
| 26.3 / 26.4 快照 | 2.14.3 | 是 |
| 26.1 – 26.2 | 2.14.1 | 是 |
| 1.20.5 – 1.21.10 | 2.13.2 | 是 |
| 1.20.4 及更早 | 不使用 FreeType | 否 |

## 启动器做了什么

NHMCL-StarQuill 随包附带 [minecraft2shell-fix](https://github.com/sunrisemc-tw/minecraft2shell-fix) 的 `m2sfix-agent-1.0.0.jar`（MIT，未修改），并在满足以下条件时自动注入：

- 平台为 **Windows**；
- 版本满足 1.20.5 及以上（或 24w03a 起的快照、26.x）；
- 设置里「启用字体安全防护」保持开启（默认开）；
- 实例的 `mods/` 中**没有**已安装的 `m2sfix` 模组（避免重复插桩）。

注入方式：`-javaagent:<程序目录>/tools/m2sfix-agent-1.0.0.jar`。它的默认策略是「安全通道」——所有字体都关闭 hinting，字体自带的程序没有机会执行，因此不需要识别具体攻击特征。

## 代价与关闭方法

- 关闭 hinting 后小字号文字会略微发虚（9px 最明显，32px 基本无感；中文影响更小）。
- 如需关闭：启动设置 → 运行环境 → 取消「启用字体安全防护」，保存后下次启动生效。
- 想保留画质、只降级被判定为可疑的字体：可自行在 JVM 参数里加 `-Dm2sfix.policy=detect`（本启动器默认使用安全通道）。

## 注意

- 这是临时缓解，不是 Mojang 官方修复；FreeType 2.15.0 随游戏更新后应停用本防护。
- 工具有误判/漏判可能，作者声明不承担相关责任；它无法覆盖所有未知变种。
- 个别服务端插件或反作弊可能对未知 `javaagent` 敏感，遇到异常可先关闭该开关排查。
- 许可证与来源见 `tools/M2SFIX-LICENSE.txt`，版本与 SHA-256 记录在 `THIRD-PARTY-NOTICES.txt`。

## 移除条件与步骤（官方修复后）

**触发条件**：Mojang 发布内置 FreeType **2.15.0 或更高**的游戏版本（社区可在版本 JSON 的 `libraries` 中确认 `org.lwjgl:lwjgl-freetype` 的版本，或等官方公告）。

**移除清单**：

1. 删除 `tools/m2sfix-agent-1.0.0.jar` 与 `tools/M2SFIX-LICENSE.txt`；
2. 删除 `THIRD-PARTY-NOTICES.txt` 末尾的 minecraft2shell-fix 段落；
3. `src/shared/game.cjs`：删除 `fontSafetyApplies()`、`hasFontFixMod()` 与 `prepare()` 中的注入块，并从导出列表移除 `fontSafetyApplies`；
4. `src/main/main.cjs`：移除 `defaults()` 的 `fontSafety` 与设置保存中的对应字段；
5. `src/index.html`：删除 `#font-safety` 复选框与说明；
6. `src/renderer/renderer.cjs`：删除 `fontSafety` 的读取、回填和锁定列表项；
7. 删除 `tests/font-safety.test.cjs`，删除本文档并在引用处（README/发布说明）同步；
8. 版本号按「新版本号」规则递增；若只是移除补丁，可在更新说明中注明“官方已修复 minecraft2shell，移除临时防护”。

代码里对应的 `TODO(minecraft2shell)` 注释会随上述步骤一起删除。

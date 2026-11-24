# 发布检查清单（v1.0.4 / stable-1.0.4 及后续）

> 适用：维护者在本机完成构建与自检，再由仓库负责人创建 tag / Release 并上传附件。
> 所有命令在仓库根目录执行；Windows 使用 PowerShell 时注意环境变量写法。

## 版本与产物约定（重要）

- **每次更新默认新建版本号**（`stable-1.0.5` / `v1.0.5` …）；只有维护者明确要求时才复用同一版本号。
- 新版本产物自动带版本号（脚本按 `releaseName` 命名），**不得覆盖或删除**旧版本的产物、tag 与 GitHub Release 附件。
- `dist/` 中的旧版本文件保持原样；确需重建同一版本时，先备份旧文件再构建。
- 已发布版本的 GitHub Release 是最终备份；本地清理前先确认对应版本已在 Release 中可下载。

## 0. 前置条件

| 项 | 要求 |
|---|---|
| Node.js | 24.x，且 `npm` 在 PATH（electron-builder 依赖 `npm list`） |
| Windows 运行时 | `runtime/bin/java.exe` 存在（Temurin JRE 21，保留 license） |
| macOS 运行时（可选） | `runtime-darwin-x64/`、`runtime-darwin-arm64/`；不提供则包内使用系统 Java |
| CurseForge 凭据（可选） | 构建时 `NHMCL_CURSEFORGE_API_KEY`，或本机钥匙串已保存 |
| 网络 | 中国大陆可用 `ELECTRON_BUILDER_BINARIES_MIRROR`、`ELECTRON_DOWNLOAD_URL` 与 npmmirror 回退 |

## 1. 自动化测试（必须全绿）

```sh
npm ci
npm test
```

- Windows：210 用例 / 208 通过 / 2 跳过（Linux 专属）。
- Linux：210 用例 / 209 通过 / 1 跳过（Windows 专属）。
- 失败即停止，不要继续打包。

## 2. Windows

```sh
npm run dist
```

产物：`dist/NHMCL-StarQuill-stable-1.0.4-win-x64.exe`；脚本结束会打印大小与 SHA-256。

自检：

```powershell
# 版本号与入口是否打进 asar
node -e "const a=require('@electron/asar');const m=JSON.parse(a.extractFile('dist/win-unpacked/resources/app.asar','package.json').toString());console.log(m.displayVersion,m.main)"
```

- `displayVersion` 应为 `v1.0.4`，`main` 应为 `src/main/main.cjs`。
- 双击 EXE 放到空目录，确认首屏、离线账号创建、皮肤站入口可见；微软登录页只显示「未接入」。
- 检查 `dist/` 内没有 `.starquill-profile/`、`.minecraft/` 运行残留（脚本会自动清理）。

## 3. Linux（Ubuntu 24.04 x64）

在 Linux 机器或虚拟机内：

```sh
npm ci --ignore-scripts          # 测试与打包不需要 Electron 二进制
node --test "tests/*.test.cjs"
bash scripts/build-linux.sh
```

- 基线 asar 默认从 `dist/win-unpacked/resources/app.asar` 复制；脚本会校验入口与版本并打印 SHA-256。发布时可固定：
  `NHMCL_BASE_ASAR_SHA256=<上一步打印的哈希> bash scripts/build-linux.sh`
- 产物：`dist/stable-1.0.4-linux`（单文件 ELF）。
- 运行自检：`./dist/stable-1.0.4-linux`，确认窗口标题 `NHMCL-StarQuill · 星翎启动器` 且首屏渲染；无桌面环境时用 `wmctrl -l` 或 xvfb 验证。

## 4. macOS（交叉打包，无需 Mac）

```sh
npm run dist:mac                 # x64 + arm64
```

产物：

- `dist/NHMCL-StarQuill-stable-1.0.4-mac-x64-untested.zip`
- `dist/NHMCL-StarQuill-stable-1.0.4-mac-arm64-untested.zip`

结构自检（在任意平台用 bsdtar 即可）：

```sh
tar -tvf <zip> | grep -c ' -> '                       # 应为 14 个符号链接
tar -tf  <zip> | grep 'Contents/Resources/app.asar'    # 应存在
```

包内 `README-使用说明.txt` 含 ad-hoc 签名步骤与系统 Java 要求；首次在 Mac 上运行需按说明执行 `codesign --force --deep --sign -`。

## 5. 私有测试包（不发布）

```sh
NHMCL_BUILD_SUFFIX=dsh npm run dist
```

产物名与界面版本号都会带 `-dsh`，用于本机验证；确认无误后重新构建无后缀版本再发布。

## 6. 产物核验与 verification.json

三个平台的产物都放进 `dist/` 后执行：

```sh
node scripts/verify-release.cjs --require-all
```

脚本会：校验 `dist/win-unpacked/resources/app.asar` 的版本号与入口并检查关键代码标记；统计 mac 包内的符号链接数量、确认 `app.asar` 存在且不含 Windows helper；计算各产物大小与 SHA-256；最后写出 `dist/verification.json`（发布说明中引用的就是这份文件）。缺少任一平台产物时加 `--require-all` 会直接失败。

> 若 Windows 构建输出到了其他目录，用 `NHMCL_WIN_UNPACKED=<目录>` 指向该 `win-unpacked`，例如 `NHMCL_WIN_UNPACKED=dist-build/win-unpacked`。

## 7. 发布清单（填写后交给仓库负责人）

| 项 | 值 |
|---|---|
| 版本 | stable-1.0.4 |
| 测试 | 210 / 通过 ___ / 跳过 ___ |
| Windows EXE | 大小 ______ / sha256 ______ |
| Linux ELF | 大小 ______ / sha256 ______ |
| macOS x64 | 大小 ______ / sha256 ______ |
| macOS arm64 | 大小 ______ / sha256 ______ |
| 变更摘要 | ______ |

> 提交、tag、Release 与附件上传由仓库负责人执行；本清单只负责产出可复现的构建与自检记录。

## 8. 已知限制（发布说明中保留）

- 所有平台产物均未做商业代码签名；Windows SmartScreen 可能提示未知发布者。
- macOS 包为交叉打包，未在实机验证；需 ad-hoc 签名，未公证。
- 微软登录为「源码预留、发行版不接入」：界面只提供离线与皮肤站登录。
- Windows 10 需在实机复测（本仓库维护流程为 Win11 本机 + Win10 远程）。

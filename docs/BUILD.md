# 构建说明

仓库不包含 `build/` 和 `dist/`（已在 `.gitignore` 中忽略），构建产物需要在本机生成。

## 环境要求

- **通用**：Node.js 24，且 `npm` 在 PATH 中（electron-builder 用 `npm list` 解析生产依赖；缺少 npm 时会退回手工遍历 `node_modules`，仍可构建但依赖树来源不同）
- **网络**：electron-builder 首次构建会下载 Electron 运行时、NSIS 与 winCodeSign。中国网络下若 GitHub 超时，设置：
  - `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`
  - `ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/`

  PowerShell：`$env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'; $env:ELECTRON_BUILDER_BINARIES_MIRROR='https://npmmirror.com/mirrors/electron-builder-binaries/'`
- **Windows**：Windows x64，且 `runtime/bin/java.exe` 存在（Windows x64 Java 21，保留运行时许可证）
- **Linux**：Ubuntu 24.04 amd64，安装 `unzip curl python3 xz gcc wmctrl` 与 OpenJDK 21
- **macOS**：无需 macOS 构建机，由 `scripts/build-mac.cjs` 在 Windows / Linux 上交叉打包；产物未在 macOS 实机验证，运行需 macOS 12+

## Windows

```sh
npm ci
npm test
npm run dist -- --config.directories.output=dist
```

产物：`dist/NHMCL-StarQuill-stable-1.0.4-win-x64.exe`。

### 私有测试构建

设置 `NHMCL_BUILD_SUFFIX` 可以生成带后缀的测试包，不修改 `package.json`，界面版本号与产物文件名都会带上后缀：

```sh
NHMCL_BUILD_SUFFIX=dsh npm run dist
# PowerShell: $env:NHMCL_BUILD_SUFFIX='dsh'; npm run dist
```

产物形如 `NHMCL-StarQuill-stable-1.0.4-dsh-win-x64.exe`，启动器侧栏显示 `v1.0.4-dsh`。仅用于本机测试，正式发布前请重新构建无后缀版本。

## Linux

`scripts/build-linux.sh` 依赖一个 Windows 构建产出的 `app.asar` 作为基线（默认 `build/stable-1.0.4.asar`，不在仓库中）：

- 如果已有 Windows 构建产物，脚本会**自动**把 `dist/win-unpacked/resources/app.asar` 复制到 `build/stable-1.0.4.asar`；
- 也可以手动从 Release 附件的 `win-unpacked/resources/app.asar` 复制；
- 或用 `NHMCL_BASE_ASAR=/path/to/app.asar` 指定其他路径。

脚本默认检查基线里确实有 `src/main/main.cjs` 入口和 `v1.0.4` 版本号，并打印其 SHA-256；发布时可用 `NHMCL_BASE_ASAR_SHA256=<hash>` 固定到具体基线。Electron 运行时优先从 npmmirror 下载，失败回退 GitHub，下载后仍校验官方 SHA-256。

```sh
bash scripts/build-linux.sh
```

产物：`dist/stable-1.0.4-linux`，单文件自解压 ELF。首次运行会解压到 `~/.cache/NHMCL-StarQuill/<sha>`，不依赖系统安装环境。

## macOS

`scripts/build-mac.cjs` 下载官方 Electron darwin 运行时，注入与 Windows 相同的 `app.asar`，改写 `Info.plist`，再用 bsdtar 打包以保留 framework 的符号链接（普通 unzip 会丢失，导致 .app 无法启动）。

```sh
npm ci
npm run dist:mac                    # x64 + arm64
npm run dist:mac -- --arch=arm64    # 只构建 Apple Silicon
```

产物：`dist/NHMCL-StarQuill-stable-1.0.4-mac-x64-untested.zip` 与 `...-mac-arm64-untested.zip`，包内附 `README-使用说明.txt`。

- 未内置 Java：目标机器需安装 Java 21（Apple Silicon 用 arm64 JDK，Intel 用 x64 JDK），启动器会自动扫描系统 Java。
- 未使用 Apple 开发者证书，首次打开需按包内说明执行 ad-hoc 签名与解除 quarantine。
- 未在 macOS 实机验证。`Resources/tools/` 不包含 Windows 专用 helper（`game-window-ready.exe`、`user-storage-key.exe`）；自动隐藏启动器改为按游戏日志判定。

## 说明

- `npm run dist` 会先生成 `dist/win-unpacked/resources/app.asar`，Linux 构建直接复用它即可。
- 构建可通过 `NHMCL_CURSEFORGE_API_KEY` 注入项目凭据。
stable-1.0.4 支持随包发布的浅色、深色及跟随系统外观。在“启动设置 → 常规”可导入本地 CSS 文件（最大 1 MiB），立即应用并随启动器配置保存，也可随时移除。

## 版本与产物

- 每次更新默认递增版本号（`stable-1.0.5` / `v1.0.5` …），只有维护者明确要求时才复用同一版本号。
- 产物名由 `releaseName` 生成，不同版本互不覆盖；构建与清理时不要删除其他版本的文件或 Release 附件。
- 发布前先确认上一版本已在 GitHub Release 中可下载，再清理本地旧产物。

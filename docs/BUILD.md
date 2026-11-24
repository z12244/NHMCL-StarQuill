# 构建说明

仓库不包含 `build/` 和 `dist/`（已在 `.gitignore` 中忽略），构建产物需要在本机生成。

## 环境要求

- **通用**：Node.js 24
- **Windows**：Windows x64，且 `runtime/bin/java.exe` 存在（Windows x64 Java 21，保留运行时许可证）
- **Linux**：Ubuntu 24.04 amd64，安装 `unzip curl python3 xz gcc wmctrl` 与 OpenJDK 21
- **macOS**：目前由 Windows 交叉打包生成，尚未在 macOS 环境实测

## Windows

```sh
npm ci
npm test
npm run dist -- --config.directories.output=dist
```

产物：`dist/NHMCL-StarQuill-beta-1.0.4-win-x64.exe`。

## Linux

`scripts/build-linux.sh` 依赖 `build/beta-1.0.4.asar`，并会校验其 SHA-256（`a43c04fb2930820033d18c0a0f954784d658645316dc47403fbfb2d228c34a2d`）。该文件不在仓库中：

- 如果已有 Windows 构建产物，脚本会**自动**把 `dist/win-unpacked/resources/app.asar` 复制到 `build/beta-1.0.4.asar`；
- 也可以手动从 Release 附件的 `win-unpacked/resources/app.asar` 复制；
- 或用 `NHMCL_BASE_ASAR=/path/to/app.asar` 指定其他路径。

```sh
bash scripts/build-linux.sh
```

产物：`dist/beta-1.0.4-linux`，单文件自解压 ELF。首次运行会解压到 `~/.cache/NHMCL-StarQuill/<sha>`，不依赖系统安装环境。

## macOS

当前 `NHMCL-StarQuill-beta-1.0.4-mac-untested.zip` 为 Windows 交叉打包，**未在 macOS 环境实测**。首次打开需按包内 `README-使用说明.txt` 完成 ad-hoc 签名；该包未使用 Apple 开发者证书。

## 说明

- `npm run dist` 会先生成 `dist/win-unpacked/resources/app.asar`，Linux 构建直接复用它即可。
- 构建可通过 `NHMCL_CURSEFORGE_API_KEY` 注入项目凭据。
beta-1.0.4 支持随包发布的浅色、深色及跟随系统外观。在“启动设置 → 常规”可导入本地 CSS 文件（最大 1 MiB），立即应用并随启动器配置保存，也可随时移除。

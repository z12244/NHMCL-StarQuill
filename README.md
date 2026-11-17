# NHMCL-StarQuill · 星翎启动器

**以星为笔，启程方块世界！**

由 StarQuill_z12244 发起的 Minecraft 启动器项目，经由南湖模作社参与维护与发行。面向 Windows 10 / Windows 11 x64。

当前正式版为 **stable-1.0.3（v1.0.3）**。

[下载最新版](https://github.com/z12244/NHMCL-StarQuill/releases/latest) · [全部版本](https://github.com/z12244/NHMCL-StarQuill/releases) · [正式版测试范围](docs/STABLE-1.0.0-TESTS.json)

> 🐛 **使用遇到问题？** 请先看 [使用文档](https://github.com/z12244/NHMCL-StarQuill#使用)，仍未解决就 [提交反馈](https://github.com/z12244/NHMCL-StarQuill/issues/new/choose)（Bug / 功能建议 / 使用求助）。

## 下载

到 [最新 Release](https://github.com/z12244/NHMCL-StarQuill/releases/latest) 按平台下载：

| 平台 | 文件 | 说明 |
| --- | --- | --- |
| Windows | `NHMCL-StarQuill-stable-1.0.3-win-x64.exe` | 便携 EXE，双击运行 |
| Linux | `NHMCL-StarQuill-stable-1.0.3-linux-x64` | 单文件 ELF，`chmod +x` 后运行 |
| macOS | `NHMCL-StarQuill-beta-1.0.3-mac-untested.zip` | 通用二进制（x64 + arm64），基于 beta-1.0.3 交叉打包，**未在 macOS 环境实测**；首次打开请按包内 `macOS-README.txt` 完成 ad-hoc 签名 |

> 各文件 SHA-256 见 Release 附件中的 `SHA256SUMS*.txt`。
## 使用

把单文件 EXE 放到准备用来存放游戏的文件夹中打开。首次可创建离线账号或选择皮肤站登录。游戏保存在同目录的 .minecraft，账号和设置保存在 .starquill-profile。升级时退出旧程序，将新 EXE 放回原目录。

在「资源工坊 → 安装版本」安装原版或 Fabric、Forge、NeoForge，再回到「开始冒险」选择已安装的版本。可复用 HMCL/PCL 的标准游戏目录，默认启用版本隔离。

## 功能

- 原版与模组加载器安装，国内镜像下载、文件校验及已下载文件复用；选择已有 .minecraft 时自动识别各版本目录隔离方式。
- AI 启动器助手，支持自然语言创建版本、安装加载器、搜索并安装模组 / 整合包，以及日志和崩溃分析。
- CurseForge、Modrinth 资源搜索下载，MC 百科中文名匹配及前置模组解析。
- Modrinth、CurseForge、MultiMC/Prism 整合包导入，支持 GTNH 分发格式；资源工坊提供 1.12.2 Cleanroom 与 OptiFine 独立安装（OptiFine 可单独安装或搭配兼容 Forge）。
- 支持自定义启动器与游戏窗口尺寸、全屏设置；游戏启动后可自动隐藏启动器、退出恢复，版本详情提供删除入口。
- 全局与版本独立设置，四种 Java 选择策略，内置 Java 21，可浏览或扫描本机 Java。
- 模组、资源包和光影管理，包含运行依赖与 Java 的离线版本包导出导入，导出排除 saves 存档。
- 离线和皮肤站账号、3D 皮肤与披风预览、皮肤导入导出。
- 崩溃诊断、日志导出、键盘与鼠标后退导航。启动前内存优化默认关闭。

程序首次展开并校验缓存，后续复用以加快启动。不同整合包按作者元数据匹配 Java，部分版本需要另行安装 Java 8、17 或 25。

## 验证与当前限制

218 项自动化回归通过。已验证原版 1.21.1 实际启动、三种加载器在线安装、CurseForge 下载、含 Java 的完整离线包往返、Java 策略、设置保存与内存优化。正式 EXE 已验证首次打开及重启，并补做首屏显示检查。

皮肤站登录使用受控协议服务验证，真实站点账号授权仍需实际账号检验。v1.0.3 暂无法使用微软账号登录，界面已提示使用皮肤站登录，并移除微软登录按钮。源码保留接入通道。GTNH/Cleanroom 已验证安装与 JVM 引导链，完整模组加载与进入世界尚未全面覆盖。Windows 11 x64 与 Windows 10 专业版 x64 均已实机复测。

## 开发与构建

使用 Node.js 24 安装依赖。准备 Windows x64 Java 21 运行时，使 runtime/bin/java.exe 存在，保留运行时许可证。

```sh
npm ci
npm test
npm start
npm run dist -- --config.directories.output=dist
```

构建可通过 NHMCL_CURSEFORGE_API_KEY 注入项目凭据。发行构建将凭据加密保存，客户端加密不能防止逆向提取。账号、令牌、个人设置与游戏目录不纳入源码仓库。

[整合包说明](docs/GTNH-AND-CLEANROOM.md) · [Java、内存与崩溃诊断](docs/MEMORY-AND-CRASH.md) · [离线包](docs/OFFLINE-PACK.md) · [历史 Beta 目录](old-versions/) · [第三方组件许可](THIRD-PARTY-NOTICES.txt)

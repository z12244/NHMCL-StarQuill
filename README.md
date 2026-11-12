# NHMCL-StarQuill · 星翎启动器

**以星为笔，启程方块世界！**

由 StarQuill_z12244 发起的 Minecraft 启动器项目，经由南湖模作社参与维护与发行。面向 Windows 10 / Windows 11 x64。

当前正式版为 **stable-1.0.0（v1.0.0）**，已修复启动时旧界面闪现。

[下载最新版](https://github.com/z12244/NHMCL-StarQuill/releases/latest) · [全部版本](https://github.com/z12244/NHMCL-StarQuill/releases) · [正式版测试范围](docs/STABLE-1.0.0-TESTS.json)

> 🐛 **使用遇到问题？** 请先看 [使用文档](https://github.com/z12244/NHMCL-StarQuill#使用)，仍未解决就 [提交反馈](https://github.com/z12244/NHMCL-StarQuill/issues/new/choose)（Bug / 功能建议 / 使用求助）。

## 使用

把单文件 EXE 放到准备用来存放游戏的文件夹中打开。首次可创建离线账号或选择皮肤站登录。游戏保存在同目录的 .minecraft，账号和设置保存在 .starquill-profile。升级时退出旧程序，将新 EXE 放回原目录。

在「资源工坊 → 安装版本」安装原版或 Fabric、Forge、NeoForge，再回到「开始冒险」选择已安装的版本。可复用 HMCL/PCL 的标准游戏目录，默认启用版本隔离。

## 功能

- 原版与模组加载器安装，国内镜像下载、文件校验及已下载文件复用。
- CurseForge、Modrinth 资源搜索下载，MC 百科中文名匹配及前置模组解析。
- Modrinth、CurseForge、MultiMC/Prism 整合包导入，支持 GTNH 分发格式与 1.12.2 Cleanroom 启动补丁。
- 全局与版本独立设置，四种 Java 选择策略，内置 Java 21，可浏览或扫描本机 Java。
- 模组、资源包和光影管理，包含运行依赖与 Java 的离线版本包导出导入，导出排除 saves 存档。
- 离线和皮肤站账号、3D 皮肤与披风预览、皮肤导入导出。
- 崩溃诊断、日志导出、键盘与鼠标后退导航。启动前内存优化默认关闭。

程序首次展开并校验缓存，后续复用以加快启动。不同整合包按作者元数据匹配 Java，部分版本需要另行安装 Java 8、17 或 25。

## 验证与当前限制

145 项自动化回归通过。已验证原版 1.21.1 实际启动、三种加载器在线安装、CurseForge 下载、含 Java 的完整离线包往返、Java 策略、设置保存与内存优化。正式 EXE 已验证首次打开及重启，并补做首屏显示检查。

皮肤站登录使用受控协议服务验证，真实站点账号授权仍需实际账号检验。微软登录尚未开放，项目未配置 Client ID。GTNH/Cleanroom 已验证安装与 JVM 引导链，完整模组加载与进入世界尚未全面覆盖。本轮实机为 Windows 11 x64，Windows 10 尚无独立实机验证。

## 开发与构建

使用 Node.js 24 安装依赖。准备 Windows x64 Java 21 运行时，使 runtime/bin/java.exe 存在，保留运行时许可证。

```sh
npm ci
npm test
npm start
npm run dist -- --config.directories.output=dist
```

构建可通过 NHMCL_CURSEFORGE_API_KEY 注入项目凭据。发行构建将凭据加密保存，客户端加密不能防止逆向提取。账号、令牌、个人设置与游戏目录不纳入源码仓库。

[整合包说明](GTNH-AND-CLEANROOM.md) · [Java、内存与崩溃诊断](MEMORY-AND-CRASH.md) · [离线包](OFFLINE-PACK.md) · [历史 Beta 目录](old-versions/) · [第三方组件许可](THIRD-PARTY-NOTICES.txt)

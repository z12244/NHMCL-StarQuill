# NHMCL-StarQuill · 星翎启动器

**beta-0.8.6 · 以星为笔，启程方块世界！**

该启动器由 StarQuill_z12244 发起的 Minecraft 启动器项目。经由南湖模作社参与维护与发行。

这是仍在开发中的 Windows 10 / 11 x64 Minecraft Java Edition 第三方启动器。不是 Mojang / Microsoft 官方产品。

## 当前功能

- 标准 `.minecraft` 文件布局、默认版本隔离及已有资源复用。
- 国内镜像与官方源下载；资源工坊统一安装原版、Forge、NeoForge、Fabric。
- 本地 Java 扫描、自动匹配及手动选择、实时内存信息。
- 首次启动用户名引导、离线账号、LittleSkin / MUA / 自定义皮肤站登录。
- 模组及资源包管理、整合包导入、离线版本包导出和导入。
- 意外退出自动日志导出和初步分析。

## 当前限制

微软认证实现保留，但登录入口暂停，暂无项目 Client ID。旧版 PowerShell 内存优化已停用。CurseForge 需要项目自己的 API Key。整合包拖拽尚未完成桌面实测；日志分析无法保证识别所有退出原因。

最新版本只完成基础及针对性样例验证，不代表全面实机测试通过。详情见 [当前版本说明](docs/UPDATE-0.8.6.md)。

## 使用

从 Releases 下载 Windows EXE，放入可写文件夹。游戏目录为 EXE 旁的 `.minecraft`，账号及配置为 `.starquill-profile`。不要将这些个人数据提交到仓库。只复制 EXE 到新目录会创建独立档案；已有游戏目录可复用。

## 从源码构建

安装 Node.js 24 和 npm，然后执行：

```text
npm ci
```

把 Windows x64 Temurin Java 21 运行时解压到 `runtime`，确保 `runtime/bin/java.exe` 存在并保留全部许可证。本次发行使用 Temurin 21.0.13+9。然后运行：

```text
npm start
npm run dist
```

构建结果位于 `dist`。第三方 authlib-injector 的未修改 JAR、对应源码和许可证在 `tools`。仓库不含 node_modules、Java 运行时、游戏或账号数据。EXE 与历史构建作为 Release 附件分发，不提交到 Git 历史。

## 版本约定

发布名称、附件与当前版本 Git 标签使用 `beta-0.x.x`；`package.version` 使用合法 SemVer `0.x.x-beta`，`displayVersion` 使用 `beta-0.x.x`。历史源码压缩包按版本放在 [old-versions](old-versions/README.md)，对应原始 EXE 作为 GitHub Release 附件分发。历史二进制保持原样，只调整附件名称。开发资料按主题放在 [docs](docs/)。

## 许可与资料

尚未为本项目原创代码指定开源许可证。第三方组件按其各自许可证分发，详见 `THIRD-PARTY-NOTICES.txt` 和 `tools`。功能历史见 `docs/DEVELOPMENT-HISTORY.md`；当前行为以最新版本说明为准。

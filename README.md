# NHMCL-StarQuill · 星翎启动器

**以星为笔，启程方块世界！**

星翎启动器是面向 Windows 10 和 Windows 11 x64 的 Minecraft Java 版第三方启动器。该启动器由 StarQuill_z12244 发起的 Minecraft 启动器项目。经由南湖模作社参与维护与发行。

当前源码版本为 **beta-0.9.1**。已发布的 Windows 安装包和对应的校验清单可在 [GitHub Releases](https://github.com/z12244/NHMCL-StarQuill/releases) 查看。

## 第一次启动

1. 把单文件 EXE 放在准备用来存放游戏的文件夹，双击运行。首次打开可创建离线账号、跳转到皮肤站登录，也可跳过并稍后设置账号。
2. 在「资源工坊 → 安装版本」选择 Minecraft 版本。默认安装原版，也可以同时选择 Fabric、Forge 或 NeoForge。
3. 回到「开始冒险」，从已安装的列表中选择版本并启动。发行包内置 Temurin Java 21，启动器可按游戏要求匹配本机 Java，也支持手动选择。

**升级已有启动器**时，将新 EXE 放回原目录。同目录的 `.minecraft` 存放游戏，`.starquill-profile` 存放启动器设置和账号档案。要使用 PCL 或 HMCL 已下载的游戏，可在「启动设置」中选择已有的 `.minecraft`。星翎会复用标准的 `versions`、`libraries` 和 `assets`，默认按版本隔离存档、模组和配置。

## beta-0.9.1 的主要功能

| 在哪里 | 可以做什么 |
| --- | --- |
| 资源工坊 → 模组与资源 | 用中文或英文搜索模组、资源包和整合包。工坊匹配 CurseForge、Modrinth 来源及目标加载器，列出必需前置，并在安装前校验下载文件。可从 MC 百科匹配模组中文名。 |
| 启动设置 / 我的版本 → 版本设置 | 配置 JVM 与游戏参数、启动前命令、垃圾回收器和高性能显卡偏好。每个版本默认逐项跟随全局，也可覆盖某一项。支持保护已安装的模组，以及选择启动时是否校验已有文件。 |
| 资源工坊 → 导入整合包 | 拖入 Modrinth `.mrpack` 或 CurseForge 客户端整合包 ZIP，解析加载器和依赖后安装，默认沿用整合包名称。 |
| 我的版本 | 管理模组、资源包和光影。可导出含运行依赖与 Java 的离线版本包，再在另一台电脑导入。导出时排除 `saves` 存档。 |
| 账号与皮肤 | 使用离线账号或第三方皮肤站账号，预览角色的 3D 皮肤和披风，导出皮肤 PNG。微软正版登录暂未开放。 |
| 运行日志 | 游戏意外退出时自动导出诊断 ZIP，整理游戏日志、可用的 JVM 报告及对应 Windows 事件，并给出初步分析。 |

本地版本和下载的具体用法见 [资源工坊](docs/RESOURCE-WORKSHOP.md)、[版本设置](docs/VERSION-SETTINGS.md) 和 [离线版本包](docs/OFFLINE-PACK.md)。账号和排错说明见 [皮肤站登录](docs/SKIN-SITE-LOGIN.md) 和 [崩溃诊断](docs/MEMORY-AND-CRASH.md)。

## 本版工坊验证

在 Windows 11 x64 的全新目录中，只复制 beta-0.9.1 的 EXE 后首次启动，已验证搜索、安装 JEI 和前置 MezzConfig，并逐个核对 SHA-1。此次工坊回归包含 9 项功能检查，全部通过。

## 从源码运行和打包

使用 Node.js 24 和 npm。准备 Windows x64 的 Temurin Java 21 JRE，将其解压到 `runtime/`，使 `runtime/bin/java.exe` 存在，并保留原始许可证。[运行时说明](runtime/README.md)

```sh
npm ci
npm test
npm start
```

构建 Windows x64 单文件启动器时运行以下命令，产物会写入仓库内的 `dist/`。

```sh
npm run dist -- --config.directories.output=dist
```

构建时可通过环境变量 `NHMCL_CURSEFORGE_API_KEY` 注入项目凭据。未注入凭据的构建使用 MCIM 公共镜像，下载遵循作者的分发设置。客户端设置中没有个人 API Key 输入项。

[历史版本目录](old-versions/README.md) · [第三方组件与许可](THIRD-PARTY-NOTICES.txt)

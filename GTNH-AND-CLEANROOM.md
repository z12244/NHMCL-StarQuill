# GTNH 与 Cleanroom 整合包导入

在「资源工坊 → 导入整合包」选择原始 ZIP，也可以拖入窗口。启动器读取包内名称并建立隔离版本，保留原始模组文件名。不要先把大型压缩包手动解压到 `versions`。

## GTNH 2.9.0

| 分发包 | 识别方式 | Java |
| --- | --- | --- |
| `GT_New_Horizons_2.9.0_Java_17-26.zip` | MultiMC / Prism 组件、RFB 与 LWJGL 启动补丁 | 作者列出的 17、21、25、26；内置 21 可用 |
| `GT-New-Horizons-2.9.0.zip` | CurseForge 清单、53 个锁定远程文件及包内补丁 | 此包同样支持上述四个 Java 主版本 |
| `GT_New_Horizons_2.9.0_Client_Java_8.zip` | 包内 GTNH 版本标记和模组特征 | Windows x64 Java 8 |

三个包均为 Minecraft 1.7.10、Forge 1614。安装后只在版本列表显示整合包，已有独立原版不会被移除。本地补丁库与共享缓存发生冲突时，建立整合包自己的依赖路径，保留原缓存。

Java 8 包需要先安装 Java 8，再在启动设置中扫描或手动指定。若不需要 Java 8，可选用现代 Java 分发包。

## Minecraft 1.12.2 / Cleanroom

支持带 Cleanroom 组件启动配置的 MultiMC / Prism 包。仅含组件补丁的官方实例也可以导入，启动器补齐原版资源，然后应用 Cleanroom 的主类、依赖和参数，不运行普通 Forge 安装器。

已验证官方 `0.7.14-alpha` 和 `0.3.30-alpha` 两种结构。前者声明 Java 25；后者声明 Java 21–25，可使用内置 Java 21。其他版本按各包自己的兼容列表选择，不将所有 1.12.2 版本固定为 Java 8 或 25。

使用新版包前，请在本机安装所需的 Windows x64 Java，并在「启动设置」扫描。启动器会匹配可用的兼容版本。Cleanroom 目标在资源工坊按 Forge 生态筛选；具体模组是否适配仍取决于模组本身。

只有 `cleanroom` 名称、没有完整启动补丁的包会提示改用完整实例包。普通 Forge 加 Relauncher 的整合包仍按作者自己的重启流程运行，不将它伪装成已直接安装的 Cleanroom。

[Cleanroom 官方安装说明](https://cleanroommc.com/wiki/end-user-guide/installation/install-client) · [GTNH 官方分发](https://www.gtnewhorizons.com/version-history/)

## 验证范围

三个 GTNH 原包和两个 Cleanroom 官方实例均执行实际安装、运行文件准备及校验。真实 JVM 探针验证启动参数、引导主类、类加载器和 LWJGL 原生调用；没有调用完整游戏主入口、加载全部模组或进入世界，不能将这些检查等同于完整游玩测试。

# NHMCL-StarQuill · 星翎启动器 0.8.6

**以星为笔，启程方块世界！**

该启动器由 StarQuill_z12244 发起的 Minecraft 启动器项目。经由南湖模作社参与维护与发行。

## 使用与默认目录

双击 `NHMCL-StarQuill-0.8.6-win-x64.exe`。单文件版包含 Temurin Java 21 JRE，首次启动会解压程序，无需安装 Node.js 或 Java 21。游戏文件默认放在 **EXE 所在目录的 `.minecraft`**，不放在临时解压目录。

```text
NHMCL-StarQuill-0.8.6-win-x64.exe
.minecraft/
  assets/
    indexes/17.json              # 使用版本 JSON 中真实的资源索引 ID
    objects/ab/abcdef...         # 按内容哈希共享的资源
    log_configs/
  libraries/                    # 标准 Maven 目录，各版本共享
  versions/
    1.21.1/
      1.21.1.json
      1.21.1.jar
      saves/
      mods/
      config/
      resourcepacks/
      logs/
      natives/
  .starquill/                    # 本启动器的版本列表和校验缓存
```

`saves`、`mods` 等目录由游戏或模组按需创建，不会预先制造空文件。版本隔离默认开启：Java 的工作目录与 `--gameDir` 都是 `versions/版本名`。关闭隔离则使用 `.minecraft` 根目录中的存档和配置；切换隔离不会自动搬动存档。

启动器选项与所选根目录记录在系统应用数据目录（`%APPDATA%/nhmcl-starquill` 或产品名称对应目录），游戏文件均留在所选 `.minecraft`。Java 21 随 EXE 分发，不属于游戏下载目录。

## 直接使用 PCL / HMCL 下载的版本

1. 打开「启动设置」→「选择目录」。
2. 选择已有 `.minecraft`；也可选择其上一层文件夹，程序会识别其中的 `.minecraft`。
3. 保存设置。「我的版本」及首页的「本地版本」分组会列出现有版本。
4. 选择版本启动。已有 JSON、JAR、libraries 和 assets 会被复用，只补齐缺失或校验失败的文件。

请保留完整 `.minecraft`。仅复制 `versions/1.21.1` 不包含共享依赖和资源，会触发补全下载。中文和空格版本名、标准 `inheritsFrom` 父版本、Maven 依赖覆盖和通用 JVM/game 参数均可读取，不会将原版本 JSON 改写为私有格式。

Forge、NeoForge、Fabric 安装工作流从 0.6.0 起提供。本次 0.8.6 已做自动测试与真实桌面回归，范围见发行目录的 verification.json。读取通用目录不等于已验证所有 Forge、NeoForge、Fabric、OptiFine 历史组合；加载器的安装产物仍需完整，旧游戏可能需要自行选择 Java 8 / 17 等运行时。

## 导入旧版 Aster 数据

在设置中点击「导入旧 Aster 数据」，选择旧的 `instances` 文件夹。旧版默认位置是 `%APPDATA%/aster-launcher/instances`。

程序把每个旧实例的公共 assets / libraries 合并到新根目录，版本 JSON / JAR 放入 versions，并将存档、mods、配置复制到对应版本目录。**只复制，不删除原数据，不覆盖已有文件**；同名但配置不同的版本会跳过并记入日志。迁移前需选好目标 `.minecraft` 并保存。

## 下载设置

- **自动（默认）**：BMCLAPI 国内镜像优先，失败回退官方；镜像连续连接失败后暂时使用官方源。
- **BMCLAPI**：优先国内镜像，官方兜底。
- **仅官方源**：不经过镜像。
- 默认 16 个并行任务，可调 1–32。使用有界队列，避免同时开启数千个下载。
- 版本元数据、游戏 JAR、资源和依赖库按来源规则切换。未映射的第三方 Maven 地址保持原来源。
- 使用系统网络栈，保留 TLS 证书验证；对有官方哈希/长度的文件校验完整性。
- `.starquill.part` 临时文件支持 HTTP Range 续传；服务器不支持 Range 时重新下载当前文件。通过校验后才发布正式文件。
- 点击「取消下载」保留已完成文件和续传数据。重新启动继续检查与补全。
- 已校验文件保存大小、修改时间和哈希记录；再次启动优先复用。改变的文件会重新校验。

镜像速度取决于当前节点与网络，不保证每次快于官方。速度异常时可在设置中切换来源。日志会记录回退与文件复用数量。

## Java 自动选择与内存

默认开启「自动选择」，启动时读取版本 JSON 的 Java 要求，并从本机扫描结果中匹配 Windows x64 Java；对应的内置 Java 21 优先使用。支持常见安装目录、JAVA_HOME / PATH、Java 注册表、官方启动器 runtime，以及指定文件夹（最多 5 层）。扫描会执行候选 java.exe 的版本查询，不会下载或安装新 Java。

在「启动设置 → 运行环境」可重新扫描、扫描自定义文件夹，或从列表选择 Java 并切到手动模式。手动路径保留，启动时核对版本，不匹配会给出明确提示。「恢复自动」可切回自动模式。旧设置中已有手动路径的用户会保留手动模式。

内存滑块上限为系统可用物理总内存向下取整的 GB 数，启动与保存时同样验证，换电脑时会限制已保存的过大值。它不是当前空闲内存；仍建议给 Windows 和其他应用留出至少 2 GB。

## 账号与离线皮肤

「账号与皮肤」支持添加多个离线账号、切换与移除。首次升级会把原来的离线玩家名迁入账号列表。离线 UUID 仍按标准 OfflinePlayer:玩家名生成，和上一版相同。

选择离线账号，填写正版玩家名并点击「获取并应用皮肤」；也可选择已登录的正版账号作为皮肤来源。皮肤图片缓存到 .minecraft/.starquill/skins，下次启动生效。重启后无需再次查询网络。更换 .minecraft 后，如果该目录没有缓存，请重新获取皮肤。

皮肤仅改变外观，不改变离线 UUID、不赋予正版身份。普通和纤细模型均保留；不复制披风。游戏运行期间不能修改账号。离线皮肤通过随包提供的原版 authlib-injector 与本机回环服务加载；服务随游戏结束关闭，只用于离线账号。原版 1.21.1 已实测；特殊模组或其他游戏版本的兼容性尚未全部验证。

微软登录流程已接入，但此项目还没有自己的 Client ID。详细配置、授权前提和验证范围见 [MICROSOFT-LOGIN.md](MICROSOFT-LOGIN.md)。当前发行包不会借用其他启动器的应用编号。

## 界面和版本列表

结束游戏、取消准备按钮使用固定两行：结束 / 游戏、取消 / 准备。首页先选大版本系列，再选其下的小版本；如 1.21 系列包含 1.21、1.21.1、1.21.11 等。每个系列内优先列出本地版本，自定义本地版本单独列出。快照与远古版本按原来的勾选项显示。

每次打开启动器只自动检查一次 Mojang 官方版本列表。没有定时检查，也不会因为切回窗口或网络恢复而重新获取。保留手动刷新按钮。使用 HTTP 条件请求验证缓存；离线时继续显示缓存和本地版本。列表检查优先官方源，失败时按下载源设置允许镜像兜底；游戏下载仍保留原有国内镜像策略。新版本收录不需要更新启动器程序，以官方接口返回结果为准，程序关闭期间不进行后台检查。

刷新保留当前选择，不自动跳到最新版本。新增版本和未来的数字编号按元数据动态分组，不依赖写死的版本清单。

## 第三方皮肤站

账号页增加 LittleSkin、MUA 用户中心和自定义 HTTPS Yggdrasil 站点。支持识别站点、账号密码登录、多角色选择、会话验证 / 刷新、Windows 加密保存，以及随游戏加载 authlib-injector。操作与验证范围见 [SKIN-SITE-LOGIN.md](SKIN-SITE-LOGIN.md)。

## 0.6.0 起提供的资源工坊

新增年份分组、Forge / NeoForge / Fabric 一键安装、Modrinth / CurseForge 资源搜索与依赖下载、MC百科中文检索与名称匹配，以及 .mrpack / CurseForge 整合包导入。使用方法、平台配置与支持范围详见 [RESOURCE-WORKSHOP.md](RESOURCE-WORKSHOP.md)。

## 开发和构建

```text
npm ci
npm test
npm start
npm run dist
```

源码包保留皮肤代理的未修改 JAR、许可证和对应源码压缩包，不含 Java 运行时或 node_modules。将 Windows x64 Temurin Java 21 JRE 解压到 `runtime/`，确保 `runtime/bin/java.exe` 存在，并保留原始许可证。

这一版重写了存储、版本解析、下载和启动参数生成模块，已移除 minecraft-launcher-core 依赖。运行依赖包括 adm-zip、node-html-parser 和 MIT 许可的 @xmcl/installer，使用自有下载系统与标准目录。单文件 EXE 未做商业代码签名。

## 参考与声明

- HMCL 版本隔离文档：https://docs.hmcl.net/launcher/isolation.html
- BMCLAPI 文档：https://bmclapidoc.bangbang93.com/
- Java：https://adoptium.net/

项目采用通用 Minecraft 文件约定，没有复制 HMCL/PCL 品牌或源代码。BMCLAPI 提供国内镜像服务。不是 Mojang / Microsoft 官方产品。第三方声明见 `THIRD-PARTY-NOTICES.txt`。


## 0.7.0 起提供的版本管理入口

资源工坊取消平台下拉框，改为加载器筛选、自动来源选择与中文用途扩展搜索。详见 RESOURCE-WORKSHOP.md。

「我的版本 → 版本设置」支持独立 Java、内存和隔离设置，以及模组 / 资源包 / 光影的本地管理。详见 VERSION-SETTINGS.md。

0.7.0 曾进行加载器与离线版本包深度测试；0.8.6 按本次要求仅进行基础检查，不重复深度测试。当前版本的实际检查范围见发行目录 verification.json。


## 星翎离线版本包

「版本设置 → 导出离线版本包」包含运行所需游戏内容、依赖与匹配 Java，排除 saves。「我的版本 → 导入版本包」可在无网电脑导入。具体步骤、范围和格式见 OFFLINE-PACK.md。

## 0.8.6 内存与崩溃诊断

全局启动设置新增「启动游戏前进行内存优化」，默认关闭，勾选并保存后生效。全局和版本内存设置均显示实时可用内存；只在设置页可见时每 2 秒读取本机数据，不访问网络。游戏意外退出时自动保存日志 ZIP 并显示可能原因。正常退出和手动结束不会生成崩溃报告。使用与范围见 [MEMORY-AND-CRASH.md](MEMORY-AND-CRASH.md)。


## 0.8.6 优先说明
旧版内存优化脚本已停用，档案改为 EXE 同目录独立保存，增加 Windows 错误事件采集。当前行为与验证限制以 UPDATE-0.8.6.md 为准。


## 0.8.6 安装入口调整
版本下载和可选加载器统一到资源工坊的安装版本页，首页仅选择已安装版本。详见 UPDATE-0.8.6.md。


## 0.8.6 自动列表读取
启动固定显示开始冒险；官方列表启动时后台检查一次，加载器列表随选择自动读取。参阅 UPDATE-0.8.6.md。


## 0.8.6 微软登录准备
新增独立的 Client ID 保存、本地接入条件检查与注册 / 访问申请入口。维护者操作与申请草稿见 MICROSOFT-SETUP.md。项目尚未提供 Client ID，未验证真实正版账号登录。


## 0.8.6 当前行为
微软登录暂停，首次打开引导创建离线账号或跳转皮肤站；支持拖拽导入整合包、自动命名与依赖列表折叠。以 UPDATE-0.8.6.md 为准。

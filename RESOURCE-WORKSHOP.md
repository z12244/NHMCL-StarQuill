# 资源工坊 · beta-0.9.1

## 版本与更新

首页和加载器安装页都使用两级选择。`26.1`、`26.1.2`、`26.2` 等归入 **2026 系列**；`27.x` 按同样规则归入 2027。1.21.x 仍属于 1.21 系列。本地自定义名称单独显示。

官方版本列表在每次打开启动器时静默检查一次。首页的刷新按钮重新扫描已安装版本。选择加载器时会自动读取兼容列表，资源搜索按需联网。

## 安装 Forge / NeoForge / Fabric

1. 打开「资源工坊 → 安装版本」。
2. 选择年份 / 大版本、Minecraft 小版本和加载器；默认不安装加载器，选定加载器后会自动读取其版本。
3. 默认选中最新稳定版，也可选择其他版本。填写一个未使用的新版本名称。
4. 点击「一键安装版本」。完成后从首页或「我的版本」启动。

安装器会准备原版、下载加载器、运行 Forge / NeoForge 的安装处理器并补齐依赖。采用标准 `inheritsFrom` 与 Maven 目录；原版资源、依赖库共用。下载遵循设置中的 BMCLAPI / 官方来源，Fabric 元数据与 Maven 文件也支持映射。

安装期间可取消。加载器先在 `.minecraft/.starquill/install/` 的临时目录完成，成功后才发布到 `versions/新版本名`，已有同名版本不会被覆盖。共享资源可复用。新建的模组版本固定使用隔离目录。

Java 仍按游戏元数据选择；安装器附带 Java 21，其他版本要求的 Java 8、17、25 等从本机扫描。若缺少对应 Java，会明确提示。Fabric Loader 不等于 Fabric API；需要 API 的模组会通过前置清单安装。

## 模组、资源包与光影

在「模组与资源」选择加载器、内容类型和目标版本，输入关键词搜索。已移除平台选择，启动器自动汇总 Modrinth 与 CurseForge。加载器默认跟随目标版本，也可以选择 Forge、NeoForge、Fabric 或全部。单独资源仍按目标 Minecraft 版本筛选；整合包使用自己的配置。

中文用途会扩展为相关英文关键词。例如「小地图」同时搜索 minimap、map、waypoint；另有合成表、性能优化、背包、建筑、科技、群系等词组。平台自身的模糊检索与 MC 百科的中文关联共同补充结果，匹配名称优先于相关用途。结果仍受平台收录、当前版本、加载器和网络影响，不保证返回互联网上所有模组。

同一项目若有经百科核实的多个下载来源，详情页优先选择有兼容文件且允许直接下载的来源；条件相同时优先 Modrinth。不会仅因名称相似就把两个模组当成同一项目。某个平台故障时保留其他来源结果。该策略不进行后台测速；搜索按操作请求，短期缓存合并结果和分页。

点击「检查前置与安装清单」后，启动器递归解析平台声明的必需前置，去重并检查明确的版本冲突。清单展示文件名、来源关系和下载大小。确认后安装全部必需文件；可选前置会提示，默认不自动安装。依赖判断以资源作者在平台填写的数据为准，无法代替全部模组运行兼容性测试。

文件先下载到 `.minecraft/.starquill/downloads`，通过 SHA-512、SHA-256、SHA-1 或平台提供的 MD5 校验后才复制到目标版本。已有完全相同的文件直接复用，即使它来自其他启动器、文件名不同。已管理模组的更新会保留旧文件备份；用户修改过的文件不会静默覆盖。若发现未管理的同一模组不同版本，会提示先处理重复文件。

- 模组：目标游戏目录的 `mods/`。
- 资源包：`resourcepacks/`；下载后在游戏的资源包设置中启用。
- 光影：`shaderpacks/`；需要安装兼容的 Iris 或其他光影支持模组，再在游戏内启用。
- 安装记录：目标目录的 `.starquill-content.json`。它用于去重、版本记录和后续安全替换，不改变模组本体。

## MC百科与中文文件名

输入中文名称时自动查询 MC 百科条目，并核对关联的 Modrinth / CurseForge 项目。详情页保留百科资料入口，实际文件来自作者发布的资源平台，不需要手动选择平台。

选中资源或解析依赖时，会按项目英文名称搜索百科，并核对百科关联的项目 ID / slug 后使用中文名。成功结果保存在 `.minecraft/.starquill/mod-names.json`。不复制百科文章全文；不运行百科网页脚本。

新下载的单独模组文件示例：`模组菜单 - modmenu-11.0.3.jar`。原始文件名、版本、哈希和名称来源保存在安装记录中。没有匹配译名时保留原名；安装前可手动补充中文名。百科页面结构变化或网络不可用时，英文下载仍可继续。已有文件不为改名而重新下载。

## 整合包

两条入口：搜索平台中的「整合包」并选择版本，或者在「导入整合包」选择本地 `.mrpack` / 客户端整合包 ZIP。先填写一个新版本名称，再查看清单并安装。

支持 Modrinth formatVersion 1，以及 CurseForge minecraftModpack manifestVersion 1；加载器支持 Forge、NeoForge、Fabric。自动准备游戏与指定加载器、下载锁定版本的文件、解压 overrides。Modrinth 的 client-overrides 优先于普通 overrides；仅服务端和可选文件默认跳过。可选文件数量在清单中显示。

整合包始终使用 `.minecraft/versions/新版本名` 隔离目录，不覆盖其他版本和存档。保留作者清单里的文件名，避免破坏配置引用；单独下载的模组才按中文命名规则新增。包内路径、校验值、重复文件、链接及受保护文件类型均会检查。整合包在生成清单后发生变化，需要重新导入。

不识别的服务器发行包、MultiMC ZIP、Quilt / OptiFine 专用包或包内安装脚本会给出提示；不会把它们当作已成功安装。大型整合包仍取决于网络、磁盘空间及作者提供的文件可用性。

## CurseForge 配置与作者限制

启动器的主进程用随程序加密保存的项目凭据调用官方接口。复制 EXE 到新电脑后即可使用。

官方 API 和下载 CDN 的密钥仅分别发往 `api.curseforge.com` 和 `edge.forgecdn.net`。公共镜像接入 MCIM，适用于无凭据构建及连接失败时的回退。镜像请求不携带开发者凭据。已知禁止第三方分发的文件保留手动下载入口。[MCIM 接入指南](https://www.mcimirror.top/guide/start/getting-started)

若作者关闭第三方自动下载，清单会提供官方文件页和「导入已下载文件」。手动取得指定文件后，启动器按该版本的哈希验证，再继续安装；不会猜测 CDN 地址绕过作者设置。若整合包压缩文件本身限制下载，可从官方页面下载后走本地导入入口。

## 接口和开源组件

- [Minecraft 年份编号说明](https://www.minecraft.net/en-us/article/minecraft-new-version-numbering-system)
- [Fabric 官方 Meta API](https://meta.fabricmc.net/)
- [Forge](https://files.minecraftforge.net/) / [NeoForge](https://projects.neoforged.net/neoforged/neoforge/)
- [BMCLAPI 文档](https://bmclapidoc.bangbang93.com/)
- [Modrinth API](https://docs.modrinth.com/api/) / [文件与前置结构](https://docs.modrinth.com/api/operations/getversion/)
- [CurseForge API](https://docs.curseforge.com/rest-api/)
- [MC百科](https://www.mcmod.cn/)
- [XMCL 安装组件](https://github.com/Voxelum/minecraft-launcher-core-node)，MIT 许可。使用 6.3.7 的安装工作流，接入本启动器的下载、取消和进度系统；解压组件固定到可发布的 2.1.2。

Forge / NeoForge / Fabric 与模组文件按需从其作者来源下载，不随启动器重新分发。本项目与上述平台和作者无官方隶属关系。


## 0.7.0 检查范围

历史版本 0.7.0 的测试范围记录在旧发行材料中。beta-0.9.1 已以有效密钥验证官方 Minecraft API、真实 CurseForge 文件下载与 SHA-1 校验；版本管理见 VERSION-SETTINGS.md，离线包见 OFFLINE-PACK.md。

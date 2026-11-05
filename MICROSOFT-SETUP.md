# NHMCL-StarQuill 微软登录接入准备

准备日期：2026-11-05。当前没有项目自己的 Client ID，没有注册或提交任何远端应用，没有进行真实微软账号登录验证。

## 已准备的程序能力
设备码登录、Xbox Live / XSTS 交换、Minecraft 权益及档案校验、令牌刷新与 Windows 加密保存已存在。0.8.5 增加独立保存应用编号、本地条件检查和官方设置入口。保存编号不再受 Java / 内存设置是否完整的影响。检查只确认编号格式与本机加密存储，不向微软发起设备码请求，也不证明应用归属、权限或审批通过。

## 维护者需要完成的步骤
1. 登录 https://entra.microsoft.com/，在自己的租户中注册 NHMCL-StarQuill。微软当前注册指南列有 Azure 账号、订阅、租户及相应注册角色前提；以你的账号界面为准，不要因此向他人购买或借用应用编号。
2. 支持账号类型选“仅个人 Microsoft 账号”，或明确包含个人账号的多租户选项。本项目使用 consumers 端点。
3. 身份验证设置启用公共客户端流，供设备码协议使用。此流程无需回调 URI，不需要 Client Secret。不要把密钥打包进 EXE。
4. 记录概览中的 Application (client) ID，不能拿 Directory (tenant) ID 或 Object ID 代替；它们可能同样符合 UUID 格式，所以本地格式检查无法区分。
5. 核对 Minecraft API 访问要求，使用 https://aka.ms/mce-reviewappid 申请入口按官方实际要求准备资料。本次确认该链接仍跳转到 Microsoft Forms，但工具无法读取表单内容，不能确认当前受理状态、字段或审核周期。保存 Client ID 不等于已取得 API 许可。
6. 启动器“账号与皮肤 → 项目登录配置”保存公开 Client ID，点击“检查本地接入条件”。获得访问许可后点击微软登录，在官方网页核对应用名称并完成授权。
7. 后续验证应依次覆盖：设备码、取消 / 超时、Xbox 账号限制、Minecraft 权益及玩家档案、重启后令牌刷新、游戏登录。未拥有 Java 版权益的账号应显示清晰失败信息，不能绕过权益校验。

当前请求范围为 XboxLive.signin offline_access；不要为了此登录额外申请邮件、通讯录或组织管理权限。设备码只在用户主动点击登录时请求。

## 申请资料草稿（核对后填写，不是已提交的申请）
- 应用名称：NHMCL-StarQuill / 星翎启动器
- 发起者：StarQuill_z12244
- 维护与发行：南湖模作社（维护者需确认对应的真实申请主体）
- 用途：Windows 10 / 11 x64 Minecraft Java Edition 第三方启动器，用于经用户授权登录、验证游戏权益、读取玩家档案与启动游戏。
- Application (client) ID：[注册后填写]
- 真实联系邮箱：[填写维护者可接收审核邮件的邮箱]
- 项目公开网站 / 源码仓库 / 发布地址：[填写真实公开链接，不虚构]
- 隐私说明地址：[准备并发布后填写]
- 授权方式：Microsoft OAuth 2.0 Device Authorization Grant；客户端不收集微软密码。
- 数据流：Microsoft → Xbox Live → XSTS → Minecraft Services；客户端按需刷新令牌。
- 本地存储：EXE 同目录 .starquill-profile/accounts.json。账号令牌由 Electron safeStorage / Windows DPAPI 加密，不发送给启动器维护者，不明文写入界面或日志。
- 删除方式：启动器中移除账号会清除对应本地记录；当前版本移除不会自动撤销浏览器会话或微软服务器授权，撤销远端授权需在 Microsoft 账号管理页面操作。
- 跨电脑：只复制 EXE 不携带账号；复制整个档案目录后也可能因 Windows 加密绑定需要重新登录。

上面的数据说明是项目申请素材草稿。维护者需核对实际发行版本与后续统计、更新等服务的行为后再发布为正式隐私声明。

## 核实来源
- 微软应用注册指南：https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app
- 设备码协议：https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-device-code
- 公共客户端 / 设备码支持：https://learn.microsoft.com/en-us/entra/identity-platform/msal-authentication-flows

本次只进行基础检查和账号流程样例测试，不进行深度测试；没有真实 Client ID 的端到端登录结果。

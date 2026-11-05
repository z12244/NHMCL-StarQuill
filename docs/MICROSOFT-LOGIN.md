# 微软正版登录配置

本版本已实现设备码登录、Xbox Live / XSTS 认证、Minecraft 权益与玩家档案读取、令牌刷新和 Windows 加密保存。**发行项目尚未提供自己的 Client ID，因此当前 EXE 的微软登录按钮会提示未配置。真实微软账号端到端登录尚未验证。** 离线账号、Java 自动选择、内存设置和离线皮肤不依赖此编号。

## 为项目取得应用编号

1. 由项目维护者登录 [Microsoft Entra 管理中心](https://entra.microsoft.com/)，进入应用注册，创建 `NHMCL-StarQuill` 应用。账号需有相应租户与应用注册权限；具体前提以[微软应用注册文档](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app)为准。
2. 支持的账号类型选择包含个人 Microsoft 账号的选项，例如“仅个人 Microsoft 账号”。启动器使用 `consumers` 端点。
3. 在应用身份验证设置中允许公共客户端流，以支持设备码登录。此桌面应用不需要、也不应嵌入 Client Secret。
4. 记录概览页的 **Application (client) ID**，通常是 `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`。
5. 通过 [Minecraft 应用访问申请入口](https://aka.ms/mce-reviewappid)申请 Minecraft API 访问，按表单要求提交项目资料。申请受理和授权以微软答复为准，仅注册应用编号不代表已经获准使用 Minecraft API。
6. 在启动器「账号与皮肤 → 项目登录配置」填写自己的公开 Client ID 并保存，无需重新编译。不要填写密钥，也不要借用 HMCL、PCL、官方启动器等其他应用的编号。

设备码协议参考：[Microsoft OAuth 2.0 device authorization grant](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-device-code)。本实现请求 `XboxLive.signin offline_access`。

## 用户登录步骤

点击「使用微软账号登录」，获取一次性登录码；点击「打开微软授权网页」，核对应用名称并自行输入代码、完成登录与授权。返回启动器等待账号加入。登录码到期或拒绝授权后可以重新开始，也可随时取消。

启动前会按需刷新过期令牌。刷新失败会提示重新登录，不会把正版身份偷偷改成离线身份。Xbox 家庭限制、缺少 Java 版权益、未建立玩家档案和应用未获授权会分别提示。移除账号只清除启动器保存的登录，不退出浏览器中的 Microsoft 会话。

## 保存位置与测试范围

账号存放在EXE 同目录的 `.starquill-profile/accounts.json`。公开玩家资料与加密令牌分开保存；令牌通过 Electron safeStorage / Windows DPAPI 加密，不传到界面，也不写入明文日志。换 Windows 用户或迁移到另一台电脑后可能需要重新登录。这不防止以同一个 Windows 用户身份运行的恶意程序读取账号信息。机制参考：[Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)。

自动测试覆盖登录码轮询/降频/过期/取消、Xbox 家庭错误、游戏权益校验、刷新令牌轮换、加密持久化与启动参数。Windows DPAPI 已在本机实测。由于没有项目 Client ID，没有进行真实账号授权、购买权益或在线服务器登录验证。

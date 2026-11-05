# 第三方皮肤站登录

NHMCL-StarQuill 0.5.0 增加标准 Yggdrasil / authlib-injector 外置登录。内置 LittleSkin、MUA 用户中心，也可填写其他皮肤站提供的 HTTPS Yggdrasil API 地址。

## 使用方法

1. 在皮肤站注册自己的账号并创建游戏角色，在该站为角色设置皮肤或披风。
2. 打开启动器「账号与皮肤 → 第三方皮肤站登录」，选择 LittleSkin 或 MUA，点击「识别皮肤站」。自定义站点可粘贴其 API 地址；支持 HTTPS 跳转与 ALI 地址发现。
3. 核对显示的站点名称和完整认证地址，填写该站的邮箱或受支持的角色名，以及皮肤站密码。启用了二步验证、无密码登录或站点限制时，按该站文档配置传统 Yggdrasil 登录可用的密码 / 应用密码。
4. 点击「登录皮肤站」。只有一个角色或服务端已绑定角色时会直接加入账号列表；返回多个未绑定角色时，会显示选择框，点击「使用此角色」完成添加。
5. 选中此账号启动游戏。启动器会验证或刷新会话，并加载随包提供的 authlib-injector，使用该站角色的 UUID、皮肤与披风。它不使用离线皮肤代理，也不会把该角色改成离线 UUID。

如需同一皮肤站账号的其他角色，可重新添加并选择角色；部分站点在登录时已经绑定角色，此时以其返回的角色为准。移除账号会尝试撤销这条会话并删除本地记录，不会注销该站账号的所有设备。

## 接入地址与依据

- LittleSkin：`https://littleskin.cn/api/yggdrasil/`，见 [LittleSkin 官方外置登录文档](https://manual.littlesk.in/yggdrasil/)。
- MUA 用户中心：`https://skin.mualliance.ltd/api/yggdrasil/`，由 [MUA 实际认证接口](https://skin.mualliance.ltd/api/yggdrasil)返回站点名称、签名公钥及配置。
- 协议：[authlib-injector Yggdrasil 服务端规范](https://yushijinhun.github.io/authlib-injector/en/yggdrasil-server-technical-specification.html)。

此登录不需要微软 Client ID。皮肤站身份与微软正版身份分别管理；皮肤站账号可用于单人游戏和接受相应外置认证的服务器，不能作为微软正版服务器认证凭据。游戏内的原生多人游戏功能没有另作改动。

## 账号数据

密码只在本次登录请求中通过 HTTPS 发给已经识别的站点，提交后清空输入框；不会保存到设置文件、账号文件或日志。访问令牌和客户端令牌使用 Windows DPAPI 加密保存，界面只接收公开角色资料。登录 POST 不跟随重定向，避免把凭据转发到新的地址。API 地址在后续启动时发生变更，需要重新添加并确认。

未完成角色选择的临时会话五分钟后清除，取消时会尝试撤销临时令牌。账号失效时要求重新登录，不会静默切换为离线账号。

## 当前验证范围

两个内置站点的真实配置接口已经读取验证。自动测试覆盖 HTTPS / ALI 发现、多角色绑定、已有绑定角色、会话验证和刷新、注销、UUID、加密持久化、密码清空与游戏参数；桌面测试使用本地协议模拟站验证完整界面流程和游戏启动。

未使用你的真实 LittleSkin / MUA 账号登录，也未验证它们的二步验证设置或特定服务器进服权限。遇到此类站点侧限制，需要按站点说明操作。此版本实现传统 Yggdrasil 账号密码方式，未实现皮肤站 OAuth / Passkey 浏览器登录。

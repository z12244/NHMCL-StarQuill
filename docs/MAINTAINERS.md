# 维护说明

## 权限与保护

- **`main` 分支保护**：
  - 必须通过 Pull Request 合并，且至少 1 人批准；
  - 禁止 force push、禁止删除分支；
  - 仓库管理员可绕过（用于紧急修复）。
- **Tag 保护**（Repository ruleset `protect-release-tags`）：
  - 匹配 `stable-*`、`beta*`、`old-versions`；
  - 禁止新建、删除、强制移动，仅管理员可绕过。
- **协作者（Write）**：可在普通分支推送、开 PR；合并 `main` 需 owner 批准；不能直接改受保护 tag。

## 发布约定

- **Release 与 tag 由 owner 操作**：创建/删除 Release、上传/删除附件、新建/移动 tag 均需 owner 确认。
- 协作者如需发布，请开 PR 或开 issue 说明版本与改动，由 owner 执行发布。
- tag 命名沿用：`stable-x.y.z`、`beta-x.y.z`；历史归档 tag 为 `old-versions`。

## 发版流程（owner）

1. 更新 `package.json` 的版本号、`displayVersion`、`releaseName`；
2. 构建并验证（见 [构建说明](BUILD.md)）；
3. 创建 tag 与 Release，上传 EXE / 源码 / 校验文件；
4. 更新 README 与 Release 正文中的版本说明。

## 安全提示

- 本机凭据（`.git-credentials`、PAT、构建密钥）不放入仓库，也不随交接文档传递；
- 协作者权限变更后，检查仓库 Audit log；
- 历史源码包已迁移到 Release 附件（`old-versions` tag），不再提交进源码树。

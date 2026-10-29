# demoputter

> 一个给 AI 用的仓库工作台。预览板、文件树、版本、工作流，一个界面管完。

![demoputter](https://img.shields.io/badge/version-0.1.0-0071e3?style=flat-square)
![license](https://img.shields.io/badge/license-MIT-30d158?style=flat-square)
![no-backend](https://img.shields.io/badge/backend-none-a78bfa?style=flat-square)

## 这是什么

**demoputter** 是一个**纯前端**的 GitHub 仓库工作台，用 GitHub Personal Access Token 连接你的账号，然后把这些事放进同一个界面：

- **仓库列表** —— 你的全部仓库，按更新时间排序，公开/私有标签一眼区分
- **文件树** —— 点进任意目录，逐层浏览
- **文件预览 / 编辑** —— 带行号的编辑器，支持 Tab 缩进、Ctrl+S 快捷保存
- **一键提交** —— 改完直接 commit 到当前分支（GitHub API 的方式，提交即推送）
- **工作流** —— 查看 GitHub Actions 最近 10 次运行记录与结论

**没有后端、没有服务器、没有数据库**。token 只存在你浏览器的 `localStorage` 里，所有请求直接从浏览器打到 `api.github.com`。

## 为什么叫 demoputter

putter 是"闲逛、摆弄"；demo 是"演示"。一个让你随手摆弄 demo 仓库的地方。

## 设计

- **Apple 风白蓝体系**：`#f5f5f7` 背景 + `#ffffff` 卡片 + `#0071e3` 强调
- **毛玻璃导航**：`backdrop-filter: saturate(180%) blur(20px)`
- **比例系统**：
  - 黄金分割 `1.618` —— 三栏布局 `0.618fr : 1fr : 1.618fr`
  - 白银分割 `1.414` —— 字号阶梯（10.5 / 12 / 15 / 21 / 30）与间距阶梯
- **缓动**：`cubic-bezier(.32,.72,0,1)`，Apple 默认动效曲线
- **无框架**：手写 HTML / CSS / JS，零依赖

## 快速开始

```bash
git clone https://github.com/wuyixiao123/demoputter.git
cd demoputter
python -m http.server 8080
# 打开 http://127.0.0.1:8080
```

或者直接把 `index.html` 拖进浏览器（`file://` 也能用）。

然后：

1. 去 https://github.com/settings/tokens 生成一个 **classic token**，勾 `repo`（要读工作流再加 `workflow`）
2. 粘贴到顶部输入框，点「连接」
3. 左侧选仓库 → 中间点目录 → 右侧改文件 → 底部「提交」

## 快捷键

| 键 | 作用 |
|---|---|
| `Ctrl+S` / `Cmd+S` | 提交当前文件 |
| `Tab` | 插入两个空格 |
| `Enter`（token 框） | 连接 |

## 给 AI 用

demoputter 的界面就是为"AI 辅助操作"设计的：**人类看着屏幕，AI 通过它的 token 直接调 API**。同一个 token 可以给 DSH、Claude、Cursor 用，界面只是给人看的"预览板"。

路线图里有一个 **AI shell**（`demoputter-cli`）：让 AI 用命令行完成「看树 → 读文件 → 改 → 提交 → 跑工作流」，界面负责让人确认。欢迎提 issue 讨论形式。

## 功能清单

- [x] token 连接与本地持久化
- [x] 仓库列表（含公开/私有标识）
- [x] 文件树逐层浏览
- [x] 文件预览 + 编辑器（行号、Tab、Ctrl+S）
- [x] 一键提交（含 commit message）
- [x] 工作流运行记录
- [ ] AI shell（CLI / MCP）
- [ ] 分支切换
- [ ] 提交历史与 diff 视图
- [ ] 构建产物面板（Releases / Artifacts）

## License

MIT

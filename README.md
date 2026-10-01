# 路线打印卡生成服务

服务端渲染的徒步路线单页 PDF 生成系统。网页选择**路线版本、步行方式和字段**，后台异步生成 A4/Letter 单页 PDF；PostgreSQL 记录冻结内容、版式参数、原始来源和任务状态。

## 核心规则

- 服务端统一版式：最终 PDF 与容量估算共用 `src/layout.js`，不依赖浏览器打印样式。
- 单页硬约束：A4/Letter 标准纸张，最小正文字号 9pt；禁止自动缩字或新增第二页。
- 提交前估算：返回内容高度、容量占比、溢出高度和必需字段错误。
- 明确摘要规则：
  - 完整卡片：溢出即拒绝。
  - 拐点摘要：保留强制安全信息和关键拐点，明确列出折叠项。
  - 安全最小卡：保留起终点、退出点、注意事项、用时和关键补给。
- 必需信息：起终点、退出点、注意事项缺失时返回 422，不静默丢弃。
- 信息新鲜度：厕所/饮水显示核对时间；超过阈值或缺少日期显示“待确认”。
- 用时依据：按步行方式输出估算分钟和明确依据。
- 冻结版本：任务绑定 `route_version_id`；生成期间路线发布新版本不会改变任务。
- 可恢复任务：worker 重启时把 `rendering` 重置为 `queued`。
- 下载重新鉴权：完成后由登录用户换取 10 分钟、一次性签名链接。
- 路线撤回：既有下载返回 410，任务/链接显示过期。
- PDF 验收：无地图图像、无长标题硬塞、无窄纸张、无缺失字体、无全站导航、无私有编辑字段；页脚注明版本、信息日期和版式。

## 技术栈

- Node.js 20 + Express 5
- PostgreSQL 16
- PDFKit 0.20
- 内置 Noto Sans SC WOFF 字体
- 原生 HTML/CSS/JavaScript 前端

## 本地运行

### Docker Compose

```bash
docker compose up -d --build
open http://localhost:3000
```

默认账号在 `docker-compose.yml` 中：

- 用户名：`admin`
- 密码：`change-me`

生产环境必须修改 `ADMIN_PASSWORD`、`SESSION_SECRET`、`DOWNLOAD_SECRET`。

### 不用容器

先创建 PostgreSQL 数据库，然后：

```bash
cp .env.example .env
# 按实际数据库修改 .env
npm install
npm run migrate
npm start
```

## 主要接口

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---:|---|
| `POST` | `/api/auth/login` | 否 | 获取会话 token |
| `GET` | `/api/routes` | 否 | 查看已发布路线及当前版本 |
| `GET` | `/api/options` | 否 | 纸张、步行方式、字段、摘要规则 |
| `POST` | `/api/routes/:id/estimate` | 否 | 提交前容量估算 |
| `POST` | `/api/routes/:id/preview.pdf` | 否 | 通过容量检查的 PDF 预览 |
| `POST` | `/api/tasks` | 是 | 创建生成任务，支持 `Idempotency-Key` |
| `GET` | `/api/tasks/recent` | 是 | 最近 10 个可恢复任务 |
| `GET` | `/api/tasks/:id` | 是 | 查询任务状态 |
| `GET` | `/api/tasks/:id/preview` | 是 | 冻结 HTML 预览 |
| `POST` | `/api/tasks/:id/download-token` | 是 | 换取短期一次性下载 URL |
| `GET` | `/files/:id/route-card.pdf?token=...` | 签名 token | 下载 PDF |
| `POST` | `/api/admin/routes/:id/withdraw` | 是 | 撤回路线并令旧链接过期 |

## 数据模型要点

- `routes`：路线逻辑实体和当前版本。
- `route_versions`：不可变版本，`content` 为公开内容，`editor_private` 为私有编辑字段。
- `card_tasks`：
  - `frozen_content`：最终内容块和内容哈希。
  - `layout_params`：纸张、边距、字号、步行方式、摘要规则、字段集合、版式版本。
  - `source_snapshot`：公开原始来源、信息日期和核对时间。
  - `estimate`：提交前高度/溢出估算。
  - `status`：`queued`、`rendering`、`completed`、`failed`、`expired`。
- `download_tokens`：下载 token 哈希、过期时间和一次性使用时间。

## 测试

```bash
npm test
```

测试覆盖：短路线单页容量、长路线完整规则溢出、摘要规则显式折叠、必需信息保留、过期补给“待确认”、PDF 单页、无图像和私有字段泄漏。

更多设计依据见 [`docs/printing-architecture.md`](docs/printing-architecture.md)。

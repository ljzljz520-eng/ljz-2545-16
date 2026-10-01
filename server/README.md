# 路线打印卡生成服务

服务端使用 Express + PDFKit 渲染**单页 A4 竖版 PDF**；网页仅负责选择路线版本、步行方式、可选字段与明确摘要规则，并显示同一内容模型的服务端 HTML 预览。

## 快速开始

```bash
cd server
npm test          # 单页容量、PDF 内容、冻结/撤回验收
npm start         # 无 DATABASE_URL 时使用内存存储，适合本地演示
```

打开 <http://localhost:3000/route-cards.html>。

接口需要请求头 `X-Owner-Key: <调用方用户标识>`；生产应由网关注入已认证用户 ID。下载不是永久 URL：先 POST 到任务的 `download/request`，得到 60 秒一次性、HMAC 签名、带过期时间的链接。路线撤回接口需要 `X-Admin-Token`。

## PostgreSQL

配置 `DATABASE_URL` 后启动会自动执行 `sql/schema.sql` 并播种演示路线：

```bash
DATABASE_URL=postgres://routecard:routecard@localhost:5432/routecard npm start
```

`card_jobs` 持久化：

- `frozen_content`：提交时冻结的卡片内容与版本/信息日期；
- `layout_params`：A4、边距、PDFKit、嵌入字体、最小字号等布局参数；
- `source_refs`：原始来源引用（含内部来源），仅留在任务记录，不写入公开 PDF；
- `estimate`：提交前使用 PDF 字体度量得到的高度、容量和溢出值。

## 单页规则

- 固定 A4 竖版（595.28 × 841.89 pt），拒绝窄纸张和横向/多页。
- 正文字号不低于 9pt，不以自动缩小字号处理长路线。
- 起终点、预计用时及依据、撤出点、注意事项是强制内容。
- `essential`：保留关键岔路，普通路点省略；设施摘要保留至少一条过期设施以显示“待确认”。
- `landmarks`：关键岔路 + 等距抽样，长样例最多 7 个路点。
- `full`：不主动摘要；容量不足返回 422，禁止提交。
- 厕所/饮水带核对时间；超过 180 天显示“资料待确认”。

## 安全与撤回

- PDF 嵌入 Noto Sans SC Regular/Bold，不依赖客户端字体。
- PDF/预览不包含地图图像、全站导航、长标题或私有编辑字段。
- 任务创建后冻结路线版本；生成期间路线更新不会重写既有任务。
- 路线版本撤回后，旧任务下载和冻结预览均返回 410，并显示链接已过期。

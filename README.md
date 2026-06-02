# hyf.log

一个零依赖静态博客。文章写在 `posts/`，构建产物生成到 `dist/`，推到 GitHub 后由 GitHub Actions 自动发布到 GitHub Pages。

## 本地预览

```bash
cd /Users/huyangfan/Desktop/workspace/learning-blog
npm run dev
```

打开：

```text
http://127.0.0.1:4173
```

## 新建文章

推荐用脚手架创建：

```bash
npm run new -- redis-cache-consistency "Redis 缓存一致性笔记"
```

它会生成：

```text
posts/redis-cache-consistency.md
```

也可以直接在 `posts/` 里手写 Markdown。文章开头必须有 front matter：

```markdown
---
title: Redis 缓存一致性笔记
date: 2026-06-02
category: 课程笔记
tags: [Redis, 后端, 缓存]
excerpt: 梳理缓存失效、双写一致性和常见工程取舍。
---

# Redis 缓存一致性笔记

正文从这里开始。
```

支持的字段：

- `title`：文章标题
- `date`：日期，格式 `YYYY-MM-DD`
- `category`：分类，例如 `post`、`note`、`project`、`课程笔记`、`项目复盘`
- `tags`：标签数组
- `excerpt`：文章摘要，会显示在列表页

分类显示逻辑：

- `Posts` 永远显示全部文章。
- `Notes` 只是一种过滤入口，会显示 `category` 包含 `note`、`笔记` 或 `课程` 的文章。
- `Projects` 只是一种过滤入口，会显示 `category` 包含 `project` 或 `项目` 的文章。
- 普通博客文章默认用 `category: post`，直接 push 后一定会出现在 `Posts`。

## 发布流程

每次写完文章：

```bash
npm run build
git add posts scripts style.css package.json README.md .github
git commit -m "Add new post"
git push origin main
```

GitHub Actions 会自动执行：

```bash
npm run build
```

然后把 `dist/` 发布到 GitHub Pages。

## 第一次上线到 GitHub Pages

1. 在 GitHub 新建一个仓库，例如 `hyf-log`。
2. 把 `learning-blog` 目录作为仓库根目录推上去。
3. 打开仓库 `Settings -> Pages`。
4. `Build and deployment` 选择 `GitHub Actions`。
5. 推送到 `main` 后，等待 `Actions` 里的 `Deploy blog` 跑完。
6. 部署地址会显示在 Actions 的 deploy 步骤里，也会出现在 Pages 设置页。

## 自定义域名

如果以后有域名，在 `dist/` 发布前需要生成 `CNAME`。最简单的方式是在 `scripts/build.js` 里构建时写入：

```js
writeFile(path.join(distDir, "CNAME"), "your-domain.com\n");
```

然后到域名 DNS 里按 GitHub Pages 的要求配置记录。

## 文件结构

```text
posts/                  Markdown 文章
scripts/build.js         静态站点生成器
scripts/new-post.js      新文章脚手架
style.css                站点样式
dist/                    构建产物，GitHub Actions 自动生成
.github/workflows/       GitHub Pages 自动部署
```

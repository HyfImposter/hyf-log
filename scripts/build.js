const fs = require("fs");
const path = require("path");
const http = require("http");

const rootDir = path.resolve(__dirname, "..");
const postsDir = path.join(rootDir, "posts");
const assetsDir = path.join(rootDir, "assets");
const distDir = path.join(rootDir, "dist");

const args = new Set(process.argv.slice(2));
const site = {
  name: "hyf.log",
  description: "个人技术博客，写代码、系统、工具和一些长期问题。",
};

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function emptyDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  ensureDir(dir);
}

function copyDir(from, to) {
  if (!fs.existsSync(from)) return;
  ensureDir(to);
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(source, target);
    else fs.copyFileSync(source, target);
  }
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function slugify(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/\.md$/, "")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

function parseValue(value) {
  const trimmed = value.trim();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed
      .slice(1, -1)
      .split(",")
      .map((item) => item.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);
  }
  return trimmed.replace(/^["']|["']$/g, "");
}

function parseFrontMatter(raw) {
  if (!raw.startsWith("---\n")) return [{}, raw];
  const end = raw.indexOf("\n---", 4);
  if (end === -1) return [{}, raw];
  const frontMatter = raw.slice(4, end).trim();
  const body = raw.slice(end + 4).trim();
  const data = {};

  for (const line of frontMatter.split(/\r?\n/)) {
    const match = line.match(/^([\w-]+):\s*(.*)$/);
    if (match) data[match[1]] = parseValue(match[2]);
  }

  return [data, body];
}

function inlineMarkdown(value) {
  let html = escapeHtml(value);
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  return html;
}

function markdownToHtml(markdown) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const html = [];
  let paragraph = [];
  let list = null;
  let quote = [];
  let code = null;

  function flushParagraph() {
    if (!paragraph.length) return;
    html.push(`<p>${inlineMarkdown(paragraph.join(" "))}</p>`);
    paragraph = [];
  }

  function flushList() {
    if (!list) return;
    html.push(`<${list.type}>${list.items.map((item) => `<li>${inlineMarkdown(item)}</li>`).join("")}</${list.type}>`);
    list = null;
  }

  function flushQuote() {
    if (!quote.length) return;
    html.push(`<blockquote>${quote.map((item) => `<p>${inlineMarkdown(item)}</p>`).join("")}</blockquote>`);
    quote = [];
  }

  function flushOpenBlocks() {
    flushParagraph();
    flushList();
    flushQuote();
  }

  for (const line of lines) {
    const fence = line.match(/^```(\w+)?\s*$/);
    if (fence && !code) {
      flushOpenBlocks();
      code = { lang: fence[1] || "", lines: [] };
      continue;
    }
    if (fence && code) {
      html.push(`<pre><code class="language-${escapeHtml(code.lang)}">${escapeHtml(code.lines.join("\n"))}</code></pre>`);
      code = null;
      continue;
    }
    if (code) {
      code.lines.push(line);
      continue;
    }

    if (!line.trim()) {
      flushOpenBlocks();
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushOpenBlocks();
      const level = heading[1].length;
      html.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }

    const unordered = line.match(/^[-*]\s+(.+)$/);
    if (unordered) {
      flushParagraph();
      flushQuote();
      if (!list || list.type !== "ul") list = { type: "ul", items: [] };
      list.items.push(unordered[1]);
      continue;
    }

    const ordered = line.match(/^\d+\.\s+(.+)$/);
    if (ordered) {
      flushParagraph();
      flushQuote();
      if (!list || list.type !== "ol") list = { type: "ol", items: [] };
      list.items.push(ordered[1]);
      continue;
    }

    const blockquote = line.match(/^>\s+(.+)$/);
    if (blockquote) {
      flushParagraph();
      flushList();
      quote.push(blockquote[1]);
      continue;
    }

    paragraph.push(line.trim());
  }

  flushOpenBlocks();
  if (code) {
    html.push(`<pre><code class="language-${escapeHtml(code.lang)}">${escapeHtml(code.lines.join("\n"))}</code></pre>`);
  }
  return html.join("\n");
}

function stripMarkdown(markdown) {
  return markdown
    .replace(/```[\s\S]*?```/g, "")
    .replace(/[#>*_`[\]()]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function readingMinutes(markdown) {
  const text = stripMarkdown(markdown);
  const englishWords = text.match(/[A-Za-z0-9]+/g) || [];
  const chineseChars = text.match(/[\u4e00-\u9fa5]/g) || [];
  return Math.max(1, Math.ceil((englishWords.length + chineseChars.length / 2) / 220));
}

function readPosts() {
  ensureDir(postsDir);
  return fs
    .readdirSync(postsDir)
    .filter((file) => file.endsWith(".md"))
    .map((file) => {
      const raw = fs.readFileSync(path.join(postsDir, file), "utf8");
      const [meta, body] = parseFrontMatter(raw);
      const slug = meta.slug ? slugify(meta.slug) : slugify(file);
      const title = meta.title || slug;
      const date = meta.date || new Date().toISOString().slice(0, 10);
      return {
        slug,
        title,
        date,
        category: meta.category || "文章",
        tags: Array.isArray(meta.tags) ? meta.tags : [],
        excerpt: meta.excerpt || stripMarkdown(body).slice(0, 110),
        body,
        html: markdownToHtml(body),
        minutes: readingMinutes(body),
      };
    })
    .sort((a, b) => dateValue(b.date) - dateValue(a.date));
}

function dateValue(date) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const [year, month, day] = date.split("-").map(Number);
    return Date.UTC(year, month - 1, day);
  }
  return new Date(date).getTime();
}

function formatDate(date) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const [year, month, day] = date.split("-");
    return `${year}/${month}/${day}`;
  }
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(date));
}

function uniqueCategories(posts) {
  return [...new Set(posts.map((post) => post.category))];
}

function pageShell({ title, description, body, current = "page" }) {
  const rootPrefix = current === "post" ? "../../" : "";
  const homeHref = `${rootPrefix}index.html`;
  const articlesHref = `${rootPrefix}posts.html`;
  const notesHref = `${rootPrefix}posts.html?category=${encodeURIComponent("课程笔记")}`;
  const projectsHref = `${rootPrefix}posts.html?category=${encodeURIComponent("项目复盘")}`;
  const aboutHref = current === "post" ? "../../about.html" : "about.html";
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <link rel="stylesheet" href="${current === "post" ? "../../style.css" : "style.css"}">
</head>
<body>
  <header class="site-header">
    <a class="brand" href="${homeHref}" aria-label="返回首页">
      <span class="brand-mark">~/</span>
      <span>${site.name}</span>
    </a>
    <nav class="nav" aria-label="主导航">
      <a href="${articlesHref}">Posts</a>
      <a href="${notesHref}">Notes</a>
      <a href="${projectsHref}">Projects</a>
      <a href="${aboutHref}">About</a>
    </nav>
    <a class="write-link" href="${articlesHref}">Archive</a>
  </header>
  ${body}
  <footer class="site-footer">
    <p>${site.name} / built ${new Date().toISOString().slice(0, 10)} / plain Markdown, static HTML.</p>
  </footer>
</body>
</html>`;
}

function renderPostCard(post) {
  const searchText = [post.title, post.excerpt, post.category, ...post.tags].join(" ");
  return `<article class="post-card" data-title="${escapeHtml(post.title)}" data-category="${escapeHtml(post.category)}" data-date="${escapeHtml(post.date)}" data-minutes="${post.minutes}" data-search="${escapeHtml(searchText)}">
  <div class="post-meta">
    <span>${escapeHtml(post.category)}</span>
    <span>${formatDate(post.date)}</span>
    <span>${post.minutes} 分钟读完</span>
  </div>
  <h3><a href="posts/${post.slug}/">${escapeHtml(post.title)}</a></h3>
  <p>${escapeHtml(post.excerpt)}</p>
  <div class="tag-row">${post.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div>
</article>`;
}

function renderHome(posts) {
  const recent = posts.slice(0, 3);

  const body = `<main>
  <section class="hero">
    <div class="hero-copy">
      <h1>写代码，也写代码背后的问题。</h1>
      <p><span>一个普通的个人技术博客。</span><span>系统设计 / 后端 / 工具 / 长期问题。</span></p>
      <div class="hero-actions">
        <a class="button primary" href="posts.html">Read posts</a>
        <a class="button secondary" href="about.html">About</a>
      </div>
    </div>
    <div class="hero-visual" aria-label="博客代码视觉">
      <div class="terminal-window">
        <div class="terminal-top">
          <span></span><span></span><span></span>
          <code>~/blog</code>
        </div>
        <pre><code>$ grep -R "why" posts/
systems/cache.md: why consistency is hard
java/threads.md: why pools fail quietly
tools/shell.md: why small scripts matter

$ node scripts/build.js
Built ${posts.length} posts into ./dist</code></pre>
      </div>
    </div>
  </section>

  <section class="home-posts" id="articles">
    <div class="section-heading">
      <h2>Latest posts</h2>
      <a href="posts.html">All posts</a>
    </div>
    <div class="posts">${recent.map(renderPostCard).join("")}</div>
  </section>
</main>`;

  return pageShell({
    title: site.name,
    description: site.description,
    body,
    current: "home",
  });
}

function renderPostsPage(posts) {
  const categories = uniqueCategories(posts);
  const filters = [
    `<button type="button" class="filter-button active" data-filter="all">All</button>`,
    ...categories.map((category) => `<button type="button" class="filter-button" data-filter="${escapeHtml(category)}">${escapeHtml(category)}</button>`),
  ].join("");

  const body = `<main class="archive-shell">
  <section class="archive-hero">
    <h1>Posts</h1>
    <p>所有文章都在这里。按分类过滤，按时间或阅读时长排序，也可以直接搜标题、摘要和标签。</p>
  </section>

  <section class="post-toolbar" aria-label="文章过滤和排序">
    <div class="filter-row" aria-label="分类过滤">
      ${filters}
    </div>
    <label class="search-field">
      <span>Search</span>
      <input id="post-search" type="search" placeholder="title, tag, keyword">
    </label>
    <label class="sort-field">
      <span>Sort</span>
      <select id="post-sort">
        <option value="newest">Newest first</option>
        <option value="oldest">Oldest first</option>
        <option value="shortest">Shortest read</option>
        <option value="longest">Longest read</option>
      </select>
    </label>
  </section>

  <section class="archive-results">
    <div class="section-heading">
      <h2>All posts</h2>
      <p><span id="post-count">${posts.length}</span> / ${posts.length}</p>
    </div>
    <div class="posts archive-list" id="post-list">${posts.map(renderPostCard).join("")}</div>
    <p class="empty-state" id="empty-state" hidden>No posts match this filter.</p>
  </section>

  <script>
  (() => {
    const list = document.querySelector("#post-list");
    const cards = [...document.querySelectorAll(".post-card")];
    const buttons = [...document.querySelectorAll("[data-filter]")];
    const search = document.querySelector("#post-search");
    const sort = document.querySelector("#post-sort");
    const count = document.querySelector("#post-count");
    const empty = document.querySelector("#empty-state");
    const params = new URLSearchParams(window.location.search);
    let category = params.get("category") || "all";

    if (!buttons.some((button) => button.dataset.filter === category)) {
      category = "all";
    }

    function setActiveButton() {
      buttons.forEach((button) => {
        button.classList.toggle("active", button.dataset.filter === category);
      });
    }

    function updateUrl() {
      const next = new URL(window.location.href);
      if (category === "all") next.searchParams.delete("category");
      else next.searchParams.set("category", category);
      window.history.replaceState({}, "", next);
    }

    function applyFilters() {
      const query = search.value.trim().toLowerCase();
      const sorted = [...cards].sort((a, b) => {
        if (sort.value === "oldest") return a.dataset.date.localeCompare(b.dataset.date);
        if (sort.value === "shortest") return Number(a.dataset.minutes) - Number(b.dataset.minutes);
        if (sort.value === "longest") return Number(b.dataset.minutes) - Number(a.dataset.minutes);
        return b.dataset.date.localeCompare(a.dataset.date);
      });

      let visibleCount = 0;
      sorted.forEach((card) => {
        const matchCategory = category === "all" || card.dataset.category === category;
        const matchQuery = !query || card.dataset.search.toLowerCase().includes(query);
        const visible = matchCategory && matchQuery;
        card.hidden = !visible;
        if (visible) visibleCount += 1;
        list.appendChild(card);
      });

      count.textContent = visibleCount;
      empty.hidden = visibleCount !== 0;
      setActiveButton();
      updateUrl();
    }

    buttons.forEach((button) => {
      button.addEventListener("click", () => {
        category = button.dataset.filter;
        applyFilters();
      });
    });
    search.addEventListener("input", applyFilters);
    search.addEventListener("search", applyFilters);
    sort.addEventListener("change", applyFilters);
    applyFilters();
  })();
  </script>
</main>`;

  return pageShell({
    title: `Posts - ${site.name}`,
    description: "文章归档、分类过滤和排序。",
    body,
  });
}

function renderPost(post) {
  const body = `<main class="article-shell">
  <article class="article">
    <a class="back-link" href="../../posts.html">返回 Posts</a>
    <div class="article-meta">
      <span>${escapeHtml(post.category)}</span>
      <span>${formatDate(post.date)}</span>
      <span>${post.minutes} 分钟读完</span>
    </div>
    <h1>${escapeHtml(post.title)}</h1>
    <p class="article-excerpt">${escapeHtml(post.excerpt)}</p>
    <div class="tag-row article-tags">${post.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div>
    <div class="article-body">${post.html}</div>
  </article>
</main>`;

  return pageShell({
    title: `${post.title} - ${site.name}`,
    description: post.excerpt,
    body,
    current: "post",
  });
}

function renderAbout() {
  const body = `<main class="article-shell">
  <article class="article about">
    <h1>About</h1>
    <p class="article-excerpt">这是一个个人技术博客，主要写后端、系统、工具链和一些工程判断。</p>
    <div class="article-body">
      <h2>What I write</h2>
      <ul>
        <li>后端工程：Java、Spring、数据库、缓存和接口设计。</li>
        <li>系统问题：并发、事务、性能、可观测性和故障复盘。</li>
        <li>工具链：脚本、自动化、开发环境和一些小而稳的工作流。</li>
      </ul>
      <h2>Colophon</h2>
      <p>这个站点由 Markdown 生成，没有数据库，没有后台。内容放在 <code>posts/</code>，构建结果放在 <code>dist/</code>。</p>
    </div>
  </article>
</main>`;

  return pageShell({
    title: `About - ${site.name}`,
    description: "个人技术博客说明。",
    body,
  });
}

function renderWriteGuide() {
  const template = escapeHtml([
    "---",
    "title: Redis 缓存与一致性学习笔记",
    "date: 2026-06-02",
    "category: 课程笔记",
    "tags: [Redis, Java 后端, 缓存]",
    "excerpt: 梳理缓存穿透、缓存击穿、缓存雪崩和数据库一致性策略。",
    "---",
    "",
    "# Redis 缓存与一致性学习笔记",
    "",
    "## 本节目标",
    "",
    "## 核心概念",
    "",
    "## 关键代码",
    "",
    "## 常见误区",
    "",
    "## 自测问题",
  ].join("\n"));

  const body = `<main class="article-shell">
  <article class="article about">
    <h1>写新文章</h1>
    <p class="article-excerpt">在 <code>posts/</code> 目录新增一个 Markdown 文件，然后运行 <code>npm run build</code>。博客会自动生成首页列表和文章详情页。</p>
    <div class="article-body">
      <h2>推荐文件名</h2>
      <p>文件名建议用英文短横线，例如 <code>redis-cache-consistency.md</code> 或 <code>spring-boot-order-project.md</code>。</p>
      <h2>文章模板</h2>
      <pre><code>${template}</code></pre>
      <h2>项目复盘结构</h2>
      <ul>
        <li>背景：为什么做这个项目。</li>
        <li>技术栈：用了什么，以及为什么这样选。</li>
        <li>核心功能：挑 3 到 5 个真正有复杂度的功能。</li>
        <li>难点：写清楚业务后果、可选方案和最终取舍。</li>
        <li>收获：这次项目让你下次会怎么做。</li>
      </ul>
    </div>
  </article>
</main>`;

  return pageShell({
    title: `写新文章 - ${site.name}`,
    description: "个人博客写作指南。",
    body,
  });
}

function writeFile(filePath, content) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content);
}

function build() {
  emptyDir(distDir);
  copyDir(assetsDir, path.join(distDir, "assets"));
  const posts = readPosts();
  writeFile(path.join(distDir, "style.css"), fs.readFileSync(path.join(rootDir, "style.css"), "utf8"));
  writeFile(path.join(distDir, ".nojekyll"), "");
  writeFile(path.join(distDir, "index.html"), renderHome(posts));
  writeFile(path.join(distDir, "posts.html"), renderPostsPage(posts));
  writeFile(path.join(distDir, "about.html"), renderAbout());
  writeFile(path.join(distDir, "write.html"), renderWriteGuide());

  for (const post of posts) {
    writeFile(path.join(distDir, "posts", post.slug, "index.html"), renderPost(post));
  }

  console.log(`Built ${posts.length} posts into ${distDir}`);
}

function serve() {
  const port = Number(process.env.PORT || 4173);
  const server = http.createServer((req, res) => {
    const requestUrl = new URL(req.url, `http://127.0.0.1:${port}`);
    let filePath = path.join(distDir, decodeURIComponent(requestUrl.pathname));

    if (!filePath.startsWith(distDir)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
      filePath = path.join(filePath, "index.html");
    }

    if (!fs.existsSync(filePath)) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const ext = path.extname(filePath);
    const types = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".svg": "image/svg+xml",
      ".md": "text/markdown; charset=utf-8",
    };

    res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream" });
    fs.createReadStream(filePath).pipe(res);
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(`Preview: http://127.0.0.1:${port}`);
  });
}

function watch() {
  const rebuild = () => {
    try {
      build();
    } catch (error) {
      console.error(error);
    }
  };
  fs.watch(postsDir, { recursive: true }, rebuild);
  fs.watch(path.join(rootDir, "style.css"), rebuild);
  console.log("Watching posts and styles...");
}

build();
if (args.has("--serve")) serve();
if (args.has("--watch")) watch();

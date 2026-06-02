const fs = require("fs");
const path = require("path");

const postsDir = path.resolve(__dirname, "..", "posts");
const [, , slugArg, ...titleParts] = process.argv;

function slugify(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

function today() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const rawTitle = titleParts.join(" ").trim();
const title = rawTitle || "New Post";
const slug = slugify(slugArg || rawTitle || title);

if (!slug) {
  console.error("Usage: npm run new -- <slug> [title]");
  process.exit(1);
}

fs.mkdirSync(postsDir, { recursive: true });

const filePath = path.join(postsDir, `${slug}.md`);
if (fs.existsSync(filePath)) {
  console.error(`Post already exists: ${filePath}`);
  process.exit(1);
}

const content = `---
title: ${title}
date: ${today()}
category: post
tags: []
excerpt: 
---

# ${title}

## Notes

`;

fs.writeFileSync(filePath, content);
console.log(`Created ${filePath}`);

import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const postsDir = path.join(rootDir, "content", "posts");
const publicDir = path.join(rootDir, "public");

const site = {
  title: "Atelier",
  description: "Notes, fragments, and finished pieces.",
};

export async function buildSite() {
  const posts = await loadPosts();

  await rm(publicDir, { recursive: true, force: true });
  await mkdir(path.join(publicDir, "posts"), { recursive: true });

  await writeFile(path.join(publicDir, "index.html"), renderIndex(posts), "utf8");

  await Promise.all(
    posts.map((post) =>
      writeFile(path.join(publicDir, "posts", `${post.slug}.html`), renderPost(post), "utf8"),
    ),
  );

  await writeFile(
    path.join(publicDir, "feed.json"),
    JSON.stringify(
      {
        title: site.title,
        description: site.description,
        posts: posts.map(({ title, date, description, tags, url }) => ({
          title,
          date,
          description,
          tags,
          url,
        })),
      },
      null,
      2,
    ),
    "utf8",
  );

  return { posts: posts.length, publicDir };
}

async function loadPosts() {
  const entries = await readdir(postsDir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => name.endsWith(".md") && name !== "README.md")
    .sort();

  const posts = await Promise.all(
    files.map(async (file) => {
      const absolutePath = path.join(postsDir, file);
      const source = await readFile(absolutePath, "utf8");
      const { frontmatter, body } = parseFrontmatter(source);
      const slug = frontmatter.slug || slugify(path.basename(file, ".md"));
      const title = frontmatter.title || titleFromBody(body) || titleFromSlug(slug);
      const date = frontmatter.date || "";
      const description = frontmatter.description || firstParagraph(body);
      const tags = normalizeTags(frontmatter.tags);

      return {
        title,
        date,
        description,
        tags,
        slug,
        url: `posts/${slug}.html`,
        html: markdownToHtml(body),
      };
    }),
  );

  return posts.sort((a, b) => {
    if (!a.date && !b.date) return a.title.localeCompare(b.title);
    if (!a.date) return 1;
    if (!b.date) return -1;
    return b.date.localeCompare(a.date);
  });
}

function parseFrontmatter(source) {
  if (!source.startsWith("---\n")) {
    return { frontmatter: {}, body: source.trim() };
  }

  const end = source.indexOf("\n---", 4);
  if (end === -1) {
    return { frontmatter: {}, body: source.trim() };
  }

  const raw = source.slice(4, end).trim();
  const body = source.slice(end + 4).trim();
  return { frontmatter: parseYamlLite(raw), body };
}

function parseYamlLite(source) {
  const data = {};
  const lines = source.split(/\r?\n/);
  let activeListKey = null;

  for (const line of lines) {
    if (!line.trim()) continue;

    const listItem = line.match(/^\s*-\s+(.*)$/);
    if (listItem && activeListKey) {
      data[activeListKey].push(unquote(listItem[1].trim()));
      continue;
    }

    const pair = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!pair) continue;

    const [, key, rawValue] = pair;
    if (rawValue === "") {
      data[key] = [];
      activeListKey = key;
      continue;
    }

    data[key] = unquote(rawValue.trim());
    activeListKey = null;
  }

  return data;
}

function markdownToHtml(markdown) {
  const lines = markdown.split(/\r?\n/);
  const html = [];
  let paragraph = [];
  let list = null;
  let inCode = false;
  let codeLines = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    html.push(`<p>${renderInline(paragraph.join(" "))}</p>`);
    paragraph = [];
  };

  const flushList = () => {
    if (!list) return;
    html.push(`<${list.type}>${list.items.map((item) => `<li>${renderInline(item)}</li>`).join("")}</${list.type}>`);
    list = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    if (line.startsWith("```")) {
      if (inCode) {
        html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
        codeLines = [];
        inCode = false;
      } else {
        flushParagraph();
        flushList();
        inCode = true;
      }
      continue;
    }

    if (inCode) {
      codeLines.push(rawLine);
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length;
      html.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      continue;
    }

    const unordered = line.match(/^\s*[-*]\s+(.+)$/);
    if (unordered) {
      flushParagraph();
      if (!list || list.type !== "ul") list = { type: "ul", items: [] };
      list.items.push(unordered[1]);
      continue;
    }

    const ordered = line.match(/^\s*\d+\.\s+(.+)$/);
    if (ordered) {
      flushParagraph();
      if (!list || list.type !== "ol") list = { type: "ol", items: [] };
      list.items.push(ordered[1]);
      continue;
    }

    const quote = line.match(/^>\s+(.+)$/);
    if (quote) {
      flushParagraph();
      flushList();
      html.push(`<blockquote>${renderInline(quote[1])}</blockquote>`);
      continue;
    }

    paragraph.push(line.trim());
  }

  flushParagraph();
  flushList();

  if (inCode) {
    html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
  }

  return html.join("\n");
}

function renderIndex(posts) {
  const postList = posts.length
    ? `<ul>
${posts.map(renderPostCard).join("\n")}
</ul>`
    : `<p>No public posts yet.</p>`;

  return layout({
    title: site.title,
    description: site.description,
    body: `<center>
<h1>${escapeHtml(site.title)}</h1>
<p>${escapeHtml(site.description)}</p>
</center>
<hr>
<h2>Public Posts</h2>
${postList}`,
  });
}

function renderPost(post) {
  return layout({
    title: `${post.title} | ${site.title}`,
    description: post.description,
    paths: {
      home: "../",
      feed: "../feed.json",
    },
    body: `<h1>${escapeHtml(post.title)}</h1>
<p>${formatDate(post.date)}${renderTags(post.tags)}</p>
${post.description ? `<p>${escapeHtml(post.description)}</p>` : ""}
<hr>
${post.html}
<hr>
<p><a href="../">Back home</a></p>`,
  });
}

function renderPostCard(post) {
  return `<li><a href="${post.url}">${escapeHtml(post.title)}</a>
  <br>
  <small>${formatDate(post.date)}${renderTags(post.tags)}</small>
  ${post.description ? `<br>${escapeHtml(post.description)}` : ""}
</li>`;
}

function layout({ title, description, body, paths = { home: "./", feed: "feed.json" } }) {
  return `<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 3.2 Final//EN">
<HTML>
<HEAD>
  <meta charset="utf-8">
  <TITLE>${escapeHtml(title)}</TITLE>
</HEAD>
<BODY BGCOLOR="#FFFFFF" TEXT="#000000" LINK="#0000EE" VLINK="#551A8B" ALINK="#FF0000">
<FONT FACE="Times New Roman, Times, serif">
<CENTER>
<P>
  <a href="${paths.home}">Home</a> |
  <a href="${paths.feed}">Feed</a>
</P>
</CENTER>
<hr>
${body}
<hr>
<P><SMALL>Built from Markdown.</SMALL></P>
</FONT>
</BODY>
</HTML>
`;
}

function renderInline(value) {
  let html = escapeHtml(value);
  const code = [];

  html = html.replace(/`([^`]+)`/g, (_, match) => {
    code.push(`<code>${match}</code>`);
    return `\u0000CODE${code.length - 1}\u0000`;
  });

  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>');
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");

  return html.replace(/\u0000CODE(\d+)\u0000/g, (_, index) => code[Number(index)]);
}

function normalizeTags(tags) {
  if (Array.isArray(tags)) return tags.filter(Boolean);
  if (typeof tags !== "string") return [];
  return tags
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function renderTags(tags) {
  if (!tags.length) return "";
  return ` / ${tags.map((tag) => escapeHtml(tag)).join(", ")}`;
}

function formatDate(date) {
  if (!date) return "Undated";
  return date;
}

function titleFromBody(body) {
  const heading = body.match(/^#\s+(.+)$/m);
  return heading ? heading[1].trim() : "";
}

function firstParagraph(body) {
  return body
    .split(/\n\s*\n/)
    .map((chunk) => chunk.trim())
    .find((chunk) => chunk && !chunk.startsWith("#") && !chunk.startsWith("```"))
    ?.replace(/\s+/g, " ")
    .slice(0, 180) || "";
}

function titleFromSlug(slug) {
  return slug
    .split("-")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function slugify(value) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function unquote(value) {
  return value.replace(/^["']|["']$/g, "");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("\n", " ");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  buildSite()
    .then(({ posts }) => {
      console.log(`Built ${posts} post(s) into ${path.relative(rootDir, publicDir)}/`);
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}

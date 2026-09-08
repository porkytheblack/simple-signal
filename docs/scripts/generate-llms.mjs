import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import TurndownService from "turndown";
import turndownPluginGfm from "turndown-plugin-gfm";
import { pageGroups, pages, site } from "./llms-pages.mjs";

const docsRoot = resolve(import.meta.dirname, "..");
const repoRoot = resolve(docsRoot, "..");
const outputRoot = resolve(docsRoot, "out");
const indexOnly = process.argv.includes("--index-only");
const { gfm } = turndownPluginGfm;

const packageManifest = JSON.parse(
  readFileSync(resolve(repoRoot, "packages/station-signal/package.json"), "utf8"),
);

function fail(message) {
  throw new Error(`[llms] ${message}`);
}

function markdownUrl(route) {
  return `${site.origin}${route}.md`;
}

function renderIndex() {
  const groups = pageGroups.map((group) => {
    const links = group.pages
      .map((page) => `- [${page.title}](${markdownUrl(page.route)}): ${page.description}`)
      .join("\n");
    return `## ${group.heading}\n\n${links}`;
  });

  return `# ${site.name}\n\n> ${site.summary}\n\nStation ${packageManifest.version} is a modular TypeScript framework. StationKit is the Node application entry point. For browser-local work, use the experimental station-browser runtime with explicit registries and IndexedDB; it is not yet included in npm release automation. Browser workers use cooperative execution and cannot guarantee continuous work after a PWA closes. In the Node runtime, signals are isolated background jobs, broadcasts are DAG workflows, beacons are supervised long-running processes, schedules provide interval and timezone-aware cron execution, and Station Networks coordinate work across a Headquarters and worker stations. Prefer the Markdown links below when supplying documentation to an agent.\n\n${groups.join("\n\n")}\n\n## Optional\n\n- [Complete documentation](${site.origin}/llms-full.txt): All documentation pages combined into one Markdown document for larger context windows.\n- [Human documentation](${site.origin}/docs/getting-started): Rendered documentation site.\n- [GitHub repository](https://github.com/porkytheblack/station): Source, package implementations, and runnable examples.\n`;
}

function write(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content.endsWith("\n") ? content : `${content}\n`);
}

function renderedDocRoutes(directory, route = "/docs") {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) {
      return renderedDocRoutes(resolve(directory, entry.name), `${route}/${entry.name}`);
    }
    return entry.isFile() && entry.name.endsWith(".html")
      ? [`${route}/${entry.name.slice(0, -5)}`]
      : [];
  });
}

const routes = new Set();
for (const page of pages) {
  if (routes.has(page.route)) fail(`Duplicate documentation route: ${page.route}`);
  routes.add(page.route);
}

const index = renderIndex();
write(resolve(docsRoot, "public/llms.txt"), index);

if (indexOnly) {
  console.log(`[llms] Updated public/llms.txt with ${pages.length} documentation links.`);
  process.exit(0);
}

const renderedRoutes = new Set(renderedDocRoutes(resolve(outputRoot, "docs")));
const unlistedRoutes = [...renderedRoutes].filter((route) => !routes.has(route));
const missingRoutes = [...routes].filter((route) => !renderedRoutes.has(route));
if (unlistedRoutes.length > 0) {
  fail(`Rendered documentation routes are missing from llms-pages.mjs: ${unlistedRoutes.join(", ")}`);
}
if (missingRoutes.length > 0) {
  fail(`Indexed documentation routes were not rendered: ${missingRoutes.join(", ")}`);
}

const turndown = new TurndownService({
  headingStyle: "atx",
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
  fence: "```",
  emDelimiter: "*",
  strongDelimiter: "**",
});
let currentRoute = "/";
turndown.use(gfm);
turndown.remove(["button", "script", "style", "svg", "noscript"]);
turndown.addRule("stationCodeBlock", {
  filter: "pre",
  replacement(_content, node) {
    const renderedLines = [...node.querySelectorAll("code > .code-line")];
    const code = renderedLines.length > 0
      ? renderedLines.map((line) => line.textContent?.replace(/\u00a0/g, "") ?? "").join("\n")
      : (node.textContent ?? "").replace(/\u00a0/g, " ");
    return `\n\n\`\`\`\n${code.replace(/\n$/, "")}\n\`\`\`\n\n`;
  },
});
turndown.addRule("stationHeadings", {
  filter: ["h2", "h3", "h4", "h5", "h6"],
  replacement(content, node) {
    const sourceLevel = Number(node.nodeName.slice(1));
    const level = Math.max(1, sourceLevel - 1);
    return `\n\n${"#".repeat(level)} ${content}\n\n`;
  },
});
turndown.addRule("stationInlineCode", {
  filter(node) {
    return node.nodeName === "CODE" && node.parentNode?.nodeName !== "PRE";
  },
  replacement(content, node) {
    const value = node.textContent ?? content;
    const longestRun = Math.max(0, ...[...value.matchAll(/`+/g)].map((match) => match[0].length));
    const delimiter = "`".repeat(longestRun + 1);
    const padding = value.startsWith("`") || value.endsWith("`") ? " " : "";
    const previous = node.previousSibling?.textContent ?? "";
    const next = node.nextSibling?.textContent ?? "";
    const leadingSpace = previous && !/\s$/u.test(previous) && /[\p{L}\p{N}.!?,;:)]$/u.test(previous)
      ? " "
      : "";
    const trailingSpace = next && !/^\s/u.test(next) && /^[\p{L}\p{N}(]/u.test(next)
      ? " "
      : "";
    return `${leadingSpace}${delimiter}${padding}${value}${padding}${delimiter}${trailingSpace}`;
  },
});
turndown.addRule("removePresentationLabels", {
  filter(node) {
    return node.nodeType === 1 && node.classList?.contains("eyebrow");
  },
  replacement() {
    return "";
  },
});
turndown.addRule("absoluteLinks", {
  filter: "a",
  replacement(content, node) {
    const href = node.getAttribute("href");
    if (!href) return content;
    const target = new URL(href, `${site.origin}${currentRoute}`);
    if (
      target.origin === site.origin &&
      target.pathname.startsWith("/docs/") &&
      !target.pathname.endsWith(".md")
    ) {
      target.pathname = `${target.pathname}.md`;
    }
    const absolute = target.href;
    const title = node.getAttribute("title");
    return `[${content || absolute}](${absolute}${title ? ` \"${title}\"` : ""})`;
  },
});
turndown.addRule("absoluteImages", {
  filter: "img",
  replacement(_content, node) {
    const src = node.getAttribute("src");
    if (!src) return "";
    const alt = node.getAttribute("alt") ?? "";
    return `![${alt}](${new URL(src, site.origin).href})`;
  },
});

function extractMain(html, route) {
  const opening = html.match(/<main\b[^>]*class="[^"]*\bdocs-content\b[^"]*"[^>]*>/);
  if (opening?.index === undefined) fail(`Could not find docs content in ${route}.`);
  const contentStart = opening.index + opening[0].length;
  const contentEnd = html.indexOf("</main>", contentStart);
  if (contentEnd === -1) fail(`Could not find closing docs content in ${route}.`);
  return html.slice(contentStart, contentEnd);
}

function normalizeMarkdown(markdown, page) {
  const canonical = `${site.origin}${page.route}`;
  let result = markdown
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!result.startsWith("# ")) result = `# ${page.title}\n\n${result}`;
  result = result.replace(
    /^(# .+)$/m,
    `$1\n\n> Canonical HTML: [${canonical}](${canonical})`,
  );
  return result;
}

function validateMarkdown(markdown, page) {
  if (!markdown.startsWith("# ")) fail(`Markdown page has no H1: ${page.route}`);
  if (markdown.length < 200) fail(`Markdown page appears incomplete: ${page.route}`);
  if (/<(?:main|nav|script)\b|self\.__next/iu.test(markdown)) {
    fail(`Rendered application markup leaked into ${page.route}`);
  }
  const fenceCount = markdown.match(/^```/gmu)?.length ?? 0;
  if (fenceCount % 2 !== 0) fail(`Markdown code fences are unbalanced: ${page.route}`);
}

const full = [
  `# ${site.name} documentation`,
  "",
  `> ${site.summary}`,
  "",
  `Generated from the canonical Station ${packageManifest.version} documentation pages listed in [llms.txt](${site.origin}/llms.txt).`,
];

for (const page of pages) {
  const relative = page.route.replace(/^\//, "");
  const htmlPath = resolve(outputRoot, `${relative}.html`);
  let html;
  try {
    html = readFileSync(htmlPath, "utf8");
  } catch {
    fail(`Static page is missing: ${htmlPath}`);
  }
  currentRoute = page.route;
  const markdown = normalizeMarkdown(turndown.turndown(extractMain(html, page.route)), page);
  validateMarkdown(markdown, page);
  write(resolve(outputRoot, `${relative}.md`), markdown);
  full.push("", "---", "", markdown);
}

write(resolve(outputRoot, "llms.txt"), index);
write(resolve(outputRoot, "llms-full.txt"), full.join("\n"));

console.log(
  `[llms] Generated llms.txt, llms-full.txt, and ${pages.length} Markdown documentation pages.`,
);

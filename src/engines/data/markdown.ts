import { Marked } from 'marked';

/**
 * Markdown → standalone HTML document (GitHub-flavoured Markdown via marked, MIT).
 * The result is a file for download; it is never rendered inside Convertly.
 */
const marked = new Marked({ gfm: true, breaks: false });

const STYLE = `body{max-width:780px;margin:40px auto;padding:0 20px;font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:#1f2328}
h1,h2,h3{line-height:1.25;margin-top:1.6em}h1,h2{border-bottom:1px solid #d8dee4;padding-bottom:.3em}
code{font:85% ui-monospace,Consolas,monospace;background:#f2f4f7;padding:.2em .4em;border-radius:6px}
pre{background:#f6f8fa;padding:16px;border-radius:8px;overflow:auto}pre code{background:none;padding:0}
blockquote{margin:0;padding:0 1em;color:#59636e;border-left:4px solid #d1d9e0}
table{border-collapse:collapse}th,td{border:1px solid #d1d9e0;padding:6px 13px}img{max-width:100%}`;

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function markdownToHtml(markdown: string, title: string, standalone = true): string {
  const body = marked.parse(markdown.replace(/^﻿/, ''), { async: false });
  if (!standalone) return body;
  const heading = /^#\s+(.+)$/m.exec(markdown)?.[1]?.trim();
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(heading || title)}</title>
<style>${STYLE}</style>
</head>
<body>
${body}</body>
</html>
`;
}

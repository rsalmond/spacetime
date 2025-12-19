#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT_DIR = "/pages";
const OUT_DIR = path.join(ROOT_DIR, "out");
const WEB_DIR = path.join(ROOT_DIR, "web");

function extractObjectLiteral(source, markerRegex) {
  const match = markerRegex.exec(source);
  if (!match) return null;
  const startIdx = source.indexOf("{", match.index);
  if (startIdx === -1) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = startIdx; i < source.length; i++) {
    const ch = source[i];
    if (inStr) {
      if (esc) {
        esc = false;
      } else if (ch === "\\") {
        esc = true;
      } else if (ch === "\"") {
        inStr = false;
      }
      continue;
    }
    if (ch === "\"") {
      inStr = true;
      continue;
    }
    if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        const jsonText = source.slice(startIdx, i + 1);
        try {
          return JSON.parse(jsonText);
        } catch (err) {
          return null;
        }
      }
    }
  }
  return null;
}

function getText(node) {
  if (!node || typeof node !== "object") return "";
  if (typeof node.simpleText === "string") return node.simpleText.trim();
  if (Array.isArray(node.runs)) {
    return node.runs.map((run) => run.text || "").join("").trim();
  }
  return "";
}

function findMetaTitle(html) {
  const ogMatch = html.match(/<meta\s+property="og:title"\s+content="([^"]*)"/i);
  if (ogMatch && ogMatch[1]) return ogMatch[1].trim();
  const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
  if (titleMatch && titleMatch[1]) {
    return titleMatch[1].replace(/\s*-\s*YouTube\s*$/i, "").trim();
  }
  return "";
}

function walkObject(obj, visitor, path = []) {
  if (!obj || typeof obj !== "object") return;
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      walkObject(obj[i], visitor, path.concat(`[${i}]`));
    }
    return;
  }
  visitor(obj, path);
  for (const key of Object.keys(obj)) {
    walkObject(obj[key], visitor, path.concat(key));
  }
}

function findFirstByKey(obj, key) {
  let found = null;
  walkObject(obj, (node) => {
    if (found) return;
    if (node && Object.prototype.hasOwnProperty.call(node, key)) {
      found = node[key];
    }
  });
  return found;
}

function extractTitleFromJsonFile(videoId, cache) {
  if (cache.has(videoId)) return cache.get(videoId);
  const jsonPath = path.join(ROOT_DIR, `${videoId}.json`);
  if (!fs.existsSync(jsonPath)) {
    cache.set(videoId, "");
    return "";
  }
  try {
    const data = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    const overlay = findFirstByKey(data, "playerOverlayVideoDetailsRenderer");
    let title = getText(overlay?.title);
    if (!title) {
      const primary = findFirstByKey(data, "videoPrimaryInfoRenderer");
      title = getText(primary?.title);
    }
    cache.set(videoId, title || "");
    return title || "";
  } catch (err) {
    cache.set(videoId, "");
    return "";
  }
}

function extractPublishDateFromJsonFile(videoId, cache) {
  if (cache.has(videoId)) return cache.get(videoId);
  const jsonPath = path.join(ROOT_DIR, `${videoId}.json`);
  if (!fs.existsSync(jsonPath)) {
    cache.set(videoId, "");
    return "";
  }
  try {
    const data = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    const microformat = findFirstByKey(data, "playerMicroformatRenderer");
    const microPublish = microformat?.publishDate || microformat?.uploadDate || "";
    let publishDate = typeof microPublish === "string" ? microPublish : getText(microPublish);
    if (!publishDate) {
      const rawPublish = findFirstByKey(data, "publishDate");
      publishDate = typeof rawPublish === "string" ? rawPublish : getText(rawPublish);
    }
    cache.set(videoId, publishDate || "");
    return publishDate || "";
  } catch (err) {
    cache.set(videoId, "");
    return "";
  }
}

function collectCardTeasers(initialData) {
  const teasers = [];
  walkObject(initialData, (obj) => {
    if (obj && obj.cardCollectionRenderer && obj.cardCollectionRenderer.cards) {
      const cards = obj.cardCollectionRenderer.cards;
      for (const card of cards) {
        const message =
          card?.cardRenderer?.teaser?.simpleCardTeaserRenderer?.message;
        const text = getText(message);
        if (text) teasers.push(text);
      }
    }
  });
  return teasers;
}

function extractTargetFromRenderer(renderer) {
  if (!renderer || typeof renderer !== "object") return null;
  let target = renderer;
  if (renderer.content && renderer.content.structuredDescriptionVideoLockupRenderer) {
    target = renderer.content.structuredDescriptionVideoLockupRenderer;
  }
  const nav = target.navigationEndpoint || target.onTapCommand || target.command;
  const videoId = nav?.watchEndpoint?.videoId || null;
  const url = nav?.commandMetadata?.webCommandMetadata?.url || "";
  const title = getText(target.title) || "";
  if (videoId) {
    return {
      videoId,
      title,
      url: url ? `https://www.youtube.com${url}` : `https://www.youtube.com/watch?v=${videoId}`,
    };
  }
  return null;
}

function collectCardTargets(initialData) {
  const targets = [];
  walkObject(initialData, (obj, path) => {
    if (!obj || typeof obj !== "object") return;
    if (Object.prototype.hasOwnProperty.call(obj, "compactInfocardRenderer")) {
      const target = extractTargetFromRenderer(obj.compactInfocardRenderer);
      if (target) targets.push(target);
    }
    if (Object.prototype.hasOwnProperty.call(obj, "structuredDescriptionVideoLockupRenderer")) {
      const target = extractTargetFromRenderer(obj.structuredDescriptionVideoLockupRenderer);
      if (target) targets.push(target);
    }
  });
  return targets;
}

function normalizeTitle(title) {
  return (title || "").trim().toLowerCase();
}

function buildGraph() {
  const entries = fs.readdirSync(ROOT_DIR).filter((name) => name.endsWith(".html"));
  const videos = new Map();
  const edges = [];
  const jsonTitleCache = new Map();
  const jsonDateCache = new Map();

  for (const entry of entries) {
    const filePath = path.join(ROOT_DIR, entry);
    const html = fs.readFileSync(filePath, "utf8");
    const videoId = path.basename(entry, ".html");

    const playerResponse = extractObjectLiteral(html, /ytInitialPlayerResponse\s*=\s*\{/);
    const initialData = extractObjectLiteral(html, /ytInitialData\s*=\s*\{/);

    let title = playerResponse?.videoDetails?.title || "";
    if (!title && initialData?.microformat?.playerMicroformatRenderer) {
      title = getText(initialData.microformat.playerMicroformatRenderer.title);
    }
    if (!title) title = findMetaTitle(html);
    if (!title) title = extractTitleFromJsonFile(videoId, jsonTitleCache);

    let publishDate = initialData?.microformat?.playerMicroformatRenderer?.publishDate || "";
    if (!publishDate) publishDate = extractPublishDateFromJsonFile(videoId, jsonDateCache);

    const url = `https://www.youtube.com/watch?v=${videoId}`;
    videos.set(videoId, { videoId, title, url, publishDate });

    if (!initialData) continue;

    const teasers = collectCardTeasers(initialData);
    const targets = collectCardTargets(initialData);

    const teaserByTitle = new Map();
    for (const teaser of teasers) {
      teaserByTitle.set(normalizeTitle(teaser), teaser);
    }

    targets.forEach((target, index) => {
      if (!target.videoId) return;
      const resolvedTitle =
        teasers[index] || teaserByTitle.get(normalizeTitle(target.title)) || target.title || "";
      const nodeTitle = target.title || resolvedTitle;
      edges.push({
        fromId: videoId,
        toId: target.videoId,
        cardTitle: resolvedTitle,
        toUrl: target.url,
      });

      if (!videos.has(target.videoId)) {
        const targetPublishDate = extractPublishDateFromJsonFile(target.videoId, jsonDateCache);
        videos.set(target.videoId, {
          videoId: target.videoId,
          title: nodeTitle || "",
          url: target.url || `https://www.youtube.com/watch?v=${target.videoId}`,
          publishDate: targetPublishDate || "",
        });
      } else if (nodeTitle) {
        const existing = videos.get(target.videoId);
        if (existing && !existing.title) {
          existing.title = nodeTitle;
        }
      }
    });
  }

  for (const video of videos.values()) {
    if (!video.title) {
      const jsonTitle = extractTitleFromJsonFile(video.videoId, jsonTitleCache);
      if (jsonTitle) video.title = jsonTitle;
    }
    if (!video.publishDate) {
      const jsonDate = extractPublishDateFromJsonFile(video.videoId, jsonDateCache);
      if (jsonDate) video.publishDate = jsonDate;
    }
  }

  return {
    videos: Array.from(videos.values()),
    edges,
  };
}

function writeOutputs(data) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(WEB_DIR, { recursive: true });

  const jsonPath = path.join(OUT_DIR, "graph.json");
  fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2));

  const htmlPath = path.join(WEB_DIR, "graph.html");
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>YouTube Card Graph</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #0a0e13;
      --bg-accent: #16202c;
      --panel: rgba(18, 24, 33, 0.82);
      --text: #e6edf3;
      --muted: #8aa0b5;
      --accent: #55d2ff;
      --accent-2: #ffb257;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: "Space Grotesk", "Sora", "IBM Plex Sans", "Segoe UI", sans-serif;
      background: radial-gradient(1200px 700px at 20% 10%, #152132, var(--bg)),
                  radial-gradient(800px 600px at 80% 20%, #1a2b3c, transparent),
                  linear-gradient(130deg, #0a0e13, #0b141f 45%, #101b28);
      color: var(--text);
      overflow-y: auto;
    }
    canvas { display: block; }
    .overlay {
      position: absolute;
      top: 24px;
      left: 24px;
      padding: 16px 18px;
      background: var(--panel);
      border: 1px solid rgba(85, 210, 255, 0.25);
      border-radius: 14px;
      backdrop-filter: blur(12px);
      max-width: 360px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.35);
    }
    .overlay h1 {
      margin: 0 0 6px;
      font-size: 20px;
      letter-spacing: 0.02em;
    }
    .overlay p {
      margin: 6px 0 0;
      color: var(--muted);
      line-height: 1.4;
      font-size: 13px;
    }
    .stats {
      display: flex;
      gap: 12px;
      margin-top: 12px;
      font-size: 12px;
      color: var(--muted);
    }
    .legend {
      margin-top: 12px;
      font-size: 12px;
      color: var(--muted);
    }
    .legend span {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      margin-right: 12px;
    }
    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      display: inline-block;
    }
    .tooltip {
      position: absolute;
      padding: 8px 10px;
      background: rgba(8, 12, 18, 0.88);
      border: 1px solid rgba(255, 178, 87, 0.4);
      border-radius: 10px;
      font-size: 12px;
      color: var(--text);
      pointer-events: none;
      max-width: 240px;
      opacity: 0;
      transform: translateY(8px);
      transition: opacity 0.15s ease, transform 0.15s ease;
    }
    .tooltip.visible {
      opacity: 1;
      transform: translateY(0);
    }
  </style>
</head>
<body>
  <canvas id="graph"></canvas>
  <div class="overlay">
    <h1>YouTube Card Graph</h1>
    <p>Each node is a video. Edges point backward to videos referenced by cards.</p>
    <div class="stats">
      <div id="node-count"></div>
      <div id="edge-count"></div>
    </div>
    <div class="legend">
      <span><i class="dot" style="background: var(--accent)"></i>Channel videos</span>
      <span><i class="dot" style="background: var(--accent-2)"></i>Referenced videos</span>
    </div>
  </div>
  <div class="tooltip" id="tooltip"></div>
  <script id="graph-data" type="application/json">${JSON.stringify(data)}</script>
  <script>
    const data = JSON.parse(document.getElementById('graph-data').textContent);
    const canvas = document.getElementById('graph');
    const ctx = canvas.getContext('2d');
    const tooltip = document.getElementById('tooltip');
    const nodeCountEl = document.getElementById('node-count');
    const edgeCountEl = document.getElementById('edge-count');

    const nodes = data.videos.map((video, index) => ({
      ...video,
      index,
      x: (Math.random() - 0.5) * 800,
      y: (Math.random() - 0.5) * 800,
      vx: 0,
      vy: 0,
      degree: 0,
      isSource: false,
      publishedTimestamp: video.publishDate ? Date.parse(video.publishDate) : null,
      targetY: 0,
    }));

    const nodeById = new Map(nodes.map((node) => [node.videoId, node]));
    const edges = data.edges
      .map((edge) => {
        const source = nodeById.get(edge.fromId);
        const target = nodeById.get(edge.toId);
        if (!source || !target) return null;
        source.degree += 1;
        target.degree += 1;
        source.isSource = true;
        return { source, target };
      })
      .filter(Boolean);

    nodeCountEl.textContent = nodes.length + ' nodes';
    edgeCountEl.textContent = edges.length + ' edges';

    let layoutHeight = window.innerHeight;
    const datedNodes = nodes
      .filter((node) => Number.isFinite(node.publishedTimestamp))
      .sort((a, b) => a.publishedTimestamp - b.publishedTimestamp);
    const undatedNodes = nodes.filter((node) => !Number.isFinite(node.publishedTimestamp));

    function assignTargetY() {
      const total = datedNodes.length + undatedNodes.length;
      if (!total) return;
      const spacing = Math.max(26, Math.min(70, window.innerHeight / 6));
      const padding = Math.max(80, window.innerHeight * 0.1);
      layoutHeight = padding * 2 + (total - 1) * spacing;
      const startY = padding;
      let idx = 0;
      for (const node of datedNodes) {
        node.targetY = startY + idx * spacing;
        idx += 1;
      }
      for (const node of undatedNodes) {
        node.targetY = startY + idx * spacing;
        idx += 1;
      }
    }

    function resize() {
      canvas.width = window.innerWidth * devicePixelRatio;
      canvas.height = layoutHeight * devicePixelRatio;
      canvas.style.width = window.innerWidth + 'px';
      canvas.style.height = layoutHeight + 'px';
      ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    }

    assignTargetY();
    resize();
    window.addEventListener('resize', () => {
      resize();
      assignTargetY();
    });

    function step() {
      const repulsion = 1200;
      const spring = 0.0025;
      const damping = 0.88;

      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          let dx = a.x - b.x;
          let dy = a.y - b.y;
          let distSq = dx * dx + dy * dy + 0.01;
          let force = repulsion / distSq;
          a.vx += (dx / Math.sqrt(distSq)) * force;
          a.vy += (dy / Math.sqrt(distSq)) * force;
          b.vx -= (dx / Math.sqrt(distSq)) * force;
          b.vy -= (dy / Math.sqrt(distSq)) * force;
        }
      }

      for (const edge of edges) {
        const dx = edge.target.x - edge.source.x;
        const dy = edge.target.y - edge.source.y;
        edge.source.vx += dx * spring;
        edge.source.vy += dy * spring;
        edge.target.vx -= dx * spring;
        edge.target.vy -= dy * spring;
      }

      for (const node of nodes) {
        node.vx *= damping;
        node.vy *= damping;
        node.x += node.vx;
        node.y += node.vy;
        node.y = node.targetY;
      }
    }

    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.translate(window.innerWidth / 2, 0);

      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(85, 210, 255, 0.16)';
      ctx.beginPath();
      for (const edge of edges) {
        ctx.moveTo(edge.source.x, edge.source.y);
        ctx.lineTo(edge.target.x, edge.target.y);
      }
      ctx.stroke();

      ctx.font = '12px \"Space Grotesk\", \"Sora\", \"IBM Plex Sans\", \"Segoe UI\", sans-serif';
      ctx.textBaseline = 'middle';
      for (const node of nodes) {
        const radius = 4 + Math.min(6, Math.sqrt(node.degree));
        ctx.fillStyle = node.isSource ? '#55d2ff' : '#ffb257';
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
        ctx.fill();

        const label = node.title || node.videoId;
        if (label) {
          ctx.strokeStyle = 'rgba(10, 14, 19, 0.9)';
          ctx.lineWidth = 4;
        ctx.strokeText(label, node.x + radius + 6, node.y);
        ctx.fillStyle = '#e6edf3';
        ctx.fillText(label, node.x + radius + 6, node.y);
      }
    }
      ctx.restore();
    }

    let ticks = 0;
    function animate() {
      step();
      draw();
      ticks += 1;
      if (ticks < 450) {
        requestAnimationFrame(animate);
      } else {
        draw();
      }
    }
    animate();

    function getNodeAt(x, y) {
      ctx.font = '12px "Space Grotesk", "Sora", "IBM Plex Sans", "Segoe UI", sans-serif';
      for (const node of nodes) {
        const radius = 6 + Math.min(6, Math.sqrt(node.degree));
        const centerX = node.x + window.innerWidth / 2;
        const centerY = node.y;
        const dx = centerX - x;
        const dy = centerY - y;
        if (dx * dx + dy * dy <= radius * radius) return node;

        const label = node.title || node.videoId;
        if (!label) continue;
        const textWidth = ctx.measureText(label).width;
        const textX = centerX + radius + 6;
        const textY = centerY - 7;
        if (x >= textX && x <= textX + textWidth && y >= textY && y <= textY + 14) {
          return node;
        }
      }
      return null;
    }

    canvas.addEventListener('mousemove', (event) => {
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const node = getNodeAt(x, y);
      if (node) {
        tooltip.textContent = node.title || node.videoId;
        tooltip.style.left = (event.clientX + 12) + 'px';
        tooltip.style.top = (event.clientY + 12) + 'px';
        tooltip.classList.add('visible');
        canvas.style.cursor = 'pointer';
      } else {
        tooltip.classList.remove('visible');
        canvas.style.cursor = 'default';
      }
    });

    canvas.addEventListener('click', (event) => {
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const node = getNodeAt(x, y);
      if (node && node.url) {
        window.open(node.url, '_blank', 'noopener');
      }
    });
  </script>
</body>
</html>`;

  fs.writeFileSync(htmlPath, html);

  return { jsonPath, htmlPath };
}

const graph = buildGraph();
const outputs = writeOutputs(graph);
console.log(`Wrote ${outputs.jsonPath}`);
console.log(`Wrote ${outputs.htmlPath}`);

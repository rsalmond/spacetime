# Repository Guidelines

## Project Purpose
This repository currently holds raw YouTube video data (HTML and JSON) for a single channel. The goal is to parse each video's HTML, extract card metadata from embedded JavaScript, resolve referenced videos, and render a graph where each video points back to the older videos it links to.

Write the code in JS / TS / ecmascript / whatever the kids are calling it these days. It'll be simpler to parse the DOM and interact with JS source.

Analyze the data in /pages/, extract both the title and URL of each video that has an HTML file, as well as each video referenced in the card data, then extract it into a structured JSON file. Finally, use this file to produce a visual graph where videos are nodes and card references are edges.

## Project Structure & Module Organization
- `/pages/` contains the dataset.
- Each video appears as a raw html file where the filename is the youtube video id (eg. https://www.youtube.com/watch?v=t_AMURAIcF0 -> t_AMURAIcF0.html)
- embedded within each video are several script tags, and within one of these is the youtube "card" data containing references to other videos

If you add code, keep parsing logic in a dedicated directory such as `scripts/` or `src/`, and place any derived outputs in `out/` or `dist/` to avoid mixing with raw data.

## Build, Test, and Development Commands
There is no build or test pipeline yet. Useful data inspection commands:
- `ls /pages/*.html | head` to sample available videos.
- `grep -n "ytInitialData" /pages/<VIDEO_ID>.html` to locate embedded data blocks.
- `wc -l /pages/*.html` to gauge file sizes.

If you introduce a build or visualization step, document it in this file and keep commands scriptable.

## Coding Style & Naming Conventions
No code style or formatter is configured. For new scripts:
- Prefer descriptive filenames like `extract_cards.py` or `build_graph.js`.
- Keep parsing helpers small and focused; avoid hardcoding single video IDs.
- Store outputs using stable names such as `out/edges.json` or `out/graph.html`.

## Testing Guidelines
No tests exist yet. If you add parsing or graph generation code, include small fixture HTML files and a quick regression check (e.g., a script that compares extracted edges for a known video).

## Commit & Pull Request Guidelines
There is no Git history or commit convention in this workspace. When a repo is initialized, use short, imperative messages that mention the data or feature touched (e.g., “Add card extractor for video IDs”). For PRs, include a brief summary of parsing assumptions and sample outputs/screenshots of the graph.

## Data Handling Notes
Treat files in `/pages/` as immutable inputs. Any transformations or graph artifacts should be written outside of `/pages/` so raw data remains unchanged.

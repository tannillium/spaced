# Spaced

Spaced is a small, dependency-free workspace prototype for notes, projects, and reference files. It uses native browser APIs so it runs without a build step or account setup.

## Run locally

```sh
npm start
```

Open `http://localhost:3000`. Set `PORT` to use another port. Node.js 20 or newer is required.

## What works

- Nested pages, favorites, page actions, recent pages, and page links.
- A contenteditable block editor with headings, lists, to-dos, quotes, callouts, code, simple tables, image blocks, slash insertion, drag-to-reorder, and autosave.
- Light and dark themes, global search, mobile navigation, and JSON workspace export.
- Text and Markdown imports are indexed for search. PDFs and images are stored in IndexedDB and can be opened in the browser.
- The assistant performs local keyword retrieval over page text and imported text files, extracts unchecked to-dos, and cites the pages or files it used.

## Storage and boundaries

Page content and settings live in this browser's local storage. Uploaded files and images live in IndexedDB. Clearing browser storage removes them; use Export backup to save page data. The export does not include binary file contents.

The assistant is a deterministic local retrieval helper, not a connected language model. It does not create embeddings, extract text from PDFs, synchronize data between devices, or send workspace data to a server. Those features need a backend and configured document/AI providers.

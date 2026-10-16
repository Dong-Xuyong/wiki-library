(() => {
  "use strict";

  // Agent 8 (or later) may assign a real reader before or after this IIFE.
  // Prefer defining it on window so either load order works.
  window.renderReader = window.renderReader || null;

  const PROGRESS_KEY = "wiki-library-progress";
  const INDEX_URL = "data/index.json";

  const root = document.getElementById("view-root");
  const headerMeta = document.getElementById("header-meta");

  let catalog = null;
  let booksBySlug = new Map();

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (m) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m])
    );
  }

  function snippet(text, max = 140) {
    const t = String(text || "").replace(/\s+/g, " ").trim();
    if (t.length <= max) return t;
    return t.slice(0, max - 1).trimEnd() + "…";
  }

  function loadProgress() {
    try {
      const raw = JSON.parse(localStorage.getItem(PROGRESS_KEY) || "{}");
      return raw && typeof raw === "object" ? raw : {};
    } catch {
      return {};
    }
  }

  function progressPercent(slug) {
    const p = loadProgress()[slug];
    if (!p || typeof p.percent !== "number" || Number.isNaN(p.percent)) return 0;
    return Math.max(0, Math.min(100, Math.round(p.percent)));
  }

  function parseRoute() {
    const h = (location.hash || "#/").replace(/^#/, "") || "/";
    const book = h.match(/^\/book\/([^/?#]+)/);
    if (book) return { name: "book", slug: decodeURIComponent(book[1]) };
    return { name: "shelf" };
  }

  function setHeaderMeta(text) {
    if (headerMeta) headerMeta.textContent = text || "";
  }

  function renderState(opts) {
    const { title, message, error, retry } = opts;
    root.innerHTML = `
      <div class="state-panel dx-card${error ? " error" : ""}">
        ${title ? `<span class="state-title">${esc(title)}</span>` : ""}
        <div>${esc(message || "")}</div>
        ${retry ? `<button type="button" class="retry-btn" data-retry>Retry</button>` : ""}
      </div>
    `;
    if (retry) {
      const btn = root.querySelector("[data-retry]");
      if (btn) btn.addEventListener("click", () => retry());
    }
  }

  function bookCardHtml(book, percent) {
    const accent = book.coverAccent || "#3d5a80";
    const chapters = book.chapterCount ?? 0;
    const summary = snippet(book.summary || "");
    const isNew = percent <= 0;
    return `
      <button type="button" class="book-card dx-card" data-slug="${esc(book.slug)}" aria-label="Open ${esc(book.title)}">
        <div class="book-cover" style="--cover-accent: ${esc(accent)}">
          <span class="book-cover-title">${esc(book.title)}</span>
        </div>
        <div class="book-body">
          <h3 class="book-title">${esc(book.title)}</h3>
          <div class="book-meta">${chapters} chapter${chapters === 1 ? "" : "s"}</div>
          <p class="book-summary">${esc(summary || "No summary yet.")}</p>
          <div class="book-progress${isNew ? " is-new" : ""}">
            <div class="book-progress-bar" aria-hidden="true">
              <div class="book-progress-fill" style="width: ${percent}%"></div>
            </div>
            <span class="book-progress-label">${isNew ? "New" : percent + "%"}</span>
          </div>
        </div>
      </button>
    `;
  }

  function renderShelf() {
    const books = catalog?.books || [];
    setHeaderMeta(
      books.length
        ? `${books.length} book${books.length === 1 ? "" : "s"}`
        : "Empty shelf"
    );

    if (!books.length) {
      renderState({
        title: "No books yet",
        message: "The library index is empty. Sync or generate books to fill the shelf.",
      });
      return;
    }

    const cards = books.map((b) => bookCardHtml(b, progressPercent(b.slug))).join("");
    root.innerHTML = `
      <div class="shelf-header dx-on-bg">
        <h2>Your shelf</h2>
        <span class="shelf-count">${books.length} title${books.length === 1 ? "" : "s"}</span>
      </div>
      <div class="shelf-grid" role="list">
        ${cards}
      </div>
    `;

    root.querySelectorAll(".book-card").forEach((card) => {
      card.addEventListener("click", () => {
        const slug = card.getAttribute("data-slug");
        if (slug) location.hash = `#/book/${encodeURIComponent(slug)}`;
      });
    });
  }

  async function fetchBook(slug) {
    if (booksBySlug.has(slug)) return booksBySlug.get(slug);
    const res = await fetch(`data/books/${encodeURIComponent(slug)}.json`);
    if (!res.ok) throw new Error(`Book not found (${res.status})`);
    const data = await res.json();
    booksBySlug.set(slug, data);
    return data;
  }

  // -------------------------------------------------------------------------
  // READER HOOK
  // Agent 8: assign window.renderReader = function(slug, bookData) { ... }
  // Prefer mounting into #view-root (or replace root.innerHTML yourself).
  // bookData shape: { slug, meta, chapters:[{id,title,body}], insightsUrl }
  // -------------------------------------------------------------------------
  async function openReader(slug) {
    setHeaderMeta("");
    root.innerHTML = `
      <button type="button" class="reader-back" data-back>← Shelf</button>
      <div class="reader-stub dx-card">
        <div class="stub-title">Opening…</div>
        <div>Loading ${esc(slug)}</div>
      </div>
    `;
    root.querySelector("[data-back]")?.addEventListener("click", () => {
      location.hash = "#/";
    });

    let bookData;
    try {
      bookData = await fetchBook(slug);
    } catch (err) {
      renderState({
        title: "Could not open book",
        message: err?.message || "Failed to load book data.",
        error: true,
        retry: () => openReader(slug),
      });
      const back = document.createElement("button");
      back.type = "button";
      back.className = "reader-back";
      back.textContent = "← Shelf";
      back.addEventListener("click", () => {
        location.hash = "#/";
      });
      root.prepend(back);
      return;
    }

    const render = window.renderReader;
    if (typeof render === "function") {
      root.innerHTML = "";
      try {
        render(slug, bookData);
      } catch (err) {
        console.error("renderReader failed", err);
        renderState({
          title: "Reader error",
          message: err?.message || "The reader failed to open.",
          error: true,
          retry: () => openReader(slug),
        });
      }
      return;
    }

    // Fallback if renderReader missing
    const title = bookData?.meta?.title || bookData?.title || slug;
    root.innerHTML = `
      <button type="button" class="reader-back" data-back>← Shelf</button>
      <div class="reader-stub dx-card">
        <div class="stub-title">${esc(title)}</div>
        <div>Reader unavailable.</div>
      </div>
    `;
    root.querySelector("[data-back]")?.addEventListener("click", () => {
      location.hash = "#/";
    });
  }

  async function ensureCatalog() {
    if (catalog) return catalog;
    const res = await fetch(INDEX_URL);
    if (!res.ok) throw new Error(`Failed to load index (${res.status})`);
    catalog = await res.json();
    return catalog;
  }

  async function route() {
    const r = parseRoute();
    if (r.name === "book") {
      await openReader(r.slug);
      return;
    }
    try {
      await ensureCatalog();
      renderShelf();
    } catch (err) {
      setHeaderMeta("");
      renderState({
        title: "Library unavailable",
        message: err?.message || "Could not load data/index.json.",
        error: true,
        retry: () => {
          catalog = null;
          route();
        },
      });
    }
  }

  window.addEventListener("hashchange", () => {
    route();
  });

  // Boot after reader IIFE assigns window.renderReader (see end of file)
  window.__wikiLibraryBoot = function wikiLibraryBoot() {
    if (!location.hash || location.hash === "#") {
      location.hash = "#/";
    } else {
      route();
    }
  };
})();

/* =============================================================================
 * Kindle-like reader — window.renderReader(slug, bookData)
 * bookData: { slug, title, url, meta?, chapters:[{id,title,body}], insightsUrl? }
 * Font: localStorage "wiki-library-font" = "S"|"M"|"L"
 * Progress: "wiki-library-progress"[slug] = { chapterId, percent, updated }
 * ============================================================================= */
(() => {
  "use strict";

  const FONT_KEY = "wiki-library-font";
  const PROGRESS_KEY = "wiki-library-progress";
  const FONT_SIZES = ["S", "M", "L"];
  const INSIGHTS_BASE = "https://dong-xuyong.github.io/wiki-insights/#/v/";

  let activeCleanup = null;

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (m) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m])
    );
  }

  function loadFont() {
    const v = localStorage.getItem(FONT_KEY);
    return FONT_SIZES.includes(v) ? v : "M";
  }

  function saveFont(size) {
    if (!FONT_SIZES.includes(size)) return;
    localStorage.setItem(FONT_KEY, size);
  }

  function loadAllProgress() {
    try {
      const raw = JSON.parse(localStorage.getItem(PROGRESS_KEY) || "{}");
      return raw && typeof raw === "object" ? raw : {};
    } catch {
      return {};
    }
  }

  function getProgress(slug) {
    const p = loadAllProgress()[slug];
    if (!p || typeof p !== "object") return null;
    return p;
  }

  function saveProgress(slug, chapterId, percent) {
    const all = loadAllProgress();
    all[slug] = {
      chapterId: String(chapterId || ""),
      percent: Math.max(0, Math.min(100, Math.round(Number(percent) || 0))),
      updated: new Date().toISOString(),
    };
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(all));
  }

  function youtubeUrl(book) {
    const meta = book?.meta && typeof book.meta === "object" ? book.meta : null;
    return (
      meta?.url ||
      book?.url ||
      (book?.video_id ? `https://www.youtube.com/watch?v=${book.video_id}` : "") ||
      (meta?.video_id ? `https://www.youtube.com/watch?v=${meta.video_id}` : "")
    );
  }

  function insightsUrl(slug, book) {
    if (book?.insightsUrl) return book.insightsUrl;
    if (book?.insights_url) return book.insights_url;
    const insightsSlug = book?.insights_slug || book?.meta?.insights_slug || slug;
    return insightsSlug ? INSIGHTS_BASE + encodeURIComponent(insightsSlug) : "";
  }

  function bookTitle(book, slug) {
    return book?.meta?.title || book?.title || slug;
  }

  function normalizeChapters(book) {
    const list = Array.isArray(book?.chapters) ? book.chapters : [];
    return list.map((ch, i) => ({
      id: String(ch.id || ch.slug || `chapter-${i + 1}`),
      title: String(ch.title || `Chapter ${i + 1}`),
      body: String(ch.body || ch.html || ch.content || ""),
    }));
  }

  function formatBody(text) {
    const raw = String(text || "").trim();
    if (!raw) return `<p class="chapter-empty">This chapter has no text yet.</p>`;
    const escaped = esc(raw);
    const byBlank = escaped.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
    if (byBlank.length > 1) {
      return byBlank
        .map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`)
        .join("");
    }
    const single = byBlank[0] || escaped;
    if (!/\n/.test(raw) && single.length > 500) {
      const sentences =
        single.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g) || [single];
      const chunks = [];
      let buf = [];
      for (const s of sentences) {
        buf.push(s.trim());
        if (buf.join(" ").length >= 420) {
          chunks.push(buf.join(" "));
          buf = [];
        }
      }
      if (buf.length) chunks.push(buf.join(" "));
      return chunks.map((p) => `<p>${p}</p>`).join("");
    }
    return `<p>${single.replace(/\n/g, "<br>")}</p>`;
  }

  function chapterIndex(chapters, chapterId) {
    const idx = chapters.findIndex((c) => c.id === chapterId);
    return idx >= 0 ? idx : 0;
  }

  function computePercent(chapters, idx, scrollRatio) {
    const n = chapters.length || 1;
    const ratio = Math.max(0, Math.min(1, Number(scrollRatio) || 0));
    return ((idx + ratio) / n) * 100;
  }

  window.renderReader = function renderReader(slug, bookData) {
    if (typeof activeCleanup === "function") {
      try {
        activeCleanup();
      } catch (_) {
        /* ignore */
      }
      activeCleanup = null;
    }

    const root = document.getElementById("view-root");
    if (!root) {
      console.error("renderReader: #view-root missing");
      return;
    }

    const book = bookData && typeof bookData === "object" ? bookData : {};
    const chapters = normalizeChapters(book);
    const title = bookTitle(book, slug);
    const yt = youtubeUrl(book);
    const insights = insightsUrl(slug, book);
    const saved = getProgress(slug);
    let idx = 0;
    if (saved?.chapterId) {
      idx = chapterIndex(chapters, saved.chapterId);
    }

    const headerMeta = document.getElementById("header-meta");

    function setMeta(text) {
      if (headerMeta) headerMeta.textContent = text || "";
    }

    function paint() {
      const font = loadFont();

      if (!chapters.length) {
        root.innerHTML = `
          <div class="reader-shell dx-card" data-font="${esc(font)}">
            <div class="reader-toolbar">
              <button type="button" class="reader-back" data-action="shelf">← Shelf</button>
            </div>
            <div class="state-panel">
              <span class="state-title">${esc(title)}</span>
              <div>This book has no chapters yet.</div>
            </div>
          </div>
        `;
        root.querySelector('[data-action="shelf"]')?.addEventListener("click", () => {
          location.hash = "#/";
        });
        setMeta("");
        return;
      }

      const ch = chapters[idx];
      const pct = computePercent(chapters, idx, 0.05);
      saveProgress(slug, ch.id, pct);
      setMeta(`${idx + 1} / ${chapters.length}`);

      const tocItems = chapters
        .map(
          (c, i) => `
          <button type="button" class="toc-item${i === idx ? " is-active" : ""}"
            data-toc="${i}" aria-current="${i === idx ? "true" : "false"}">
            <span class="toc-num">${i + 1}</span>
            <span class="toc-label">${esc(c.title)}</span>
          </button>`
        )
        .join("");

      const fontBtns = FONT_SIZES.map(
        (s) =>
          `<button type="button" class="font-btn${s === font ? " is-active" : ""}" data-font="${s}" aria-pressed="${s === font}">${s}</button>`
      ).join("");

      root.innerHTML = `
        <div class="reader-shell dx-card" data-font="${esc(font)}">
          <div class="progress-bar" aria-hidden="true">
            <div class="progress-bar__fill" data-progress-fill style="width:${pct}%"></div>
          </div>

          <div class="reader-toolbar">
            <button type="button" class="reader-back" data-action="shelf">← Shelf</button>
            <button type="button" class="toc-toggle" data-action="toc" aria-expanded="false" aria-controls="toc-drawer">Contents</button>
            <div class="font-controls" role="group" aria-label="Font size">
              ${fontBtns}
            </div>
            <div class="reader-links">
              ${yt ? `<a class="reader-link" href="${esc(yt)}" target="_blank" rel="noopener noreferrer">YouTube</a>` : ""}
              ${insights ? `<a class="reader-link" href="${esc(insights)}" target="_blank" rel="noopener noreferrer">Wiki Insights</a>` : ""}
            </div>
          </div>

          <div class="toc-backdrop hidden" data-action="toc-close" hidden></div>
          <aside id="toc-drawer" class="toc-drawer dx-card" aria-label="Table of contents" data-open="false">
            <div class="toc-drawer__head">
              <strong>Chapters</strong>
              <button type="button" class="toc-close" data-action="toc-close" aria-label="Close contents">✕</button>
            </div>
            <nav class="toc-list">${tocItems}</nav>
          </aside>

          <article class="chapter-panel">
            <header class="chapter-head">
              <p class="chapter-kicker">${esc(title)}</p>
              <h2 class="chapter-title">${esc(ch.title)}</h2>
              <p class="chapter-pos">Chapter ${idx + 1} of ${chapters.length}</p>
            </header>
            <div class="chapter-body" data-chapter-body>
              ${formatBody(ch.body)}
            </div>
            <nav class="chapter-nav">
              <button type="button" class="nav-btn" data-action="prev" ${idx <= 0 ? "disabled" : ""}>← Previous</button>
              <button type="button" class="nav-btn nav-btn--primary" data-action="next" ${idx >= chapters.length - 1 ? "disabled" : ""}>Next →</button>
            </nav>
          </article>
        </div>
      `;

      bind();
      if (typeof window.scrollTo === "function") window.scrollTo(0, 0);
    }

    function setTocOpen(open) {
      const drawer = root.querySelector(".toc-drawer");
      const backdrop = root.querySelector(".toc-backdrop");
      const toggle = root.querySelector('[data-action="toc"]');
      if (!drawer) return;
      drawer.dataset.open = open ? "true" : "false";
      if (backdrop) {
        backdrop.classList.toggle("hidden", !open);
        backdrop.hidden = !open;
      }
      if (toggle) toggle.setAttribute("aria-expanded", open ? "true" : "false");
      document.body.classList.toggle("toc-open", open);
    }

    function goTo(nextIdx) {
      if (nextIdx < 0 || nextIdx >= chapters.length) return;
      idx = nextIdx;
      const ch = chapters[idx];
      saveProgress(slug, ch.id, computePercent(chapters, idx, 0.05));
      paint();
    }

    function updateScrollProgress() {
      const body = root.querySelector("[data-chapter-body]");
      const fill = root.querySelector("[data-progress-fill]");
      if (!body || !chapters.length) return;
      const rect = body.getBoundingClientRect();
      const total = Math.max(body.scrollHeight - window.innerHeight * 0.35, 1);
      const scrolled = Math.max(0, -rect.top + 80);
      const ratio = Math.max(0, Math.min(1, scrolled / total));
      const pct = computePercent(chapters, idx, ratio);
      if (fill) fill.style.width = `${pct}%`;
      const ch = chapters[idx];
      saveProgress(slug, ch.id, pct);
    }

    function onKey(e) {
      if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      if (e.key === "Escape") setTocOpen(false);
      if (e.key === "ArrowRight") goTo(idx + 1);
      if (e.key === "ArrowLeft") goTo(idx - 1);
    }

    function bind() {
      if (typeof activeCleanup === "function") {
        try {
          activeCleanup();
        } catch (_) {
          /* ignore */
        }
        activeCleanup = null;
      }

      const shell = root.querySelector(".reader-shell");

      root.querySelector('[data-action="shelf"]')?.addEventListener("click", () => {
        location.hash = "#/";
      });

      root.querySelector('[data-action="toc"]')?.addEventListener("click", () => {
        const open = root.querySelector(".toc-drawer")?.dataset.open === "true";
        setTocOpen(!open);
      });

      root.querySelectorAll('[data-action="toc-close"]').forEach((el) => {
        el.addEventListener("click", () => setTocOpen(false));
      });

      root.querySelectorAll("[data-toc]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const i = Number(btn.getAttribute("data-toc"));
          setTocOpen(false);
          goTo(i);
        });
      });

      root.querySelector('[data-action="prev"]')?.addEventListener("click", () => goTo(idx - 1));
      root.querySelector('[data-action="next"]')?.addEventListener("click", () => goTo(idx + 1));

      root.querySelectorAll("[data-font]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const size = btn.getAttribute("data-font");
          saveFont(size);
          if (shell) shell.setAttribute("data-font", size);
          root.querySelectorAll(".font-btn").forEach((b) => {
            const on = b.getAttribute("data-font") === size;
            b.classList.toggle("is-active", on);
            b.setAttribute("aria-pressed", on ? "true" : "false");
          });
        });
      });

      window.addEventListener("scroll", updateScrollProgress, { passive: true });
      window.addEventListener("keydown", onKey);
      activeCleanup = () => {
        window.removeEventListener("scroll", updateScrollProgress);
        window.removeEventListener("keydown", onKey);
        document.body.classList.remove("toc-open");
      };
    }

    paint();
  };

  if (typeof window.__wikiLibraryBoot === "function") {
    window.__wikiLibraryBoot();
  }
})();

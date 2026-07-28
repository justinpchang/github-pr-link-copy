(function () {
  "use strict";

  const core = globalThis.PrLinkCore;
  const BUTTON_CLASS = "pr-link-copy-button";
  const STACK_BUTTON_CLASS = "pr-stack-copy-button";
  const cache = new Map();
  let refreshQueued = false;

  function currentPr() {
    return core.parsePrUrl(location.href);
  }

  function embeddedJson(root = document) {
    const values = [];
    for (const script of root.querySelectorAll('script[type="application/json"]')) {
      try {
        values.push(JSON.parse(script.textContent));
      } catch (_) {
        // GitHub can leave a partial script in the DOM while navigating.
      }
    }
    return values;
  }

  function titleFromDocument(root, number) {
    for (const value of embeddedJson(root)) {
      const match = core.collectPrObjects(value).find((pr) => pr.number === number);
      if (match) return match.title;
    }

    const heading = root.querySelector(
      "h1 .markdown-title, h1 [data-component='Text'], .js-issue-title, [data-testid='pull-request-title']",
    );
    return heading && heading.textContent.trim();
  }

  function diffFromDocument(root) {
    const candidates = root.querySelectorAll(
      "#diff-stats, .diffstat, [aria-label*='addition'][aria-label*='deletion']",
    );
    for (const candidate of candidates) {
      const text = `${candidate.getAttribute("aria-label") || ""} ${candidate.parentElement?.textContent || candidate.textContent}`;
      const labeled = text.match(/([\d,]+)\s+additions?.*?([\d,]+)\s+deletions?/i);
      const compact = text.match(/\+([\d,]+)\s*[−-]([\d,]+)/);
      const match = labeled || compact;
      if (match) {
        return {
          additions: Number(match[1].replaceAll(",", "")),
          deletions: Number(match[2].replaceAll(",", "")),
        };
      }
    }
    return null;
  }

  async function fetchPr(pr, knownTitle) {
    if (cache.has(pr.url)) return cache.get(pr.url);

    const pending = (async () => {
      let title = knownTitle;
      if (!title) {
        const response = await fetch(pr.url, { credentials: "include" });
        if (!response.ok) throw new Error(`Could not load PR #${pr.number}`);
        const html = await response.text();
        title = titleFromDocument(new DOMParser().parseFromString(html, "text/html"), pr.number);
      }

      let diff = currentPr()?.url === pr.url ? diffFromDocument(document) : null;
      if (!diff) {
        const diffResponse = await fetch(`${pr.url}.diff`, {
          credentials: "include",
          headers: { Accept: "text/plain" },
        });
        if (!diffResponse.ok) throw new Error(`Could not load the diff for PR #${pr.number}`);
        diff = core.countDiff(await diffResponse.text());
      }
      if (!title) throw new Error(`Could not find the title for PR #${pr.number}`);

      return { ...pr, title, ...diff };
    })();

    cache.set(pr.url, pending);
    try {
      return await pending;
    } catch (error) {
      cache.delete(pr.url);
      throw error;
    }
  }

  async function writeClipboard(content) {
    const text = typeof content === "string" ? content : content.text;
    const html = typeof content === "string" ? null : content.html;

    if (html && navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
      try {
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/plain": new Blob([text], { type: "text/plain" }),
            "text/html": new Blob([html], { type: "text/html" }),
          }),
        ]);
        return;
      } catch (_) {
        // Some Firefox releases expose write() but reject HTML from content scripts.
      }
    }

    if (html) {
      const richText = document.createElement("div");
      richText.contentEditable = "true";
      const parsed = new DOMParser().parseFromString(html, "text/html");
      richText.append(...parsed.body.childNodes);
      richText.style.cssText = "position:fixed;left:-9999px;top:0";
      document.body.append(richText);
      const range = document.createRange();
      range.selectNodeContents(richText);
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      const copied = document.execCommand("copy");
      selection.removeAllRanges();
      richText.remove();
      if (!copied) throw new Error("Firefox denied clipboard access");
      return;
    }

    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }

    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.append(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    if (!copied) throw new Error("Firefox denied clipboard access");
  }

  function setButtonState(button, text, state) {
    button.textContent = text;
    button.dataset.state = state || "";
    button.disabled = state === "loading";
  }

  async function runCopy(button, work, successText) {
    const original = button.textContent;
    setButtonState(button, "Copying…", "loading");
    try {
      await writeClipboard(await work());
      setButtonState(button, successText, "success");
    } catch (error) {
      console.error("GitHub PR Link Copier:", error);
      setButtonState(button, "Copy failed", "error");
      button.title = error.message;
    }
    setTimeout(() => setButtonState(button, original, ""), 1800);
  }

  function makeButton(text, className, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `${BUTTON_CLASS} ${className || ""}`.trim();
    button.textContent = text;
    button.addEventListener("click", onClick);
    return button;
  }

  function findHeaderTarget() {
    const actions = document.querySelector(
      ".gh-header-actions, [data-component='PH_Actions']:not(.d-none)",
    );
    if (actions) return { element: actions, placement: "prepend" };

    const title = document.querySelector(
      "h1 .markdown-title, h1 [data-component='Text'], .gh-header-title .js-issue-title",
    );
    if (!title) return null;
    return { element: title.closest("h1")?.parentElement || title.parentElement, placement: "append" };
  }

  function addPrButton() {
    const pr = currentPr();
    const target = findHeaderTarget();
    if (!pr || !target || document.querySelector(`.${BUTTON_CLASS}:not(.${STACK_BUTTON_CLASS})`)) return;

    const button = makeButton("Copy PR link", "", () => {
      runCopy(
        button,
        async () => {
          const fullPr = await fetchPr(pr, titleFromDocument(document, pr.number));
          return { text: core.formatPr(fullPr), html: core.formatPrHtml(fullPr) };
        },
        "Copied!",
      );
    });
    target.element[target.placement](button);
  }

  function normalizeStackEntries(entries, current) {
    const unique = new Map();
    for (const entry of entries) {
      const parsed = entry.url && core.parsePrUrl(entry.url, location.origin);
      const pr = parsed || (entry.number
        ? { ...current, number: entry.number, url: `https://github.com/${current.owner}/${current.repo}/pull/${entry.number}` }
        : null);
      if (pr && pr.owner === current.owner && pr.repo === current.repo) {
        unique.set(pr.url, { ...pr, title: entry.title || null });
      }
    }
    return [...unique.values()];
  }

  function stackEntries(container) {
    const current = currentPr();
    if (!current) return [];
    const entries = [];

    for (const link of container.querySelectorAll('a[href*="/pull/"]')) {
      const parsed = core.parsePrUrl(link.href);
      if (parsed) entries.push({ ...parsed, title: null });
    }

    for (const element of container.querySelectorAll("*")) {
      const ownText = [...element.childNodes]
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent)
        .join(" ")
        .trim();
      const number = ownText.match(/^#(\d+)\b/)?.[1];
      if (number) entries.push({ number: Number(number), title: null, url: null });
    }

    const stackNumber = Number(container.textContent.match(/Stack\s*#\s*(\d+)/i)?.[1]);
    for (const number of core.extractStackPrNumbers(container.textContent, stackNumber)) {
      entries.push({ number, title: null, url: null });
    }

    for (const value of embeddedJson(document)) {
      const layout = value?.payload?.pullRequestsConversationsRoute?.pullRequestsLayoutRoute;
      const stack = layout?.stack;
      if (stack) entries.push(...core.collectPrObjects(stack));
    }

    return normalizeStackEntries(entries, current);
  }

  function isStackDialog(element) {
    return /Stack\s*#\s*\d+/i.test(element.textContent || "");
  }

  function stackContainers() {
    const containers = new Set();
    const titlePattern = /^Stack\s*#\s*\d+$/i;

    for (const element of document.querySelectorAll("h1, h2, h3, [role='heading'], div, span")) {
      if (!titlePattern.test(element.textContent.trim())) continue;
      if ([...element.children].some((child) => titlePattern.test(child.textContent.trim()))) continue;

      let container = element.parentElement;
      while (container && container !== document.body) {
        const numbers = new Set([...container.textContent.matchAll(/#(\d+)\b/g)].map((match) => match[1]));
        if (numbers.size >= 2) {
          containers.add(container);
          break;
        }
        container = container.parentElement;
      }
    }

    if (containers.size === 0) {
      const fallbacks = [...document.querySelectorAll("dialog, [role='dialog'], .Overlay, [class*='Overlay']")]
        .filter(isStackDialog)
        .sort((a, b) => a.textContent.length - b.textContent.length);
      if (fallbacks[0]) containers.add(fallbacks[0]);
    }

    return [...containers];
  }

  function addStackButtons() {
    for (const container of stackContainers()) {
      if (container.querySelector(`.${STACK_BUTTON_CLASS}`)) continue;

      const button = makeButton("Copy Stack", STACK_BUTTON_CLASS, () => {
        runCopy(
          button,
          async () => {
            const prs = [];
            const entries = stackEntries(container);
            if (entries.length < 2) throw new Error("Could not find the PRs in this stack");
            for (const entry of entries) prs.push(await fetchPr(entry, entry.title));
            return {
              text: prs.map((pr) => `- ${core.formatPr(pr)}`).join("\n"),
              html: `<ul>${prs.map((pr) => `<li>${core.formatPrHtml(pr)}</li>`).join("")}</ul>`,
            };
          },
          "Stack copied!",
        );
      });

      const titlePattern = /^Stack\s*#\s*\d+$/i;
      const title = [...container.querySelectorAll("h1, h2, h3, [role='heading'], div, span")].find(
        (node) => titlePattern.test(node.textContent.trim())
          && ![...node.children].some((child) => titlePattern.test(child.textContent.trim())),
      );
      if (title) title.after(button);
      else container.prepend(button);
    }
  }

  function refresh() {
    refreshQueued = false;
    if (!currentPr()) return;
    addPrButton();
    addStackButtons();
  }

  function queueRefresh() {
    if (refreshQueued) return;
    refreshQueued = true;
    requestAnimationFrame(refresh);
  }

  new MutationObserver(queueRefresh).observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener("turbo:load", queueRefresh);
  document.addEventListener("pjax:end", queueRefresh);
  queueRefresh();
})();

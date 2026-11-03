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

  async function fetchDiffstat(pr) {
    const response = await fetch(`${pr.url}/page_data/diffstat`, {
      credentials: "include",
      headers: { Accept: "application/json", "X-Requested-With": "XMLHttpRequest" },
    });
    if (response.ok) {
      const diffstat = (await response.json())?.diffstat;
      if (Number.isInteger(diffstat?.linesAdded) && Number.isInteger(diffstat?.linesDeleted)) {
        return { additions: diffstat.linesAdded, deletions: diffstat.linesDeleted };
      }
    }

    // Fall back to the full diff when GitHub's page data endpoint is unavailable.
    const diffResponse = await fetch(`${pr.url}.diff`, { credentials: "include" });
    if (!diffResponse.ok) throw new Error(`Could not load the diff for PR #${pr.number}`);
    return core.countDiff(await diffResponse.text());
  }

  async function fetchTitle(pr) {
    const response = await fetch(pr.url, { credentials: "include" });
    if (!response.ok) throw new Error(`Could not load PR #${pr.number}`);
    const html = await response.text();
    const title = titleFromDocument(new DOMParser().parseFromString(html, "text/html"), pr.number);
    if (!title) throw new Error(`Could not find the title for PR #${pr.number}`);
    return title;
  }

  async function fetchPr(pr, knownTitle) {
    if (cache.has(pr.url)) return cache.get(pr.url);

    const pending = Promise.all([knownTitle || fetchTitle(pr), fetchDiffstat(pr)])
      .then(([title, diff]) => ({ ...pr, title, ...diff }));

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
    const actions = [...document.querySelectorAll(".gh-header-actions, [data-component='PH_Actions']")]
      .find((element) => element.offsetParent !== null);
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
          const pr = currentPr();
          const fullPr = await fetchPr(pr, titleFromDocument(document, pr.number));
          return { text: core.formatPr(fullPr), html: core.formatPrHtml(fullPr) };
        },
        "Copied!",
      );
    });
    target.element[target.placement](button);
  }

  const STACK_TITLE = /^Stack\s*#\s*\d+$/i;

  function stackPayloadTitles() {
    const titles = new Map();
    for (const value of embeddedJson(document)) {
      for (const pr of value?.payload?.pullRequestsLayoutRoute?.stack?.pulls || []) {
        if (Number.isInteger(pr.number) && pr.title) titles.set(pr.number, pr.title);
      }
    }
    return titles;
  }

  function stackEntries(container) {
    const titles = stackPayloadTitles();
    const entries = new Map();
    for (const link of container.querySelectorAll('a[href*="/pull/"]')) {
      const pr = core.parsePrUrl(link.href);
      if (!pr || entries.has(pr.url)) continue;
      const label = link.querySelector("[data-component='ActionList.Item.Label']")?.textContent.trim();
      entries.set(pr.url, { ...pr, title: label || titles.get(pr.number) || null });
    }
    return [...entries.values()];
  }

  function stackTitles() {
    return [...document.querySelectorAll("a, h1, h2, h3, span")].filter(
      (node) => STACK_TITLE.test(node.textContent.trim())
        && ![...node.children].some((child) => STACK_TITLE.test(child.textContent.trim())),
    );
  }

  function addStackButtons() {
    for (const title of stackTitles()) {
      let container = title.parentElement;
      while (container && container !== document.body && stackEntries(container).length < 2) {
        container = container.parentElement;
      }
      if (!container || container === document.body || container.querySelector(`.${STACK_BUTTON_CLASS}`)) continue;

      const button = makeButton("Copy Stack", STACK_BUTTON_CLASS, () => {
        runCopy(
          button,
          async () => {
            const entries = stackEntries(container);
            if (entries.length < 2) throw new Error("Could not find the PRs in this stack");
            const prs = await Promise.all(entries.map((entry) => fetchPr(entry, entry.title)));
            return {
              text: prs.map((pr) => `- ${core.formatPr(pr)}`).join("\n"),
              html: `<ul>${prs.map((pr) => `<li>${core.formatPrHtml(pr)}</li>`).join("")}</ul>`,
            };
          },
          "Stack copied!",
        );
      });

      // The title is a link in GitHub's stack popup, so place the button beside it, not inside it.
      (title.tagName === "A" ? title.parentElement : title).after(button);
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

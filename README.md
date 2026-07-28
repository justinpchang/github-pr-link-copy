# GitHub PR Link Copier

A Firefox extension that copies GitHub pull requests as rich links with their line diff. In Slack and other rich-text editors, links paste as formatted text; plain-text editors receive Markdown:

```md
[#24 Add authentication layer `+18/-3`](https://github.com/example/repo/pull/24)
```

![Copy PR and stack controls in GitHub](docs/github-pr-link-copy.png)

Use **Copy PR link** for one PR. For GitHub Stacked PRs, open the stack map and use **Copy Stack** to copy a top-to-bottom bulleted list. Private repositories work without a personal access token.

## Install

1. Download the `.xpi` from the latest release.
2. Open `about:debugging#/runtime/this-firefox` in Firefox.
3. Click **Load Temporary Add-on…** and select the `.xpi`.
4. Reload an open GitHub PR.

The release is unsigned, so Firefox removes it after a browser restart. Permanent distribution requires Mozilla Add-ons signing.

## Develop

```sh
node --test test.js
zip -r github-pr-link-copy.xpi manifest.json core.js content.js content.css
```

GitHub Stacked PRs is currently in private preview. Binary files contribute zero changed text lines because unified diffs do not contain their contents.

# GitHub PR Link Copier

A Firefox extension that copies GitHub pull requests as rich links with their line diff. In Slack and other rich-text editors, links paste as formatted text; plain-text editors receive Markdown:

```md
[#24 Add authentication layer `+18/-3`](https://github.com/example/repo/pull/24)
```

![Copy PR and stack controls in GitHub](docs/github-pr-link-copy.png)

Use **Copy PR link** for one PR. For GitHub Stacked PRs, open the stack map and use **Copy Stack** to copy a top-to-bottom bulleted list. Private repositories work without a personal access token.

## Install

1. Download the signed `.xpi` from the [latest release](https://github.com/justinpchang/github-pr-link-copy/releases/latest).
2. Open the downloaded file with Firefox.
3. Confirm **Add** when Firefox prompts you, then reload any open GitHub PRs.

Releases are signed by Mozilla and remain installed after Firefox restarts. If opening the file does not prompt for installation, open `about:addons`, choose the gear menu, and select **Install Add-on From File…**.

## Develop

```sh
node --test test.js
zip -r github-pr-link-copy.xpi manifest.json core.js content.js content.css
```

Load an unsigned development build from `about:debugging#/runtime/this-firefox` using **Load Temporary Add-on…**.

GitHub Stacked PRs is currently in private preview. Binary files contribute zero changed text lines because unified diffs do not contain their contents.

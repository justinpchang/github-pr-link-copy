// Builds the Firefox XPI and the Chrome zip from the same sources into dist/.
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const files = ["core.js", "content.js", "content.css"];
const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
const { version } = manifest;

fs.rmSync("dist", { recursive: true, force: true });
fs.mkdirSync("dist/chrome", { recursive: true });

execFileSync("zip", ["-q", `dist/github-pr-link-copy-firefox-${version}.xpi`, "manifest.json", ...files]);

// Chrome requires Manifest V3. Content scripts fetch github.com same-origin, so no host permissions are needed.
const chrome = {
  ...manifest,
  manifest_version: 3,
  permissions: manifest.permissions.filter((permission) => !permission.includes("://")),
};
delete chrome.browser_specific_settings;
fs.writeFileSync("dist/chrome/manifest.json", `${JSON.stringify(chrome, null, 2)}\n`);
for (const file of files) fs.copyFileSync(file, path.join("dist/chrome", file));
execFileSync("zip", ["-qr", `../github-pr-link-copy-chrome-${version}.zip`, "."], { cwd: "dist/chrome" });

console.log(fs.readdirSync("dist").filter((name) => name !== "chrome").join("\n"));

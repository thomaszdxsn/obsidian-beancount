import { readFileSync, writeFileSync } from "fs";

const targetVersion = process.env.npm_package_version;

// The community plugin list reads manifest.json / versions.json from the
// repository root, two levels above this package.
const manifestPath = new URL("../../manifest.json", import.meta.url);
const versionsPath = new URL("../../versions.json", import.meta.url);

// read minAppVersion from manifest.json and bump version to target version
let manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const { minAppVersion } = manifest;
manifest.version = targetVersion;
writeFileSync(manifestPath, JSON.stringify(manifest, null, "\t") + "\n");

// update versions.json with target version and minAppVersion from manifest.json
let versions = JSON.parse(readFileSync(versionsPath, "utf8"));
versions[targetVersion] = minAppVersion;
writeFileSync(versionsPath, JSON.stringify(versions, null, "\t") + "\n");

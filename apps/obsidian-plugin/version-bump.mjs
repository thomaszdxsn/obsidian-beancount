import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

const targetVersion = process.env.npm_package_version;
// manifest.json and versions.json live in the repository root, where Obsidian
// and the community directory read them; the caller passes that directory.
const rootDir = process.argv[2] ?? ".";
const manifestPath = join(rootDir, "manifest.json");
const versionsPath = join(rootDir, "versions.json");

// read minAppVersion from manifest.json and bump version to target version
let manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const { minAppVersion } = manifest;
manifest.version = targetVersion;
writeFileSync(manifestPath, JSON.stringify(manifest, null, "\t") + "\n");

// update versions.json with target version and minAppVersion from manifest.json
let versions = JSON.parse(readFileSync(versionsPath, "utf8"));
versions[targetVersion] = minAppVersion;
writeFileSync(versionsPath, JSON.stringify(versions, null, "\t") + "\n");

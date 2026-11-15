export const LATEST_RELEASE_URL = "https://api.github.com/repos/jitendradara12/lazyportal/releases/latest";

function parseVersion(value) {
  if (typeof value !== "string") return null;
  const match = /^v?(\d+)\.(\d+)(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(value);
  if (!match) return null;
  const numbers = [match[1], match[2], match[3] ?? "0"].map(Number);
  return numbers.every(Number.isSafeInteger) ? { numbers, prerelease: Boolean(match[4]) } : null;
}

// Only stable releases are offered; a matching prerelease can update to stable.
export function isNewerVersion(installed, latest) {
  const current = parseVersion(installed);
  const next = parseVersion(latest);
  if (!current || !next || next.prerelease) return null;
  for (let i = 0; i < 3; i++) {
    if (next.numbers[i] !== current.numbers[i]) return next.numbers[i] > current.numbers[i];
  }
  return current.prerelease;
}

export async function fetchLatestRelease(fetcher = fetch) {
  const response = await fetcher(LATEST_RELEASE_URL, {
    headers: { Accept: "application/vnd.github+json" },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error("Could not check for updates");
  const release = await response.json();
  const version = release?.tag_name;
  const parsed = parseVersion(version);
  const asset = release?.assets?.find((a) => a.name === "app-release.apk" && a.state === "uploaded");
  if (release?.draft || release?.prerelease || !parsed || parsed.prerelease || !asset) {
    throw new Error("No stable APK available");
  }
  const sha256 = /^sha256:([0-9a-f]{64})$/i.exec(asset.digest ?? "")?.[1]?.toLowerCase() ?? null;
  return {
    tag: version,
    version: version.replace(/^v/, ""),
    url: `https://github.com/jitendradara12/lazyportal/releases/download/${encodeURIComponent(version)}/app-release.apk`,
    sha256,
  };
}

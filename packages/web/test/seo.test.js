import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(__dirname, "..");
const publicDir = path.join(webDir, "public");

test("index.html contains SEO metadata", () => {
  const html = fs.readFileSync(path.join(webDir, "index.html"), "utf-8");

  assert.match(
    html,
    /<title>JUET Lazyportal \| Student Webportal, Webkiosk and Attendance<\/title>/i,
    "Title must contain primary search keywords"
  );

  assert.match(html, /<meta[^>]+name=["']description["'][^>]*content=["'][^"']+["']/i);
  assert.match(html, /<meta[^>]+name=["']keywords["'][^>]*content=["'][^"']+["']/i);
  assert.match(html, /<meta[^>]+name=["']robots["'][^>]*content=["']index,\s*follow[^"']*["']/i);
  assert.match(html, /<link[^>]+rel=["']canonical["'][^>]+href=["']https:\/\/lazyportal-tan\.vercel\.app\/["']/i);

  assert.match(html, /<meta[^>]+property=["']og:type["'][^>]+content=["']website["']/i);
  assert.match(html, /<meta[^>]+property=["']og:site_name["'][^>]+content=["']JUET Lazyportal["']/i);
  assert.match(html, /<meta[^>]+property=["']og:url["'][^>]+content=["']https:\/\/lazyportal-tan\.vercel\.app\/["']/i);
  assert.match(html, /<meta[^>]+property=["']og:image["'][^>]+content=["']https:\/\/lazyportal-tan\.vercel\.app\/og-image\.png["']/i);

  assert.match(html, /<meta[^>]+name=["']twitter:card["'][^>]+content=["']summary_large_image["']/i);
  assert.match(html, /<meta[^>]+name=["']twitter:image["'][^>]+content=["']https:\/\/lazyportal-tan\.vercel\.app\/og-image\.png["']/i);

  const jsonLdMatch = html.match(/<script type=["']application\/ld\+json["']>([\s\S]*?)<\/script>/i);
  assert.ok(jsonLdMatch, "index.html must contain JSON-LD structured data");
  const parsedJsonLd = JSON.parse(jsonLdMatch[1]);
  assert.equal(parsedJsonLd["@context"], "https://schema.org");
  assert.ok(Array.isArray(parsedJsonLd["@graph"]));
  const webApp = parsedJsonLd["@graph"].find((item) => item["@type"] === "WebApplication");
  assert.ok(webApp, "JSON-LD must define WebApplication entity");
  assert.equal(webApp.name, "JUET Lazyportal");
  assert.ok(webApp.alternateName.includes("JUET Webkiosk"));
  assert.ok(webApp.alternateName.includes("JUET Webportal"));
  assert.ok(webApp.alternateName.includes("JUET CampusLynx"));

  assert.match(html, /<noscript>[\s\S]*?JUET Lazyportal[\s\S]*?<\/noscript>/i);
});

test("robots.txt and sitemap.xml are valid", () => {
  const robotsContent = fs.readFileSync(path.join(publicDir, "robots.txt"), "utf-8");
  assert.match(robotsContent, /User-agent:\s*\*/i);
  assert.match(robotsContent, /Disallow:\s*\/api\//i, "Must disallow /api/ proxy path to avoid serverless churn");
  assert.match(robotsContent, /Sitemap:\s*https:\/\/lazyportal-tan\.vercel\.app\/sitemap\.xml/i);

  const sitemapContent = fs.readFileSync(path.join(publicDir, "sitemap.xml"), "utf-8");
  assert.match(sitemapContent, /<loc>https:\/\/lazyportal-tan\.vercel\.app\/<\/loc>/);
});

test("og-image.png matches standard 1200x630 dimensions", () => {
  const buf = fs.readFileSync(path.join(publicDir, "og-image.png"));
  assert.equal(buf.readUInt32BE(16), 1200, "og-image width must be 1200px");
  assert.equal(buf.readUInt32BE(20), 630, "og-image height must be 630px");
});

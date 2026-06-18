function firstMatch(input: string, re: RegExp): string | undefined {
  const m = input.match(re);
  return m?.[1]?.trim();
}

function decodeHtml(input?: string): string | undefined {
  if (!input) return undefined;
  return input
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function absoluteUrl(maybeUrl: string | undefined, base: string): string | undefined {
  if (!maybeUrl) return undefined;
  try {
    return new URL(maybeUrl, base).toString();
  } catch {
    return undefined;
  }
}

export async function fetchLinkPreview(url: string): Promise<{
  url: string;
  title?: string;
  description?: string;
  siteName?: string;
  image?: string;
}> {
  const target = new URL(url);
  if (!["http:", "https:"].includes(target.protocol)) throw new Error("unsupported_url");

  if (/(^|\.)youtu\.be$|(^|\.)youtube\.com$/.test(target.hostname)) {
    const oembed = new URL("https://www.youtube.com/oembed");
    oembed.searchParams.set("url", target.toString());
    oembed.searchParams.set("format", "json");
    const res = await fetch(oembed, { signal: AbortSignal.timeout(7000) });
    if (res.ok) {
      const body = (await res.json()) as { title?: string; provider_name?: string; thumbnail_url?: string };
      return {
        url: target.toString(),
        title: body.title,
        siteName: body.provider_name ?? "YouTube",
        image: body.thumbnail_url,
      };
    }
  }

  const res = await fetch(target, {
    headers: { "User-Agent": "AgentClientLinkPreview/1.0" },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`fetch_failed_${res.status}`);
  const html = (await res.text()).slice(0, 400000);
  const attr = (name: string) =>
    firstMatch(html, new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"))
    ?? firstMatch(html, new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${name}["'][^>]*>`, "i"));
  const title = decodeHtml(attr("og:title") ?? attr("twitter:title") ?? firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i));
  const description = decodeHtml(attr("og:description") ?? attr("description") ?? attr("twitter:description"));
  const siteName = decodeHtml(attr("og:site_name") ?? target.hostname.replace(/^www\./, ""));
  const image = absoluteUrl(decodeHtml(attr("og:image") ?? attr("twitter:image")), target.toString());
  return { url: target.toString(), title, description, siteName, image };
}

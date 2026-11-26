const listingHosts = {
  chatgpt: ["chatgpt.com"],
  claude: ["claude.com", "claude.ai"],
  gemini: ["gemini.google.com"],
};

export function connectListingUrl(
  platform: keyof typeof listingHosts,
  value: string | undefined,
) {
  if (!value) return;
  try {
    const url = new URL(value);
    if (
      url.protocol === "https:" &&
      listingHosts[platform].includes(url.host) &&
      !url.username &&
      !url.password &&
      url.pathname !== "/"
    )
      return url.href;
  } catch {
    // An invalid listing falls back to the manual flow.
  }
}

export const connectListings = {
  chatgpt: connectListingUrl(
    "chatgpt",
    import.meta.env.VITE_CONNECT_CHATGPT_LISTING_URL,
  ),
  claude: connectListingUrl(
    "claude",
    import.meta.env.VITE_CONNECT_CLAUDE_LISTING_URL,
  ),
  gemini: connectListingUrl(
    "gemini",
    import.meta.env.VITE_CONNECT_GEMINI_LISTING_URL,
  ),
  other: undefined,
};

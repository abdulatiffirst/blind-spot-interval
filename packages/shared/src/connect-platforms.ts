export const connectPlatforms = [
  "chatgpt",
  "claude",
  "gemini",
  "other",
] as const;
export type ConnectPlatform = (typeof connectPlatforms)[number];

export function connectPlatformForHost(host: string): ConnectPlatform {
  switch (host.toLowerCase()) {
    case "chatgpt.com":
    case "chat.openai.com":
      return "chatgpt";
    case "claude.ai":
      return "claude";
    case "oauth-redirect.googleusercontent.com":
    case "oauth-redirect-sandbox.googleusercontent.com":
    case "oauth-redirect-test.googleusercontent.com":
      return "gemini";
    default:
      return "other";
  }
}

export function connectPlatformsForRedirects(redirects: string[]) {
  const platforms = {
    chatgpt: false,
    claude: false,
    gemini: false,
    other: false,
  };
  for (const uri of redirects) {
    const { host, pathname } = new URL(uri);
    const platform = connectPlatformForHost(host);
    const recognized = {
      chatgpt:
        pathname === "/connector_platform_oauth_redirect" ||
        /^\/connector\/oauth\/[^/]+$/.test(pathname),
      claude: pathname === "/api/mcp/auth_callback",
      gemini: /^\/[ra]\/[^/]+$/.test(pathname),
      other: true,
    }[platform];
    if (recognized) platforms[platform] = true;
  }
  return platforms;
}

export const connectApprovalModes = ["ask", "allow"] as const;
export type ConnectApprovalMode = (typeof connectApprovalModes)[number];

import { AlertCircle, CheckCircle2, Info } from "lucide-react";
import type { ReactNode } from "react";
import { translate, type MessageKey } from "./i18n";

export const scopeLabels = {
  "topics:read": "connectTopicsRead",
  "topics:write": "connectTopicsWrite",
  "reviews:read": "connectReviewsRead",
  "reviews:write": "connectReviewsWrite",
  "reviews:history:read": "connectHistoryRead",
} satisfies Record<string, MessageKey>;
export type ConnectScope = keyof typeof scopeLabels;

export function ConnectNotice({
  tone = "info",
  children,
}: {
  tone?: "info" | "success" | "error";
  children: ReactNode;
}) {
  const Icon =
    tone === "error" ? AlertCircle : tone === "success" ? CheckCircle2 : Info;
  return (
    <div
      className={"connect-notice " + tone}
      role={tone === "error" ? "alert" : "status"}
    >
      <Icon size={18} aria-hidden="true" />
      <div>{children}</div>
    </div>
  );
}

export function ConnectLoading({ grid = false }: { grid?: boolean }) {
  return (
    <div
      className={grid ? "connect-grid" : "connect-loading"}
      role="status"
      aria-label={translate("connectLoad")}
    >
      {Array.from({ length: grid ? 4 : 1 }, (_, index) => (
        <div key={index} className="connect-placeholder" aria-hidden="true">
          <span className="connect-placeholder-icon" />
          <span />
          <span />
        </div>
      ))}
    </div>
  );
}

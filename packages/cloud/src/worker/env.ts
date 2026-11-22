import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import type { Account } from "./account.ts";
import type { Directory } from "./directory.ts";

export interface Env {
  OAUTH_KV: KVNamespace;
  SETUP_KEY: string;
  SIGNUPS: string;
  ACCOUNT: DurableObjectNamespace<Account>;
  DIRECTORY: DurableObjectNamespace<Directory>;
  ASSETS: Fetcher;
  /** Added by OAuthProvider for the default handler. */
  OAUTH_PROVIDER: OAuthHelpers;
}

/** What completeAuthorization() stores with each MCP grant. */
export interface McpProps extends Record<string, unknown> {
  accountId: string;
}

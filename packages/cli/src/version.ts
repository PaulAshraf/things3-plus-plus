import { createRequire } from "node:module";

/** Set by scripts/build.mjs from package.json; read directly when running from source (tests). */
declare const __THINGS3PP_VERSION__: string | undefined;

export const VERSION: string =
  typeof __THINGS3PP_VERSION__ === "string"
    ? __THINGS3PP_VERSION__
    : (createRequire(import.meta.url)("../package.json") as { version: string }).version;

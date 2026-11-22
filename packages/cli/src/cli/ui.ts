// Tiny terminal helpers — no dependencies.
import { createInterface } from "node:readline/promises";

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const wrap = (code: string) => (s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);

export const c = {
  bold: wrap("1"),
  dim: wrap("2"),
  green: wrap("32"),
  yellow: wrap("33"),
  red: wrap("31"),
  blue: wrap("34"),
  cyan: wrap("36"),
};

export const ok = (msg: string) => console.log(`${c.green("✔")} ${msg}`);
export const warn = (msg: string) => console.log(`${c.yellow("!")} ${msg}`);
export const fail = (msg: string) => console.log(`${c.red("✘")} ${msg}`);
export const info = (msg: string) => console.log(`${c.dim("·")} ${msg}`);

export async function confirm(question: string, defaultYes = true): Promise<boolean> {
  if (!process.stdin.isTTY) return defaultYes;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(`${c.cyan("?")} ${question} ${c.dim(defaultYes ? "(Y/n)" : "(y/N)")} `)).trim().toLowerCase();
    if (!answer) return defaultYes;
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

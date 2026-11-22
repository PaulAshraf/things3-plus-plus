// Errors shared by the local bridge and the hosted relay. No Node APIs here.

export type ThingsErrorCode =
  | "permission_denied"
  | "permission_pending"
  | "not_installed"
  | "not_found"
  | "timeout"
  | "unsupported_platform"
  | "things_error";

export class ThingsError extends Error {
  constructor(
    message: string,
    readonly code: ThingsErrorCode,
  ) {
    super(message);
    this.name = "ThingsError";
  }
}

export function toThingsError(message: string, errorNumber: number | null): ThingsError {
  const n = errorNumber ?? Number(/\((-?\d+)\)\s*$/.exec(message.trim())?.[1] ?? NaN);
  if (n === -1743 || /not authori[sz]ed/i.test(message)) {
    return new ThingsError(
      "macOS blocked access to Things. Open System Settings → Privacy & Security → Automation, find the app running this server, and enable \"Things3\".",
      "permission_denied",
    );
  }
  if (n === -1712) {
    return new ThingsError(
      "Things didn't respond. macOS may be waiting for you to approve access — look for a \"wants to control Things3\" prompt and click OK.",
      "permission_pending",
    );
  }
  if (n === -2700 && /Application can't be found/i.test(message)) {
    return new ThingsError("Things 3 doesn't seem to be installed.", "not_installed");
  }
  if (/Application can.t be found/i.test(message)) {
    return new ThingsError("Things 3 doesn't seem to be installed.", "not_installed");
  }
  if (/^No (to-do|project|area)/.test(message) || n === -1728) {
    return new ThingsError(message, "not_found");
  }
  return new ThingsError(`Things reported an error: ${message}`, "things_error");
}

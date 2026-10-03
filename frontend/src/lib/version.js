// Promethius app version.
// Base lives in /app/VERSION (bump for big releases). The displayed version is
// fetched live from GET /api/system/version, which appends the current git commit —
// so it updates automatically every time Promethius is pulled/updated.
import api from "./api";

export const APP_VERSION = "v27.5.0"; // static fallback if the API is unreachable

export async function fetchVersion() {
  try {
    const r = await api.get("/system/version");
    return r.data?.display || r.data?.version || APP_VERSION;
  } catch {
    return APP_VERSION;
  }
}

import Constants from "expo-constants";

function debugHosts(): string[] {
  const hosts = new Set<string>(["127.0.0.1", "10.0.2.2"]);
  try {
    const hostUri =
      Constants.expoConfig?.hostUri ||
      Constants.linkingUri?.replace(/^exp:\/\//, "").replace(/\/.*$/, "");
    const host = hostUri?.split(":")[0];
    if (host) hosts.add(host);
  } catch {
    /* ignore */
  }
  return [...hosts];
}

export function agentLog(
  hypothesisId: string,
  location: string,
  message: string,
  data: Record<string, unknown> = {}
): void {
  const payload = JSON.stringify({
    sessionId: "89656d",
    runId: "freeze",
    hypothesisId,
    location,
    message,
    data,
    timestamp: Date.now(),
  });
  // #region agent log
  for (const host of debugHosts()) {
    fetch(`http://${host}:7677/ingest/217f9228-6275-432a-b240-b52166a932e5`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Debug-Session-Id": "89656d",
      },
      body: payload,
    }).catch(() => {});
  }
  console.log(`[dbg-89656d][${hypothesisId}] ${location}: ${message}`, data);
  // #endregion
}

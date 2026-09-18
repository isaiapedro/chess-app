import { TurboModuleRegistry, Platform } from "react-native";
import Constants from "expo-constants";
import { registerRootComponent } from "expo";

import App from "./App";

// #region agent log
fetch("http://127.0.0.1:7474/ingest/3d67426d-0ccd-41bb-b08a-f7bf8ec78c30", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Debug-Session-Id": "6840b8",
  },
  body: JSON.stringify({
    sessionId: "6840b8",
    runId: "pre-fix",
    hypothesisId: "B",
    location: "index.ts:boot",
    message: "entry reached before gesture-handler",
    data: {
      platform: Platform.OS,
      appOwnership: Constants.appOwnership,
      executionEnvironment: Constants.executionEnvironment,
      expoVersion: Constants.expoConfig?.sdkVersion ?? null,
      expoGoVersion: (Constants as { expoVersion?: string }).expoVersion ?? null,
      entryMain: "index.ts",
    },
    timestamp: Date.now(),
  }),
}).catch(() => {});
// #endregion

let ghModulePresent: boolean | null = null;
try {
  ghModulePresent =
    TurboModuleRegistry.get("RNGestureHandlerModule") != null;
} catch (e) {
  ghModulePresent = false;
  // #region agent log
  fetch("http://127.0.0.1:7474/ingest/3d67426d-0ccd-41bb-b08a-f7bf8ec78c30", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Debug-Session-Id": "6840b8",
    },
    body: JSON.stringify({
      sessionId: "6840b8",
      runId: "pre-fix",
      hypothesisId: "A",
      location: "index.ts:turbo-get",
      message: "TurboModuleRegistry.get threw",
      data: { error: e instanceof Error ? e.message : String(e) },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
}

// #region agent log
fetch("http://127.0.0.1:7474/ingest/3d67426d-0ccd-41bb-b08a-f7bf8ec78c30", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Debug-Session-Id": "6840b8",
  },
  body: JSON.stringify({
    sessionId: "6840b8",
    runId: "pre-fix",
    hypothesisId: "A",
    location: "index.ts:gh-probe",
    message: "RNGestureHandlerModule probe",
    data: { ghModulePresent },
    timestamp: Date.now(),
  }),
}).catch(() => {});
// #endregion

if (ghModulePresent) {
  try {
    require("react-native-gesture-handler");
    // #region agent log
    fetch("http://127.0.0.1:7474/ingest/3d67426d-0ccd-41bb-b08a-f7bf8ec78c30", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Debug-Session-Id": "6840b8",
      },
      body: JSON.stringify({
        sessionId: "6840b8",
        runId: "pre-fix",
        hypothesisId: "A",
        location: "index.ts:gh-require",
        message: "gesture-handler require ok",
        data: {},
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
  } catch (e) {
    // #region agent log
    fetch("http://127.0.0.1:7474/ingest/3d67426d-0ccd-41bb-b08a-f7bf8ec78c30", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Debug-Session-Id": "6840b8",
      },
      body: JSON.stringify({
        sessionId: "6840b8",
        runId: "pre-fix",
        hypothesisId: "A",
        location: "index.ts:gh-require",
        message: "gesture-handler require failed",
        data: { error: e instanceof Error ? e.message : String(e) },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
  }
}

registerRootComponent(App);

// #region agent log
fetch("http://127.0.0.1:7474/ingest/3d67426d-0ccd-41bb-b08a-f7bf8ec78c30", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Debug-Session-Id": "6840b8",
  },
  body: JSON.stringify({
    sessionId: "6840b8",
    runId: "pre-fix",
    hypothesisId: "C",
    location: "index.ts:register",
    message: "registerRootComponent called",
    data: { ghModulePresent },
    timestamp: Date.now(),
  }),
}).catch(() => {});
// #endregion

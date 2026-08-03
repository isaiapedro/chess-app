import { Platform } from "react-native";
import {
  GLOBAL_HASH_MB,
  GLOBAL_LOW_END_HASH_MB,
  GLOBAL_LOW_END_THREADS,
  GLOBAL_THREADS,
} from "./analysisConfig";

export type EngineResources = {
  threads: number;
  hashMb: number;
};

function readHardwareConcurrency(): number | null {
  try {
    const nav = globalThis as {
      navigator?: { hardwareConcurrency?: number };
    };
    const cores = nav.navigator?.hardwareConcurrency;
    return typeof cores === "number" && cores > 0 ? cores : null;
  } catch {
    return null;
  }
}

export function isLowEndDevice(): boolean {
  const cores = readHardwareConcurrency();
  if (cores != null && cores <= 4) return true;
  if (Platform.OS === "android") {
    const version =
      typeof Platform.Version === "number"
        ? Platform.Version
        : Number.parseInt(String(Platform.Version), 10);
    if (Number.isFinite(version) && version <= 28) return true;
  }
  return false;
}

export function resolveEngineResources(): EngineResources {
  if (isLowEndDevice()) {
    return {
      threads: GLOBAL_LOW_END_THREADS,
      hashMb: GLOBAL_LOW_END_HASH_MB,
    };
  }
  return { threads: GLOBAL_THREADS, hashMb: GLOBAL_HASH_MB };
}

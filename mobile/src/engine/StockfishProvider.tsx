import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { StyleSheet, View } from "react-native";
import Constants from "expo-constants";
import { WebView, type WebViewMessageEvent } from "react-native-webview";

type EvalResult = {
  cpWhite: number;
  bestUci: string | null;
  bestPv: string[];
  multipv: Array<{ uci: string; cpWhite: number; pv: string[] }>;
};

type StockfishContextValue = {
  ready: boolean;
  error: string | null;
  evaluate: (
    fen: string,
    depth?: number,
    multiPv?: number
  ) => Promise<EvalResult>;
};

const StockfishContext = createContext<StockfishContextValue | null>(null);

type Pending = {
  id: string;
  resolve: (value: EvalResult) => void;
  reject: (error: Error) => void;
};

function debugIngestUrl(): string {
  const hostUri =
    Constants.expoConfig?.hostUri ||
    Constants.linkingUri?.replace(/^exp:\/\//, "").replace(/\/.*$/, "");
  const host = hostUri?.split(":")[0];
  if (host) {
    return `http://${host}:7474/ingest/3d67426d-0ccd-41bb-b08a-f7bf8ec78c30`;
  }
  return "http://127.0.0.1:7474/ingest/3d67426d-0ccd-41bb-b08a-f7bf8ec78c30";
}

function agentLog(
  location: string,
  message: string,
  data: Record<string, unknown>
) {
  // #region agent log
  console.log(`[sf-debug] ${message}`, data);
  fetch(debugIngestUrl(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Debug-Session-Id": "6840b8",
    },
    body: JSON.stringify({
      sessionId: "6840b8",
      runId: "sf-main-thread",
      hypothesisId: "K",
      location,
      message,
      data,
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
}

const SF_BASE = "https://cdn.jsdelivr.net/npm/stockfish@11.0.0/src/";
const SF_JS = `${SF_BASE}stockfish.js`;
const SF_WASM = `${SF_BASE}stockfish.wasm`;

const ENGINE_HTML = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body>
<script>
  let engine = null;
  let ready = false;
  let currentId = null;
  let bestByPv = {};
  let scoreByPv = {};
  let wantedMultiPv = 1;
  let bootTimer = null;

  function send(type, payload) {
    window.ReactNativeWebView.postMessage(JSON.stringify({ type, ...payload }));
  }

  function resetCollect() {
    bestByPv = {};
    scoreByPv = {};
  }

  function handleLine(raw) {
    var line = raw && raw.data != null ? raw.data : raw;
    if (line == null) return;
    line = String(line);
    if (!ready && (line.indexOf('uciok') === 0 || line.indexOf('readyok') === 0 || line.indexOf('id ') === 0)) {
      send('debug', { stage: 'uci-line', line: line.slice(0, 120) });
    }
    if (line === 'uciok' || line.indexOf('uciok') === 0) {
      send('debug', { stage: 'uciok-received' });
      engine.postMessage('isready');
      return;
    }
    if (line === 'readyok' || line.indexOf('readyok') === 0) {
      if (!ready) {
        ready = true;
        if (bootTimer) clearTimeout(bootTimer);
        send('debug', { stage: 'readyok-received' });
        send('ready', {});
      }
      return;
    }
    if (line.indexOf('info ') === 0 && line.indexOf(' score ') !== -1 && line.indexOf(' pv ') !== -1) {
      var multipvMatch = line.match(/multipv (\\d+)/);
      var multipv = multipvMatch ? parseInt(multipvMatch[1], 10) : 1;
      var cpMatch = line.match(/score cp (-?\\d+)/);
      var mateMatch = line.match(/score mate (-?\\d+)/);
      var pvIdx = line.indexOf(' pv ');
      if (pvIdx < 0) return;
      var pvTokens = line.slice(pvIdx + 4).trim().split(/\\s+/);
      var pvUcis = [];
      for (var p = 0; p < pvTokens.length; p++) {
        if (/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(pvTokens[p])) pvUcis.push(pvTokens[p]);
        else break;
      }
      if (!pvUcis.length) return;
      var cp = 0;
      if (cpMatch) cp = parseInt(cpMatch[1], 10);
      else if (mateMatch) {
        var mate = parseInt(mateMatch[1], 10);
        cp = mate > 0 ? 100000 - mate * 1000 : -100000 - mate * 1000;
      }
      bestByPv[multipv] = pvUcis;
      scoreByPv[multipv] = cp;
      return;
    }
    if (line.indexOf('bestmove') === 0) {
      var multipvList = [];
      for (var i = 1; i <= wantedMultiPv; i++) {
        if (bestByPv[i] != null && scoreByPv[i] != null) {
          multipvList.push({
            uci: bestByPv[i][0],
            cpWhite: scoreByPv[i],
            pv: bestByPv[i]
          });
        }
      }
      var bestUci = multipvList.length ? multipvList[0].uci : null;
      var bestPv = multipvList.length ? multipvList[0].pv : [];
      var cpWhite = multipvList.length ? multipvList[0].cpWhite : 0;
      var bm = line.split(' ');
      if (!bestUci && bm[1] && bm[1] !== '(none)') {
        bestUci = bm[1];
        bestPv = [bm[1]];
      }
      send('eval', {
        id: currentId,
        cpWhite: cpWhite,
        bestUci: bestUci,
        bestPv: bestPv,
        multipv: multipvList
      });
      currentId = null;
      resetCollect();
    }
  }

  function bindEngine(sf) {
    engine = sf;
    engine.onmessage = handleLine;
    send('debug', { stage: 'engine-bound', mode: 'stockfish11-main' });
    engine.postMessage('uci');
  }

  function bootWithFactory() {
    if (typeof STOCKFISH !== 'function') {
      send('error', { message: 'STOCKFISH factory missing after script load' });
      return;
    }
    try {
      var sf = STOCKFISH('${SF_WASM}');
      bindEngine(sf);
    } catch (err) {
      send('error', { message: 'STOCKFISH() failed: ' + String(err && err.message ? err.message : err) });
    }
  }

  function boot() {
    send('debug', {
      stage: 'boot-start',
      wasm: typeof WebAssembly,
      ua: navigator.userAgent
    });
    bootTimer = setTimeout(function () {
      if (!ready) send('error', { message: 'Stockfish boot timeout (no readyok)' });
    }, 60000);

    var script = document.createElement('script');
    script.src = '${SF_JS}';
    script.onload = function () {
      send('debug', { stage: 'script-loaded', typeofSTOCKFISH: typeof STOCKFISH });
      bootWithFactory();
    };
    script.onerror = function () {
      send('error', { message: 'Failed to load stockfish@11 script' });
    };
    document.body.appendChild(script);
  }

  document.addEventListener('message', onRn);
  window.addEventListener('message', onRn);

  function onRn(event) {
    var raw = event && event.data;
    if (!raw) return;
    var msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }
    if (!msg || !msg.type) return;
    if (msg.type === 'ping') {
      send('pong', {});
      return;
    }
    if (msg.type === 'eval') {
      if (!engine || !ready) {
        send('error', { id: msg.id, message: 'Engine not ready' });
        return;
      }
      currentId = msg.id;
      wantedMultiPv = Math.max(1, Math.min(5, msg.multiPv || 1));
      resetCollect();
      engine.postMessage('setoption name MultiPV value ' + wantedMultiPv);
      engine.postMessage('ucinewgame');
      engine.postMessage('position fen ' + msg.fen);
      engine.postMessage('go depth ' + (msg.depth || 12));
    }
  }

  boot();
</script>
</body>
</html>`;

export function StockfishProvider({ children }: { children: React.ReactNode }) {
  const webRef = useRef<WebView>(null);
  const pending = useRef<Map<string, Pending>>(new Map());
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const post = useCallback((payload: Record<string, unknown>) => {
    const raw = JSON.stringify(payload);
    const wv = webRef.current;
    if (!wv) return;
    wv.postMessage(raw);
    wv.injectJavaScript(
      `window.dispatchEvent(new MessageEvent('message',{data:${JSON.stringify(raw)}}));true;`
    );
  }, []);

  useEffect(() => {
    agentLog("StockfishProvider.tsx:mount", "provider mounted", {
      mode: "stockfish11-main",
    });
    return () => {
      pending.current.forEach((item) =>
        item.reject(new Error("Stockfish unmounted"))
      );
      pending.current.clear();
    };
  }, []);

  const onMessage = useCallback((event: WebViewMessageEvent) => {
    let msg: {
      type?: string;
      id?: string;
      message?: string;
      stage?: string;
      mode?: string;
      typeofSTOCKFISH?: string;
      line?: string;
      wasm?: string;
      ua?: string;
      cpWhite?: number;
      bestUci?: string | null;
      bestPv?: string[];
      multipv?: Array<{ uci: string; cpWhite: number; pv?: string[] }>;
    };
    try {
      msg = JSON.parse(event.nativeEvent.data);
    } catch {
      return;
    }
    if (msg.type === "debug") {
      agentLog("StockfishProvider.tsx:debug", "webview debug", {
        stage: msg.stage,
        mode: msg.mode,
        typeofSTOCKFISH: msg.typeofSTOCKFISH,
        line: msg.line,
        wasm: msg.wasm,
      });
      return;
    }
    if (msg.type === "ready") {
      agentLog("StockfishProvider.tsx:ready", "stockfish ready", {});
      setReady(true);
      setError(null);
      return;
    }
    if (msg.type === "error") {
      agentLog("StockfishProvider.tsx:error", "stockfish error", {
        error: msg.message || null,
        id: msg.id || null,
      });
      if (msg.id && pending.current.has(msg.id)) {
        const item = pending.current.get(msg.id)!;
        pending.current.delete(msg.id);
        item.reject(new Error(msg.message || "Engine error"));
        return;
      }
      setError(msg.message || "Engine error");
      return;
    }
    if (msg.type === "eval" && msg.id) {
      const item = pending.current.get(msg.id);
      if (!item) return;
      pending.current.delete(msg.id);
      item.resolve({
        cpWhite: Number(msg.cpWhite || 0),
        bestUci: msg.bestUci || null,
        bestPv: msg.bestPv || (msg.bestUci ? [msg.bestUci] : []),
        multipv: (msg.multipv || []).map((line) => ({
          uci: line.uci,
          cpWhite: line.cpWhite,
          pv: line.pv || [line.uci],
        })),
      });
    }
  }, []);

  const evaluate = useCallback(
    (fen: string, depth = 12, multiPv = 1) => {
      return new Promise<EvalResult>((resolve, reject) => {
        if (!ready) {
          reject(new Error("Stockfish not ready"));
          return;
        }
        const id = `e${++seq.current}`;
        pending.current.set(id, { id, resolve, reject });
        post({ type: "eval", id, fen, depth, multiPv });
        setTimeout(() => {
          if (!pending.current.has(id)) return;
          pending.current.delete(id);
          reject(new Error("Stockfish timeout"));
        }, 30000);
      });
    },
    [post, ready]
  );

  const value = useMemo(
    () => ({ ready, error, evaluate }),
    [ready, error, evaluate]
  );

  return (
    <StockfishContext.Provider value={value}>
      {children}
      <View style={styles.hidden} pointerEvents="none">
        <WebView
          ref={webRef}
          originWhitelist={["*"]}
          source={{ html: ENGINE_HTML, baseUrl: SF_BASE }}
          onMessage={onMessage}
          onLoadEnd={() => {
            agentLog("StockfishProvider.tsx:onLoadEnd", "webview loaded", {});
          }}
          onError={(e) => {
            agentLog("StockfishProvider.tsx:onError", "webview error", {
              desc: e.nativeEvent.description,
            });
            setError(e.nativeEvent.description || "WebView failed");
          }}
          javaScriptEnabled
          domStorageEnabled
          allowFileAccess
          allowUniversalAccessFromFileURLs
          mixedContentMode="always"
          setSupportMultipleWindows={false}
          style={styles.hidden}
        />
      </View>
    </StockfishContext.Provider>
  );
}

export function useStockfish(): StockfishContextValue {
  const ctx = useContext(StockfishContext);
  if (!ctx) throw new Error("useStockfish must be used within StockfishProvider");
  return ctx;
}

const styles = StyleSheet.create({
  hidden: {
    width: 1,
    height: 1,
    opacity: 0.01,
    position: "absolute",
    left: 0,
    top: 0,
  },
});

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
import { Chess } from "chess.js";

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
    multiPv?: number,
    movetimeMs?: number
  ) => Promise<EvalResult>;
};

const StockfishContext = createContext<StockfishContextValue | null>(null);

const MATED_SCORE = -100000;

function terminalEval(fen: string): EvalResult | null {
  let board: Chess;
  try {
    board = new Chess(fen);
  } catch {
    return null;
  }
  if (!board.isGameOver()) return null;
  return {
    cpWhite: board.isCheckmate() ? MATED_SCORE : 0,
    bestUci: null,
    bestPv: [],
    multipv: [],
  };
}

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
    return `http://${host}:7677/ingest/217f9228-6275-432a-b240-b52166a932e5`;
  }
  return "http://127.0.0.1:7677/ingest/217f9228-6275-432a-b240-b52166a932e5";
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
      runId: "sf18-unpkg-post-fix",
      hypothesisId: String(data.hyp || "K"),
      location,
      message,
      data,
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
}

const SF_BASE = "https://unpkg.com/stockfish@18.0.8/bin/";
const SF_JS_URL = `${SF_BASE}stockfish-18-lite-single.js`;
const SF_WASM_URL = `${SF_BASE}stockfish-18-lite-single.wasm`;
// #region agent log
const PROBE_GH_JS =
  "https://github.com/nmrugg/stockfish.js/releases/download/v18.0.0/stockfish-18-lite-single.js";
// #endregion

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
  let pvByMove = {};
  let scoreByMove = {};
  let wantedMultiPv = 1;
  let bootTimer = null;
  let searching = false;
  let queuedReq = null;
  let seenIds = {};
  let seenCount = 0;
  // #region agent log
  let rawMsgCount = 0;
  let goCount = 0;
  // #endregion

  function send(type, payload) {
    window.ReactNativeWebView.postMessage(JSON.stringify({ type, ...payload }));
  }

  function resetCollect() {
    bestByPv = {};
    scoreByPv = {};
    pvByMove = {};
    scoreByMove = {};
  }

  function handleLine(raw) {
    var line = raw && raw.data != null ? raw.data : raw;
    if (line == null) return;
    line = String(line);
    // #region agent log
    if (line.indexOf('__dbg ') === 0) {
      send('probe', { probe: 'worker-dbg', hyp: 'FG', ok: true, err: line.slice(6, 240) });
      return;
    }
    if (rawMsgCount < 25) {
      rawMsgCount++;
      send('probe', { probe: 'worker-msg', hyp: 'HI', ok: true, err: line.slice(0, 200) });
    }
    // #endregion
    if (!ready && (line.indexOf('uciok') === 0 || line.indexOf('readyok') === 0 || line.indexOf('id ') === 0)) {
      send('debug', { stage: 'uci-line', line: line.slice(0, 120) });
    }
    if (line === 'uciok' || line.indexOf('uciok') === 0) {
      send('debug', { stage: 'uciok-received' });
      engine.postMessage('setoption name Hash value 64');
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
      var head = pvUcis[0];
      var known = pvByMove[head];
      if (!known || pvUcis.length >= known.length) pvByMove[head] = pvUcis;
      scoreByMove[head] = cp;
      return;
    }
    if (line.indexOf('bestmove') === 0) {
      var bm = line.split(/\\s+/);
      var bestmoveUci = bm[1] && bm[1] !== '(none)' ? bm[1] : null;
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
      var bestUci = bestmoveUci || (multipvList[0] ? multipvList[0].uci : null);
      var matched = bestUci
        ? multipvList.find(function (row) { return row.uci === bestUci; })
        : null;
      var trackedPv = bestUci ? pvByMove[bestUci] : null;
      var bestPv =
        matched && matched.pv && matched.pv.length > 1
          ? matched.pv
          : (trackedPv && trackedPv.length
            ? trackedPv
            : (matched && matched.pv ? matched.pv : (bestUci ? [bestUci] : [])));
      var cpWhite = matched
        ? matched.cpWhite
        : (bestUci && scoreByMove[bestUci] != null
          ? scoreByMove[bestUci]
          : (multipvList[0] ? multipvList[0].cpWhite : 0));
      searching = false;
      // #region agent log
      send('probe', {
        probe: 'bm-pv', hyp: 'J', ok: bestPv.length > 1,
        err: 'go#' + goCount + ' bm=' + String(bestmoveUci) +
          ' matched=' + String(!!matched) +
          ' tracked=' + String(trackedPv ? trackedPv.length : 0) +
          ' pvLen=' + bestPv.length + ' cp=' + cpWhite +
          ' lines=' + multipvList.length
      });
      // #endregion
      send('eval', {
        id: currentId,
        cpWhite: cpWhite,
        bestUci: bestUci,
        bestPv: bestPv,
        multipv: multipvList
      });
      currentId = null;
      resetCollect();
      if (queuedReq) {
        var next = queuedReq;
        queuedReq = null;
        startSearch(next);
      }
    }
  }

  function bindEngine(sf) {
    engine = sf;
    engine.onmessage = function (event) {
      handleLine(event && event.data != null ? event.data : event);
    };
    // #region agent log
    engine.onerror = function (ev) {
      send('probe', {
        probe: 'worker-error', hyp: 'F', ok: false,
        err: String((ev && (ev.message || ev.filename)) || 'unknown') + ':' + String(ev && ev.lineno)
      });
    };
    engine.onmessageerror = function () {
      send('probe', { probe: 'worker-messageerror', hyp: 'F', ok: false, err: 'messageerror' });
    };
    setTimeout(function () {
      if (!ready) send('probe', { probe: 'boot-watchdog', hyp: 'HI', ok: false, err: 'msgs=' + rawMsgCount });
    }, 15000);
    // #endregion
    send('debug', { stage: 'engine-bound', mode: 'stockfish18-lite-single' });
    engine.postMessage('uci');
  }

  function bootFromBlobs(jsText, wasmBuffer) {
    var wasmUrl = URL.createObjectURL(new Blob([wasmBuffer], { type: 'application/wasm' }));
    var prefix = [
      // #region agent log
      'self.__dbg = function (m) { try { self.postMessage("__dbg " + m); } catch (e) {} };',
      'self.onerror = function (msg, src, line) { self.__dbg("onerror " + String(msg) + " @" + String(src).slice(0, 60) + ":" + String(line)); };',
      'self.addEventListener("unhandledrejection", function (ev) { self.__dbg("rejection " + String(ev && ev.reason)); });',
      // #endregion
      'var __wasmUrl = ' + JSON.stringify(wasmUrl) + ';',
      'var __origFetch = self.fetch.bind(self);',
      'self.fetch = function (input, init) {',
      // #region agent log
      '  self.__dbg("fetch " + String(typeof input === "string" ? input : (input && input.url) || "").slice(0, 100) + " -> wasm blob");',
      // #endregion
      '  return __origFetch(__wasmUrl, init)',
      // #region agent log
      '    .then(function (r) { self.__dbg("fetch-done " + r.status); return r; },',
      '      function (e) { self.__dbg("fetch-fail " + String(e && e.message)); throw e; })',
      // #endregion
      '  ;',
      '};',
      // #region agent log
      'self.__dbg("prefix-loaded typeofWA=" + typeof WebAssembly);'
      // #endregion
    ].join('\\n');
    var workerUrl = URL.createObjectURL(
      new Blob([prefix + '\\n' + jsText], { type: 'application/javascript' })
    );
    bindEngine(new Worker(workerUrl));
  }

  // #region agent log
  async function probeUrl(id, hyp, url, opts) {
    var t0 = Date.now();
    try {
      var res = await fetch(url, opts || {});
      var bytes = -1;
      if (!opts || opts.method !== 'HEAD') {
        var buf = await res.arrayBuffer();
        bytes = buf.byteLength;
      }
      send('probe', {
        probe: id, hyp: hyp, ok: res.ok, status: res.status,
        bytes: bytes, ms: Date.now() - t0
      });
    } catch (e) {
      send('probe', {
        probe: id, hyp: hyp, ok: false, status: -1,
        err: String(e && e.message ? e.message : e), ms: Date.now() - t0
      });
    }
  }

  async function probeBlobWorker() {
    try {
      var url = URL.createObjectURL(new Blob(
        ['self.onmessage=function(e){self.postMessage("pong:"+e.data);};'],
        { type: 'application/javascript' }
      ));
      var w = new Worker(url);
      var outcome = await new Promise(function (resolve) {
        var done = false;
        var timer = setTimeout(function () { if (!done) { done = true; resolve('timeout'); } }, 5000);
        w.onmessage = function (ev) {
          if (done) return;
          done = true; clearTimeout(timer); resolve(String(ev.data));
        };
        w.onerror = function (ev) {
          if (done) return;
          done = true; clearTimeout(timer);
          resolve('error:' + (ev && ev.message ? ev.message : 'unknown'));
        };
        w.postMessage('ping');
      });
      w.terminate();
      send('probe', { probe: 'blob-worker', hyp: 'D', ok: outcome === 'pong:ping', err: outcome });
    } catch (e) {
      send('probe', {
        probe: 'blob-worker', hyp: 'D', ok: false,
        err: String(e && e.message ? e.message : e)
      });
    }
  }

  async function runProbes() {
    send('probe', { probe: 'origin', hyp: 'A', ok: true, err: String(location.origin) });
    await probeUrl('gh-js-control', 'A', '${PROBE_GH_JS}');
    await probeBlobWorker();
  }
  // #endregion

  async function boot() {
    // #region agent log
    await runProbes();
    // #endregion
    send('debug', {
      stage: 'boot-start',
      wasm: typeof WebAssembly,
      worker: typeof Worker,
      ua: navigator.userAgent
    });
    if (typeof WebAssembly === 'undefined') {
      send('error', { message: 'WebAssembly unavailable in WebView' });
      return;
    }
    if (typeof Worker === 'undefined') {
      send('error', { message: 'Worker unavailable in WebView' });
      return;
    }
    bootTimer = setTimeout(function () {
      if (!ready) send('error', { message: 'Stockfish boot timeout (no readyok)' });
    }, 120000);

    try {
      send('debug', { stage: 'download-start' });
      var results = await Promise.all([
        fetch('${SF_JS_URL}'),
        fetch('${SF_WASM_URL}')
      ]);
      if (!results[0].ok || !results[1].ok) {
        throw new Error('SF18 download failed: js=' + results[0].status + ' wasm=' + results[1].status);
      }
      var jsText = await results[0].text();
      var wasmBuffer = await results[1].arrayBuffer();
      send('debug', {
        stage: 'download-done',
        jsBytes: jsText.length,
        wasmBytes: wasmBuffer.byteLength
      });
      bootFromBlobs(jsText, wasmBuffer);
    } catch (err) {
      send('error', {
        message: 'Stockfish@18 boot failed: ' + String(err && err.message ? err.message : err)
      });
    }
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
      if (msg.id && seenIds[msg.id]) return;
      if (msg.id) {
        if (seenCount > 500) { seenIds = {}; seenCount = 0; }
        seenIds[msg.id] = 1;
        seenCount++;
      }
      if (searching) {
        queuedReq = msg;
        try { engine.postMessage('stop'); } catch (e) {}
        return;
      }
      startSearch(msg);
    }
  }

  function startSearch(msg) {
    resetCollect();
    currentId = msg.id;
    wantedMultiPv = Math.max(1, Math.min(5, msg.multiPv || 1));
    searching = true;
    // #region agent log
    goCount++;
    // #endregion
    engine.postMessage('setoption name MultiPV value ' + wantedMultiPv);
    engine.postMessage('position fen ' + msg.fen);
    engine.postMessage('go depth ' + (msg.depth || 15) + ' movetime ' + (msg.movetime || 1200));
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
      mode: "stockfish18-lite-single",
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
      worker?: string;
      ua?: string;
      jsBytes?: number;
      wasmBytes?: number;
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
    // #region agent log
    if (msg.type === "probe") {
      const { type: _t, ...rest } = msg as Record<string, unknown>;
      agentLog("StockfishProvider.tsx:probe", "webview probe", rest);
      return;
    }
    // #endregion
    if (msg.type === "debug") {
      agentLog("StockfishProvider.tsx:debug", "webview debug", {
        stage: msg.stage,
        mode: msg.mode,
        typeofSTOCKFISH: msg.typeofSTOCKFISH,
        line: msg.line,
        wasm: msg.wasm,
        worker: msg.worker,
        jsBytes: msg.jsBytes,
        wasmBytes: msg.wasmBytes,
      });
      return;
    }
    if (msg.type === "ready") {
      agentLog("StockfishProvider.tsx:ready", "stockfish ready", {
        mode: "stockfish18-lite-single",
      });
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
    (fen: string, depth = 15, multiPv = 1, movetimeMs = 1200) => {
      return new Promise<EvalResult>((resolve, reject) => {
        const terminal = terminalEval(fen);
        if (terminal) {
          resolve(terminal);
          return;
        }
        if (!ready) {
          reject(new Error("Stockfish not ready"));
          return;
        }
        const id = `e${++seq.current}`;
        pending.current.set(id, { id, resolve, reject });
        post({ type: "eval", id, fen, depth, multiPv, movetime: movetimeMs });
        setTimeout(() => {
          if (!pending.current.has(id)) return;
          pending.current.delete(id);
          reject(new Error("Stockfish timeout"));
        }, movetimeMs + 5000);
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

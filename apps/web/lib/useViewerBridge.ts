"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  QIHANG_VIEWER_SOURCE,
  QIHANG_WEB_SOURCE,
  VIEWER_MESSAGE_GET_STATE,
  VIEWER_MESSAGE_READY,
  VIEWER_MESSAGE_SET_STATE,
  VIEWER_MESSAGE_STATE,
} from "@/lib/qihang-viewer-contract";

export type ViewerBridgeOptions = {
  enabled: boolean;
  deferredSrc: string | undefined;
};

export type ViewerBridge = {
  iframeRef: React.MutableRefObject<HTMLIFrameElement | null>;
  viewerConnected: boolean;
  viewerStatus: string;
  onIframeLoad: () => void;
  sendPatch: (patch: Record<string, unknown>) => void;
};

export function useViewerBridge({ enabled, deferredSrc }: ViewerBridgeOptions): ViewerBridge {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const handshakeIntervalRef = useRef<number | null>(null);
  const handshakeTimeoutRef = useRef<number | null>(null);
  const latestPatchRef = useRef<Record<string, unknown>>({});
  const lastPatchSignatureRef = useRef("");
  const viewerReadyRef = useRef(false);
  const [viewerConnected, setViewerConnected] = useState(false);
  const [viewerStatus, setViewerStatus] = useState(enabled ? "准备产品舞台..." : "展位块已准备");

  const clearHandshakeTimers = useCallback(() => {
    if (handshakeIntervalRef.current !== null) {
      window.clearInterval(handshakeIntervalRef.current);
      handshakeIntervalRef.current = null;
    }
    if (handshakeTimeoutRef.current !== null) {
      window.clearTimeout(handshakeTimeoutRef.current);
      handshakeTimeoutRef.current = null;
    }
  }, []);

  const suspendViewer = useCallback(() => {
    clearHandshakeTimers();
    viewerReadyRef.current = false;
    setViewerConnected(false);
    const frame = iframeRef.current;
    if (frame && frame.src !== "about:blank") {
      frame.src = "about:blank";
    }
  }, [clearHandshakeTimers]);

  const postToViewer = useCallback((type: string, payload?: unknown): boolean => {
    const targetWindow = iframeRef.current?.contentWindow;
    if (!targetWindow) return false;
    targetWindow.postMessage(
      {
        source: QIHANG_WEB_SOURCE,
        type,
        payload,
      },
      "*",
    );
    return true;
  }, []);

  const startHandshake = useCallback(
    (reason: string) => {
      clearHandshakeTimers();
      viewerReadyRef.current = false;
      setViewerConnected(false);
      setViewerStatus("同步产品舞台...");

      let attempts = 0;
      const tick = () => {
        attempts += 1;
        if (attempts > 16) {
          clearHandshakeTimers();
          setViewerStatus("模型加载较慢，继续显示占位舞台。");
          return;
        }
        postToViewer(VIEWER_MESSAGE_GET_STATE, { reason, attempt: attempts });
      };

      tick();
      handshakeIntervalRef.current = window.setInterval(tick, 450);
      handshakeTimeoutRef.current = window.setTimeout(() => {
        if (!viewerReadyRef.current) {
          setViewerStatus("模型尚未返回，先保留占位舞台。");
        }
      }, 7200);
    },
    [clearHandshakeTimers, postToViewer],
  );

  // Message event listener
  useEffect(() => {
    if (!enabled || !deferredSrc) return;

    const onMessage = (event: MessageEvent) => {
      const frameWindow = iframeRef.current?.contentWindow;
      if (!frameWindow || event.source !== frameWindow || event.origin !== window.location.origin) {
        return;
      }

      const data = event.data as
        | { source?: string; type?: string; payload?: unknown }
        | undefined;
      if (!data || data.source !== QIHANG_VIEWER_SOURCE) {
        return;
      }

      if (data.type === VIEWER_MESSAGE_READY || data.type === VIEWER_MESSAGE_STATE) {
        viewerReadyRef.current = true;
        setViewerConnected(true);
        setViewerStatus("产品舞台已联动");
        clearHandshakeTimers();
        postToViewer(VIEWER_MESSAGE_SET_STATE, latestPatchRef.current);
      }
    };

    window.addEventListener("message", onMessage);
    const frame = iframeRef.current;

    return () => {
      clearHandshakeTimers();
      window.removeEventListener("message", onMessage);
      viewerReadyRef.current = false;
      if (frame) {
        frame.src = "about:blank";
      }
    };
  }, [clearHandshakeTimers, deferredSrc, enabled, postToViewer]);

  // Suspend event listener
  useEffect(() => {
    if (!enabled || !deferredSrc) return;

    const onViewerSuspend = () => {
      suspendViewer();
    };

    window.addEventListener("qihang:viewer-suspend", onViewerSuspend);
    return () => {
      window.removeEventListener("qihang:viewer-suspend", onViewerSuspend);
    };
  }, [deferredSrc, enabled, suspendViewer]);

  const onIframeLoad = useCallback(() => {
    viewerReadyRef.current = false;
    setViewerConnected(false);
    setViewerStatus("产品舞台载入中...");
    startHandshake("viewer-iframe-load");
  }, [startHandshake]);

  const sendPatch = useCallback(
    (patch: Record<string, unknown>) => {
      if (!enabled) return;

      latestPatchRef.current = patch;
      const nextSignature = JSON.stringify(patch);
      if (nextSignature === lastPatchSignatureRef.current) return;
      lastPatchSignatureRef.current = nextSignature;

      const targetWindow = iframeRef.current?.contentWindow;
      if (!targetWindow || !viewerReadyRef.current) return;

      targetWindow.postMessage(
        {
          source: QIHANG_WEB_SOURCE,
          type: VIEWER_MESSAGE_SET_STATE,
          payload: patch,
        },
        "*",
      );
    },
    [enabled],
  );

  return {
    iframeRef,
    viewerConnected,
    viewerStatus,
    onIframeLoad,
    sendPatch,
  };
}

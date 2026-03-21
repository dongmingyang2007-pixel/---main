"use client";

import { useState, useCallback } from "react";
import { useTranslations } from "next-intl";

import { apiPostFormData, isApiRequestError } from "@/lib/api";
import { useAudioRecorder } from "@/hooks/useAudioRecorder";
import type { DictationResponse } from "./chat-types";

export interface StandardVoiceControlsProps {
  conversationId: string;
  isTyping: boolean;
  disabled: boolean;
  onDictationResult: (text: string) => void;
  onError: (message: string) => void;
}

/** File extension matching the actual MIME type of the recorded blob. */
function audioExtensionForBlob(blob: Blob): string {
  const mime = blob.type.toLowerCase();
  if (mime.includes("mp4") || mime.includes("m4a")) return "recording.mp4";
  if (mime.includes("ogg")) return "recording.ogg";
  // Default to webm (Chrome, Firefox default)
  return "recording.webm";
}

export function StandardVoiceControls({
  conversationId,
  isTyping,
  disabled,
  onDictationResult,
  onError,
}: StandardVoiceControlsProps) {
  const t = useTranslations("console-chat");
  const [voiceStatus, setVoiceStatus] = useState<
    "idle" | "recording" | "sending"
  >("idle");
  const { isRecording, startRecording, stopRecording } = useAudioRecorder();

  const dictateVoiceInput = useCallback(
    async (audioBlob: Blob) => {
      setVoiceStatus("sending");

      try {
        const formData = new FormData();
        formData.append("audio", audioBlob, audioExtensionForBlob(audioBlob));

        const data = await apiPostFormData<DictationResponse>(
          `/api/v1/chat/conversations/${conversationId}/dictate`,
          formData,
        );

        const dictatedText = data.text_input.trim();
        if (!dictatedText) {
          onError(t("errors.dictationFailed"));
          return;
        }
        onDictationResult(dictatedText);
      } catch (error) {
        let content = t("errors.dictationFailed");
        if (isApiRequestError(error)) {
          if (error.code === "inference_timeout") {
            content = t("errors.inferenceTimeout");
          } else if (error.code === "model_api_unconfigured") {
            content = t("errors.modelUnconfigured");
          }
        }
        onError(content);
      } finally {
        setVoiceStatus("idle");
      }
    },
    [conversationId, onDictationResult, onError, t],
  );

  const handleMicClick = useCallback(async () => {
    if (isRecording) {
      const blob = await stopRecording();
      if (blob.size > 0) {
        await dictateVoiceInput(blob);
      } else {
        setVoiceStatus("idle");
      }
    } else {
      try {
        await startRecording();
        setVoiceStatus("recording");
      } catch {
        setVoiceStatus("idle");
        onError(t("micPermissionDenied"));
      }
    }
  }, [dictateVoiceInput, isRecording, onError, startRecording, stopRecording, t]);

  return (
    <>
      <button
        className={`chat-mic-btn ${isRecording ? "is-recording" : ""}`}
        onClick={() => void handleMicClick()}
        disabled={voiceStatus === "sending" || (isTyping && !isRecording) || disabled}
        title={isRecording ? t("voiceRecording") : t("voiceRecord")}
        type="button"
      >
        {isRecording ? (
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="6" y="6" width="12" height="12" rx="2" />
          </svg>
        ) : (
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="9" y="2" width="6" height="12" rx="3" />
            <path d="M5 10a7 7 0 0 0 14 0" />
            <line x1="12" y1="19" x2="12" y2="22" />
          </svg>
        )}
      </button>

      {voiceStatus === "recording" && (
        <div className="chat-voice-indicator">{t("voiceRecording")}</div>
      )}
      {voiceStatus === "sending" && (
        <div className="chat-voice-indicator">{t("voiceSending")}</div>
      )}
    </>
  );
}

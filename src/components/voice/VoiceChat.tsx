"use client";

import { useState, useRef, useEffect, useCallback, memo } from "react";
import { Mic, MicOff, Square, PhoneOff, Loader2 } from "lucide-react";
import { useVoiceRecorder } from "~/lib/voice";
import { playTextToSpeech, type VoiceCallState } from "~/lib/voice";

export interface VoiceMessage {
  id: string;
  role: string;
  content: string;
  ttsContent?: string;
}

export interface VoiceChatProps {
  messages: VoiceMessage[];
  onSendMessage: (content: string) => void;
  onEndCall?: () => void;
  /** Which message roles should trigger TTS playback (default: ["assistant"]) */
  assistantRoles?: string[];
}

export function VoiceChat({
  messages,
  onSendMessage,
  onEndCall,
  assistantRoles = ["assistant"],
}: VoiceChatProps) {
  const [callState, setCallState] = useState<VoiceCallState>("connected");
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoadingAudio, setIsLoadingAudio] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lastPlayedMessageId = useRef<string | null>(null);
  const isProcessingRef = useRef(false);
  const isGeneratingTTSRef = useRef(false);
  const ttsStartedAtRef = useRef<number>(0);

  const recorder = useVoiceRecorder({
    onTranscription: (text) => {
      onSendMessage(text);
    },
    onError: (msg) => {
      setError(msg);
      setTimeout(() => setError(null), 3000);
    },
  });

  const CallDuration = memo(function CallDuration() {
    const [seconds, setSeconds] = useState(0);
    useEffect(() => {
      const id = setInterval(() => setSeconds((s) => s + 1), 1000);
      return () => clearInterval(id);
    }, []);
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return (
      <span>
        {String(mins).padStart(2, "0")}:{String(secs).padStart(2, "0")}
      </span>
    );
  });

  const handleMicPress = () => {
    if (recorder.isRecording) {
      recorder.stop();
    } else if (!recorder.isProcessing) {
      if (audioRef.current && isPlayingAudio) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
        setIsPlayingAudio(false);
        setIsLoadingAudio(false);
        isGeneratingTTSRef.current = false;
      }
      void recorder.start();
    }
  };

  const handleEndCall = () => {
    recorder.cancel();
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    onEndCall?.();
  };

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const lastMessage = messages[messages.length - 1];
    if (
      lastMessage &&
      assistantRoles.includes(lastMessage.role) &&
      lastMessage.id !== lastPlayedMessageId.current &&
      !isPlayingAudio &&
      !recorder.isRecording
    ) {
      lastPlayedMessageId.current = lastMessage.id;
      const textToSpeak = lastMessage.ttsContent ?? lastMessage.content;
      void playTextToSpeech({
        text: textToSpeak,
        audioRef,
        isPlayingAudio,
        isGeneratingTTSRef,
        setCallState,
        setIsLoadingAudio,
        setIsPlayingAudio,
        setError,
        isProcessingRef,
        ttsStartedAtRef,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, isPlayingAudio, recorder.isRecording]);

  const displayState: "idle" | "recording" | "processing" | "speaking" =
    recorder.isRecording
      ? "recording"
      : recorder.isProcessing
        ? "processing"
        : isPlayingAudio
          ? "speaking"
          : "idle";

  return (
    <div className="bg-gradient-to-br from-purple-600 via-purple-500 to-purple-600 text-white p-4 relative overflow-hidden rounded-xl">
      <div className="absolute inset-0 opacity-10">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: "radial-gradient(circle at 2px 2px, white 1px, transparent 0)",
            backgroundSize: "30px 30px",
          }}
        />
      </div>

      <div className="relative z-10 space-y-3">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="w-10 h-10 rounded-full bg-white/20 backdrop-blur-md flex items-center justify-center">
              <Mic className="w-4 h-4 text-white" />
            </div>
            {displayState === "speaking" && (
              <div className="absolute inset-0 rounded-full border-2 border-white animate-pulse" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold">Voice Chat</h3>
            <div className="flex items-center gap-2 text-xs text-white/70">
              <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              <CallDuration />
            </div>
          </div>
        </div>

        {/* Status */}
        <div className="bg-white/20 backdrop-blur-md rounded-lg px-3 py-1.5 text-center text-xs">
          {error && <span className="text-red-200">⚠️ {error}</span>}

          {!error && displayState === "recording" && (
            <div className="flex items-center justify-center gap-2">
              <div className="w-2 h-2 rounded-full bg-red-400 animate-pulse" />
              <span>Recording... tap to send</span>
            </div>
          )}

          {!error && displayState === "processing" && (
            <div className="flex items-center justify-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>Transcribing...</span>
            </div>
          )}

          {!error && displayState === "speaking" && (
            <div className="flex items-center justify-center gap-2">
              {isLoadingAudio ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Thinking...</span>
                </>
              ) : (
                <>
                  <Mic className="w-3.5 h-3.5 animate-pulse" />
                  <span>AI is speaking...</span>
                </>
              )}
            </div>
          )}

          {!error && displayState === "idle" && (
            <span className="text-white/80">Tap mic to speak</span>
          )}
        </div>

        {/* Audio Visualizer (recording) */}
        {displayState === "recording" && (
          <div className="flex items-center justify-center gap-0.5 h-6">
            {Array.from({ length: 12 }).map((_, i) => (
              <div
                key={i}
                className="w-1 rounded-full bg-red-300"
                style={{
                  height: `${20 + Math.random() * 80}%`,
                  animationName: "pulse",
                  animationDuration: `${0.4 + Math.random() * 0.4}s`,
                  animationTimingFunction: "ease-in-out",
                  animationIterationCount: "infinite",
                  animationDelay: `${i * 0.04}s`,
                }}
              />
            ))}
          </div>
        )}

        {/* Controls */}
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={handleMicPress}
            disabled={recorder.isProcessing}
            className={`w-12 h-12 rounded-full flex items-center justify-center transition-all shadow-lg ${
              recorder.isRecording
                ? "bg-red-500 hover:bg-red-600 scale-110"
                : recorder.isProcessing
                  ? "bg-gray-400 cursor-not-allowed"
                  : "bg-white hover:bg-gray-100 active:scale-95"
            }`}
            title={recorder.isRecording ? "Stop recording" : "Start recording"}
          >
            {recorder.isRecording ? (
              <Square className="w-4 h-4 text-white" />
            ) : recorder.isProcessing ? (
              <Loader2 className="w-4 h-4 text-white animate-spin" />
            ) : (
              <Mic className="w-5 h-5 text-purple-600" />
            )}
          </button>

          {onEndCall && (
            <button
              onClick={handleEndCall}
              className="w-9 h-9 rounded-full bg-red-500/80 hover:bg-red-600 flex items-center justify-center transition-all"
            >
              <PhoneOff className="w-3.5 h-3.5 text-white" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

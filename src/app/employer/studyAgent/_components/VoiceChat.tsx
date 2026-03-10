"use client";

import { useState, useRef, useEffect, useCallback, memo } from "react";
import Image from "next/image";
import { Mic, MicOff, PhoneOff, MessageSquare } from "lucide-react";
import { ExpandedVoiceCall } from "./ExpandedVoiceCall";
import { useVAD } from "./utils/vad";
import { processVadAudio } from "./utils/voiceChatVad";
import { playTextToSpeech } from "./utils/voiceChatPlayback";
import type { VoiceChatProps, CallState } from "./types/VoiceChatTypes";



export function VoiceChat({ messages, onSendMessage, onEndCall, isBuddy = false, documents = [], avatarUrl }: VoiceChatProps) {
  const [showTranscript, setShowTranscript] = useState(false);
  const [callState, setCallState] = useState<CallState>("connected");
  const [isMuted, setIsMuted] = useState(false);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoadingAudio, setIsLoadingAudio] = useState(false);
  const [continuousListening, setContinuousListening] = useState(true);
  
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lastPlayedMessageId = useRef<string | null>(null);
  const isProcessingRef = useRef(false);
  const isGeneratingTTSRef = useRef(false);
  const defaultAvatar = isBuddy ? "/study-buddy-icon/women/icon1.png" : "/teacher-icon/women/icon1.png";
  const effectiveAvatar = avatarUrl ?? defaultAvatar;
  const isMutedRef = useRef(isMuted);

  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  // Get call duration
  const CallDuration = memo(function CallDuration() {
    const [seconds, setSeconds] = useState(0);
    useEffect(() => {
      const id = setInterval(() => setSeconds(s => s + 1), 1000);
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

  const ttsStartedAtRef = useRef<number>(0);
  // Interrupt TTS when user starts speaking
  const interruptTTS = useCallback(() => {
    const now = performance.now();
    if (now - ttsStartedAtRef.current < 200) {
      return;
    }

    if (audioRef.current && isPlayingAudio) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setIsPlayingAudio(false);
      setIsLoadingAudio(false);
      setCallState("listening");
      isGeneratingTTSRef.current = false;
      
      // Clear the audio queue by marking all current messages as "played"
      // This prevents queued messages from being spoken after interruption
      const lastMessage = messages[messages.length - 1];
      if (lastMessage) {
        lastPlayedMessageId.current = lastMessage.id;
      }
    }
  }, [isPlayingAudio, messages]);

  const handleProcessVadAudio = useCallback(
    (audio: Float32Array, forceProcessing?: boolean) => {
      void processVadAudio({
        audio,
        isProcessingRef,
        onSendMessage,
        setError,
        isMutedRef,
        forceProcessing,
      });
    },
    [onSendMessage]
  );
  
  // VAD
  const vad = useVAD({
    onSpeechRealStart: interruptTTS,
    onSpeechEnd: (audio: Float32Array) => {
      void handleProcessVadAudio(audio);
    },
    onError: (err: Error) => {
      setError(err.message);
      setTimeout(() => setError(null), 3000);
    },
  });


  // Handle ending the call
  const handleEndCall = () => {
    void vad.stop();
    
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    
    if (onEndCall) {
      onEndCall();
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  // Handle mute toggle
  useEffect(() => {
    if (isMuted) {
      console.log("🎤 [VoiceChat] Muted, pausing VAD");
      void vad.pause();
    } else if (continuousListening && !isPlayingAudio && !isProcessingRef.current) {
      console.log("🎤 [VoiceChat] Unmuted, starting VAD");
      void vad.resume();
    }
  }, [isMuted, continuousListening, isPlayingAudio, vad]);

  // Play AI voice responses using ElevenLabs TTS v3
  useEffect(() => {
    const lastMessage = messages[messages.length - 1];
    if (
      lastMessage && 
      (lastMessage.role === "teacher" || lastMessage.role === "buddy") && 
      lastMessage.id !== lastPlayedMessageId.current &&
      !isPlayingAudio
    ) {
      // VAD stays running so it can detect user speech for interruption
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
        continuousListening,
        vad,
        isProcessingRef,
        ttsStartedAtRef,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, isMuted, isPlayingAudio]);

  // Auto-start VAD when appropriate
  useEffect(() => {
    if (
      continuousListening &&
      !isMuted &&
      !isPlayingAudio &&
      !vad.isRunning &&
      !isProcessingRef.current &&
      messages.length > 0
    ) {
      const timer = setTimeout(() => {
        if (!isPlayingAudio && !isProcessingRef.current && continuousListening && !isMuted && !vad.isRunning) {
          void vad.start();
        }
      }, 1000);
      
      return () => clearTimeout(timer);
    }
  }, [messages.length, continuousListening, isMuted, isPlayingAudio, vad]);

  // Start listening when AI finishes speaking (if continuous listening is enabled)
  // This is handled in audio.onended callback

  const handleMicPress = () => {
    setIsMuted((prev) => {
      const next = !prev;
      if (next) {
        setContinuousListening(false);
      } else {
        setContinuousListening(true);
      }
      return next;
    });
  };

  const displayCallState = isPlayingAudio 
    ? "speaking" 
    : vad.isRecording 
    ? "listening" 
    : (callState === "speaking" ? "speaking" : callState);

  return (
    <>
      <div className="bg-gradient-to-br from-purple-600 via-purple-500 to-purple-600 text-white p-4 relative overflow-hidden">
        {/* Background pattern */}
        <div className="absolute inset-0 opacity-10">
          <div className="absolute inset-0" style={{
            backgroundImage: "radial-gradient(circle at 2px 2px, white 1px, transparent 0)",
            backgroundSize: "30px 30px"
          }} />
        </div>

        <div className="relative z-10 space-y-4">
          {/* Top Row - Avatar & Info */}
          <div className="flex items-center gap-4">
            {/* Avatar */}
            <div className="relative">
              <div className="w-16 h-16 rounded-full bg-white shadow-lg overflow-hidden relative">
                <div className={`absolute inset-0 bg-gradient-to-br ${isBuddy ? "from-blue-200 to-blue-300" : "from-purple-200 to-purple-300"}`} />
                <Image
                  src={effectiveAvatar}
                  alt={isBuddy ? "AI Study Buddy avatar" : "AI Teacher avatar"}
                  className="relative z-10 w-full h-full object-cover"
                  width={64}
                  height={64}
                  onError={(e) => { e.currentTarget.src = defaultAvatar; }}
                />
              </div>
              
              {/* Animated ring when speaking */}
              {displayCallState === "speaking" && (
                <div className="absolute inset-0 rounded-full border-2 border-white animate-pulse" />
              )}
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <h3 className="text-lg">{isBuddy ? "AI Study Buddy" : "AI Teacher"}</h3>
              <div className="flex items-center gap-2 text-sm text-white/80">
                <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                <CallDuration />
              </div>
            </div>

            {/* Transcript Button */}
            <button
              onClick={() => setShowTranscript(true)}
              className="w-10 h-10 rounded-full bg-white/20 hover:bg-white/30 backdrop-blur-md flex items-center justify-center transition-all relative"
              title={`${messages.length} messages`}
            >
              <MessageSquare className="w-4 h-4 text-white" />
              {messages.length > 0 && (
                <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
                  {messages.length}
                </span>
              )}
            </button>
          </div>

          {/* Status Indicator */}
          <div className="bg-white/20 backdrop-blur-md rounded-lg px-4 py-2 text-center text-sm">
            {error && (
              <div className="flex items-center justify-center gap-2 text-red-200">
                <span>⚠️ {error}</span>
              </div>
            )}

            {!error && displayCallState === "listening" && !isMuted && (
              <div className="flex items-center justify-center gap-2">
                <Mic className="w-4 h-4 animate-pulse" />
                <span>Listening...</span>
              </div>
            )}
            
            {!error && displayCallState === "speaking" && (
              <div className="flex items-center justify-center gap-2">
                {isLoadingAudio ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Thinking...</span>
                  </>
                ) : (
                  <>
                    <Mic className="w-4 h-4 animate-pulse" />
                    <span>{isBuddy ? "Buddy" : "Teacher"} is speaking...</span>
                  </>
                )}
              </div>  
            )}

            {isMuted && displayCallState !== "speaking" && (
              <div className="flex items-center justify-center gap-2">
                <MicOff className="w-4 h-4 animate-pulse" />
                <span>Muted</span>
              </div>
            )}

            {!error && displayCallState === "connected" && !vad.isRecording && !isMuted && (
              <span className="text-white/90">
                {vad.isRunning 
                  ? "Ready to listen... (speak naturally)" 
                  : "Click mic to start"}
              </span>
            )}
          </div>

          {/* Mini Audio Visualizer */}
          {(displayCallState === "listening" && !isMuted || displayCallState === "speaking") && (
            <div className="flex items-center justify-center gap-0.5 h-8">
              {Array.from({ length: 15 }).map((_, i) => (
                <div
                  key={i}
                  className={`w-1 rounded-full ${
                    displayCallState === "listening" ? "bg-blue-300" : "bg-white"
                  }`}
                  style={{
                    height: `${Math.random() * 100}%`,
                    animationName: "pulse",
                    animationDuration: `${0.5 + Math.random() * 0.5}s`,
                    animationTimingFunction: "ease-in-out",
                    animationIterationCount: "infinite",
                    animationDelay: `${i * 0.05}s`,
                  }}
                />
              ))}
            </div>
          )}

          {/* Controls */}
          <div className="flex items-center justify-center gap-3">
            {/* Microphone (mute/unmute) */}
            <button
              onClick={handleMicPress}
              className={`w-14 h-14 rounded-full flex items-center justify-center transition-all shadow-lg ${
                isMuted
                  ? "bg-gray-400 hover:bg-gray-500"
                  : vad.isRecording
                  ? "bg-blue-500 hover:bg-blue-600 scale-110"
                  : vad.isRunning
                  ? "bg-green-500 hover:bg-green-600"
                  : "bg-white hover:bg-gray-100 active:scale-95"
              }`}
              title={isMuted ? "Unmute microphone" : "Mute microphone"}
            >
              {isMuted ? (
                <MicOff className="w-5 h-5 text-white" />
              ) : (
                <Mic className={`w-5 h-5 ${isMuted ? "text-gray-600" : vad.isRunning ? "text-white" : "text-purple-600"}`} />
              )}
            </button>

            {/* End Call */}
            <button
              onClick={() => {
                if (confirm("End your tutoring session?")) {
                  handleEndCall();
                }
              }}
              className="w-10 h-10 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center transition-all"
            >
              <PhoneOff className="w-4 h-4 text-white" />
            </button>
          </div>
        </div>
      </div>

      {/* Transcript Modal */}
      {showTranscript && (
        <ExpandedVoiceCall 
          messages={messages}
          isBuddy={isBuddy}
          documents={documents}
          onClose={() => setShowTranscript(false)}
        />
      )}
    </>
  );
}
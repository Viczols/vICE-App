import { useEffect, useMemo, useRef, useState } from "react";
import { LocalAudioTrack, LocalVideoTrack, Room, RoomEvent, Track } from "livekit-client";
import type {
  LocalTrackPublication,
  RemoteTrack,
  RemoteTrackPublication,
} from "livekit-client";
import {
  Mic,
  MicOff,
  Headphones,
  HeadphoneOff,
  Video,
  VideoOff,
  MonitorUp,
  PhoneOff,
  Radio,
} from "lucide-react";
import type { Channel, VoicePresenceItem } from "../layout/MainLayout";
import ScreenShareQualityModal from "./ScreenShareQualityModal";
import { RnnoiseWorkletNode, loadRnnoise } from "@sapphi-red/web-noise-suppressor";
import rnnoiseWorkletPath from "@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url";
import rnnoiseWasmPath from "@sapphi-red/web-noise-suppressor/rnnoise.wasm?url";
import rnnoiseSimdWasmPath from "@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url";
import { playViceSound as playSound, getServerNotificationSettings } from "../utils/soundManager";

type VoicePanelMode = "server" | "dm";

type VoicePanelProps = {
  mode?: VoicePanelMode;

  selectedChannel?: Channel | null;
  activeVoiceChannelId: string | null;
  setActiveVoiceChannelId: (value: string | null) => void;

  setVoiceParticipants: React.Dispatch<React.SetStateAction<string[]>>;
  voicePresenceMap: Record<string, VoicePresenceItem[]>;
  setVoicePresenceMap?: React.Dispatch<
    React.SetStateAction<Record<string, VoicePresenceItem[]>>
  >;

  isConnected: boolean;
  setIsConnected: (value: boolean) => void;
  isMuted: boolean;
  setIsMuted: (value: boolean) => void;
  isDeafened: boolean;
  setIsDeafened: (value: boolean) => void;

  isMobile?: boolean;

  dmActive?: boolean;
  dmShouldConnect?: boolean;
  dmRoomName?: string | null;
  dmChannelId?: string | null;
  dmDisplayName?: string | null;
  dmStatus?: "idle" | "incoming" | "outgoing" | "active" | "left";
  dmSelfLeft?: boolean;
  onDmLeave?: () => void | Promise<void>;
};

type RemoteVisualEntry = {
  participantId: string;
  participantName: string;
  trackSid: string;
  mediaStream: MediaStream;
  source: "camera" | "screen";
};

type IdentityMap = Record<
  string,
  {
    displayName?: string;
    username?: string;
    avatarUrl?: string | null;
  }
>;

type StreamAnnouncement = {
  trackSid: string;
  participantId: string;
  participantName: string;
  source: "camera" | "screen";
  previewDataUrl?: string | null;
  previewUpdatedAt?: number | null;
};

type ScreenShareResolution = "720p" | "1080p";
type ScreenShareFps = 30 | 60;

type VoiceAudioSettings = {
  rnnoiseEnabled: boolean;
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
  inputSensitivityMode: "auto" | "manual";
  inputThreshold: number;
  micGain: number;
  outputVolume: number;
  inputDeviceId: string;
  outputDeviceId: string;
};

type PendingVoiceConnect = {
  targetRoomName: string;
  channelIdForJoin: string;
};


const STREAM_EVENT_NAME = "vice-voice-visuals-updated";
const STREAM_SNAPSHOT_KEY = "__vice_voice_visuals_snapshot__";
const STREAM_ANNOUNCEMENT_EVENT_NAME = "vice-voice-stream-announcements-updated";
const STREAM_ANNOUNCEMENT_CLEAR_EVENT_NAME =
  "vice-voice-stream-announcements-cleared";
const STREAM_ANNOUNCEMENT_UPSTREAM_EVENT_NAME =
  "vice-voice-stream-announcements-local-state";
const STREAM_ANNOUNCEMENT_SNAPSHOT_KEY = "__vice_voice_stream_announcements__";
const REQUEST_VISUAL_RECONCILE_EVENT_NAME =
  "vice-request-voice-visual-reconcile";
const USER_IDENTITY_EVENT_NAME = "vice-user-identity-map-updated";
const DM_MEDIA_CONTROL_EVENT_NAME = "vice-dm-media-control";
const DM_MEDIA_STATE_EVENT_NAME = "vice-dm-media-state";
const SCREEN_PREVIEW_REFRESH_INTERVAL_MS = 120_000;
const FORCE_SERVER_VOICE_LEFT_EVENT_NAME = "vice-force-server-voice-left";

export default function VoicePanel({
  mode = "server",
  selectedChannel,
  activeVoiceChannelId,
  setActiveVoiceChannelId,
  setVoiceParticipants,
  voicePresenceMap,
  setVoicePresenceMap,
  isConnected,
  setIsConnected,
  isMuted,
  setIsMuted,
  isDeafened,
  setIsDeafened,
  dmActive = false,
  dmShouldConnect = false,
  dmRoomName = null,
  dmChannelId = null,
  dmDisplayName = null,
  dmStatus = "idle",
  dmSelfLeft = false,
  onDmLeave,
}: VoicePanelProps) {
  const [status, setStatus] = useState(
    mode === "dm" ? "DM görüşmesi bekleniyor..." : "Bir ses kanalına çift tıkla"
  );
  const [currentRoomName, setCurrentRoomName] = useState<string | null>(null);
  const [localIdentity, setLocalIdentity] = useState<string | null>(null);
  const [localDisplayName, setLocalDisplayName] = useState<string | null>(null);
  const [isCameraEnabled, setIsCameraEnabled] = useState(false);
  const [isScreenShareEnabled, setIsScreenShareEnabled] = useState(false);
  const [remoteVisuals, setRemoteVisuals] = useState<RemoteVisualEntry[]>([]);
  const [identityMap, setIdentityMap] = useState<IdentityMap>({});
  const [showScreenShareModal, setShowScreenShareModal] = useState(false);
  const [isStartingScreenShare, setIsStartingScreenShare] = useState(false);
  const [screenShareResolution, setScreenShareResolution] =
    useState<ScreenShareResolution>("1080p");
  const [screenShareFps, setScreenShareFps] = useState<ScreenShareFps>(30);
  const [screenShareSystemAudioEnabled, setScreenShareSystemAudioEnabled] =
    useState(true);

  const [micLevel, setMicLevel] = useState(0);
  const [voiceAudioSettings, setVoiceAudioSettings] = useState<VoiceAudioSettings>({
    rnnoiseEnabled: true,
    echoCancellation: true,
    noiseSuppression: false,
    autoGainControl: false,
    inputSensitivityMode: "auto",
    inputThreshold: 0.007,
    micGain: 1,
    outputVolume: 1,
    inputDeviceId: "",
    outputDeviceId: "",
  });
  const [selfMuted, setSelfMuted] = useState(false);
  const [selfDeafened, setSelfDeafened] = useState(false);

  const roomRef = useRef<Room | null>(null);
  const remoteVisualsRef = useRef<RemoteVisualEntry[]>([]);
  const previewCaptureIntervalRef = useRef<number | null>(null);
  const audioElementsRef = useRef<HTMLMediaElement[]>([]);
  const remoteMediaStreamCacheRef = useRef<
    Map<string, { mediaTrack: MediaStreamTrack; stream: MediaStream }>
  >(new Map());
  const localMediaStreamCacheRef = useRef<
    Map<string, { trackSid: string; mediaTrack: MediaStreamTrack; stream: MediaStream }>
  >(new Map());
  const cameraRefreshTimerRef = useRef<number | null>(null);
  const announcementVersionRef = useRef(0);
  const joinedVoiceKeyRef = useRef<string | null>(null);
  const joinInFlightRef = useRef(false);
  const disconnectingRef = useRef(false);
  const connectedModeRef = useRef<VoicePanelMode | null>(null);
  const connectedServerChannelIdRef = useRef<string | null>(null);
  const lastDmShouldConnectRef = useRef(false);
  const unmountingRef = useRef(false);
  const localScreenShareTrackRef = useRef<LocalVideoTrack | null>(null);
  const localScreenShareAudioTrackRef = useRef<LocalAudioTrack | null>(null);
  const localScreenShareAudioPublicationSidRef = useRef<string | null>(null);
  const localScreenShareAnnouncementTrackSidRef = useRef<string | null>(null);
  const localCameraAnnouncementTrackSidRef = useRef<string | null>(null);
  const localScreenShareEndedHandlerRef = useRef<(() => void) | null>(null);
  const isStoppingScreenShareRef = useRef(false);
  const localScreenShareSessionRef = useRef(0);
  const preserveCameraUiUntilRef = useRef(0);
  const preserveScreenUiUntilRef = useRef(0);
  const localCameraSuppressedRef = useRef(false);
  const selfMutedRef = useRef(false);
  const selfDeafenedRef = useRef(false);
  const serverMutedRef = useRef(false);
  const serverDeafenedRef = useRef(false);
  const preDeafenSelfMutedRef = useRef(false);
  const missingServerPresenceTimerRef = useRef<number | null>(null);
  const hadServerPresenceRef = useRef(false);

  const pendingVoiceConnectRef = useRef<PendingVoiceConnect | null>(null);
  const activeConnectSessionRef = useRef(0);

  const micAudioContextRef = useRef<AudioContext | null>(null);
  const micSourceStreamRef = useRef<MediaStream | null>(null);
  const micMeterIntervalRef = useRef<number | null>(null);
  const micAnalyserRef = useRef<AnalyserNode | null>(null);
  const micGateGainRef = useRef<GainNode | null>(null);
  const micInputGainRef = useRef<GainNode | null>(null);
  const micMudEqRef = useRef<BiquadFilterNode | null>(null);
  const micWarmthEqRef = useRef<BiquadFilterNode | null>(null);
  const micPresenceEqRef = useRef<BiquadFilterNode | null>(null);
  const micHarshCutEqRef = useRef<BiquadFilterNode | null>(null);
  const micCompressorRef = useRef<DynamicsCompressorNode | null>(null);
  const micPostGainRef = useRef<GainNode | null>(null);
  const rnnoiseNodeRef = useRef<RnnoiseWorkletNode | null>(null);
  const rnnoiseModuleLoadedRef = useRef(false);
  const localMicTrackRef = useRef<LocalAudioTrack | null>(null);
  const localMicPublicationRef = useRef<LocalTrackPublication | null>(null);
  const appliedInputDeviceIdRef = useRef<string>("");
  const appliedOutputDeviceIdRef = useRef<string>("");

  const SERVER_VOICE_CHANNEL_STORAGE_KEY = "vice_active_server_voice_channel_id";
  const SERVER_VOICE_SERVER_STORAGE_KEY = "vice_active_server_voice_server_id";
  const SCREEN_SHARE_QUALITY_STORAGE_KEY = "vice_screen_share_quality_v1";
  const VOICE_AUDIO_SETTINGS_STORAGE_KEY = "vice_voice_audio_settings_v1";

  const getAuthToken = () => localStorage.getItem("token");

  const getStoredUser = () => {
    try {
      const raw = localStorage.getItem("auth_user");
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  };

  const getStoredUserId = () => String(getStoredUser()?.id ?? "");

  const getServerNotificationScopeId = () => {
    if (selectedChannel?.serverId) return String(selectedChannel.serverId);
    const fallbackChannel = selectedChannel && mode === "server" ? selectedChannel : null;
    if (fallbackChannel?.serverId) return String(fallbackChannel.serverId);
    return null;
  };

  const playServerVoiceNotification = async (
    sound: "voice-join" | "voice-leave" | "screen-share-start" | "screen-share-stop"
  ) => {
    if (mode !== "server") return;

    const serverId = getServerNotificationScopeId();
    if (!serverId) return;

    const settings = getServerNotificationSettings(serverId);
    const volume = Number(settings?.message?.volume ?? 1);
    if (!Number.isFinite(volume) || volume <= 0) return;

    try {
      await playSound(sound, volume);
    } catch {}
  };

  const applyOutputDeviceToElement = async (
    element: HTMLMediaElement,
    outputDeviceId: string
  ) => {
    const targetDeviceId = String(outputDeviceId || "").trim();
    const sinkSetter = (element as any)?.setSinkId;
    if (!sinkSetter || !targetDeviceId) return;

    try {
      const currentSinkId = String((element as any).sinkId || "");
      if (currentSinkId === targetDeviceId) return;
      await sinkSetter.call(element, targetDeviceId);
    } catch (error) {
      console.error("audio output device apply error:", error);
    }
  };

  const applyOutputDeviceToAllAudioElements = async (outputDeviceId: string) => {
    await Promise.all(
      audioElementsRef.current.map((element) =>
        applyOutputDeviceToElement(element, outputDeviceId)
      )
    );
  };

  const setRemoteAudioMuted = (muted: boolean) => {
    audioElementsRef.current.forEach((element) => {
      element.muted = muted;
      if (!muted) {
        element.volume = voiceAudioSettings.outputVolume;
      }
    });
  };

  const applyEffectiveVoiceState = async (next: {
    selfMuted: boolean;
    selfDeafened: boolean;
    serverMuted: boolean;
    serverDeafened: boolean;
  }) => {
    const effectiveDeafened = next.selfDeafened || next.serverDeafened;
    const effectiveMuted =
      effectiveDeafened || next.selfMuted || next.serverMuted;

    await setProcessedMicrophoneEnabled(!effectiveMuted);
    setRemoteAudioMuted(effectiveDeafened);
    setIsMuted(effectiveMuted);
    setIsDeafened(effectiveDeafened);
  };

  const syncVoiceStateToBackend = async (muted: boolean, deafened: boolean) => {
    if (mode !== "server") return;

    const authToken = getAuthToken();
    const room = roomRef.current;
    if (!authToken || !room) return;

    try {
      const response = await fetch("http://localhost:3001/voice/state", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          muted,
          deafened,
        }),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        console.error("voice state sync error:", text || response.status);
      }
    } catch (error) {
      console.error("voice state sync error:", error);
    }
  };


  const readVoiceAudioSettings = (): VoiceAudioSettings => {
    const defaults: VoiceAudioSettings = {
      rnnoiseEnabled: true,
      echoCancellation: true,
      noiseSuppression: false,
      autoGainControl: false,
      inputSensitivityMode: "auto",
      inputThreshold: 0.007,
      micGain: 1,
      outputVolume: 1,
      inputDeviceId: "",
      outputDeviceId: "",
    };

    try {
      const raw = localStorage.getItem(VOICE_AUDIO_SETTINGS_STORAGE_KEY);
      if (!raw) return defaults;
      const parsed = JSON.parse(raw) || {};
      return {
        rnnoiseEnabled:
          typeof parsed.rnnoiseEnabled === "boolean"
            ? parsed.rnnoiseEnabled
            : defaults.rnnoiseEnabled,
        echoCancellation:
          typeof parsed.echoCancellation === "boolean"
            ? parsed.echoCancellation
            : defaults.echoCancellation,
        noiseSuppression:
          typeof parsed.noiseSuppression === "boolean"
            ? parsed.noiseSuppression
            : defaults.noiseSuppression,
        autoGainControl:
          typeof parsed.autoGainControl === "boolean"
            ? parsed.autoGainControl
            : defaults.autoGainControl,
        inputSensitivityMode:
          parsed.inputSensitivityMode === "manual" ? "manual" : "auto",
        inputThreshold:
          typeof parsed.inputThreshold === "number"
            ? Math.min(0.012, Math.max(0.002, parsed.inputThreshold))
            : defaults.inputThreshold,
        micGain:
          typeof parsed.micGain === "number"
            ? Math.min(3, Math.max(0.4, parsed.micGain))
            : defaults.micGain,
        outputVolume:
          typeof parsed.outputVolume === "number"
            ? Math.min(1, Math.max(0, parsed.outputVolume))
            : defaults.outputVolume,
        inputDeviceId:
          typeof parsed.inputDeviceId === "string"
            ? parsed.inputDeviceId
            : defaults.inputDeviceId,
        outputDeviceId:
          typeof parsed.outputDeviceId === "string"
            ? parsed.outputDeviceId
            : defaults.outputDeviceId,
      };
    } catch {
      return defaults;
    }
  };

  const clearMicMeterLoop = () => {
    if (micMeterIntervalRef.current) {
      window.clearInterval(micMeterIntervalRef.current);
      micMeterIntervalRef.current = null;
    }
  };

  const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

  const amplitudeToDb = (value: number) => {
    const safe = Math.max(value, 0.000001);
    return 20 * Math.log10(safe);
  };

  const thresholdLinearToDb = (threshold: number) => {
    const minThreshold = 0.002;
    const maxThreshold = 0.012;
    const normalized =
      (Math.min(maxThreshold, Math.max(minThreshold, threshold)) - minThreshold) /
      (maxThreshold - minThreshold);

    const curved = Math.pow(normalized, 1.18);
    return -62 + curved * 34;
  };

  const cleanupLocalMicProcessing = async (keepLevel = false) => {
    clearMicMeterLoop();

    try {
      const publication = localMicPublicationRef.current;
      if (publication?.track) {
        try {
          await roomRef.current?.localParticipant.unpublishTrack(
            publication.track as any,
            true as any
          );
        } catch {
          try {
            await roomRef.current?.localParticipant.unpublishTrack(
              publication.track as any
            );
          } catch {}
        }
      }
    } catch {}

    localMicPublicationRef.current = null;

    try {
      await localMicTrackRef.current?.stop();
    } catch {}
    localMicTrackRef.current = null;

    try {
      micSourceStreamRef.current?.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {}
      });
    } catch {}
    micSourceStreamRef.current = null;

    try {
      rnnoiseNodeRef.current?.disconnect();
    } catch {}
    rnnoiseNodeRef.current = null;
    rnnoiseModuleLoadedRef.current = false;

    try {
      await micAudioContextRef.current?.close();
    } catch {}
    micAudioContextRef.current = null;
    micAnalyserRef.current = null;
    micGateGainRef.current = null;
    micInputGainRef.current = null;
    micMudEqRef.current = null;
    micWarmthEqRef.current = null;
    micPresenceEqRef.current = null;
    micHarshCutEqRef.current = null;
    micCompressorRef.current = null;
    micPostGainRef.current = null;

    if (!keepLevel) {
      setMicLevel(0);
    }
  };

  const updateMicGateThreshold = () => {
    const gateGain = micGateGainRef.current;
    const analyser = micAnalyserRef.current;
    if (!gateGain || !analyser) return;

    const dataArray = new Uint8Array(analyser.fftSize);
    const settings = voiceAudioSettings;

    clearMicMeterLoop();

    let gateOpen = false;
    let lastVoiceAt = performance.now();
    let smoothedRms = 0;
    let smoothedPeak = 0;
    let openFrameCount = 0;

    micMeterIntervalRef.current = window.setInterval(() => {
      analyser.getByteTimeDomainData(dataArray);

      let sum = 0;
      let peak = 0;
      for (let i = 0; i < dataArray.length; i += 1) {
        const centered = Math.abs((dataArray[i] - 128) / 128);
        sum += centered * centered;
        if (centered > peak) peak = centered;
      }

      const rms = Math.sqrt(sum / dataArray.length);
      smoothedRms = smoothedRms === 0 ? rms : smoothedRms * 0.82 + rms * 0.18;
      smoothedPeak = smoothedPeak === 0 ? peak : smoothedPeak * 0.68 + peak * 0.32;
      setMicLevel(smoothedRms);

      const rmsDb = amplitudeToDb(smoothedRms);
      const peakDb = amplitudeToDb(smoothedPeak);

      const openThresholdDb =
        settings.inputSensitivityMode === "manual"
          ? thresholdLinearToDb(settings.inputThreshold)
          : settings.rnnoiseEnabled
          ? -48
          : -43;

      const thresholdTightness =
        settings.inputSensitivityMode === "manual"
          ? Math.min(
              1,
              Math.max(0, (settings.inputThreshold - 0.002) / (0.012 - 0.002))
            )
          : settings.rnnoiseEnabled
          ? 0.45
          : 0.62;

      const closeThresholdDb = openThresholdDb - (4.8 - thresholdTightness * 1.1);
      const peakOpenThresholdDb = openThresholdDb + (4.2 + thresholdTightness * 1.4);
      const peakKeepAliveThresholdDb =
        closeThresholdDb + (2.1 + thresholdTightness * 0.9);
      const nowPerf = performance.now();

      const looksLikeVoice =
        rmsDb >= openThresholdDb || peakDb >= peakOpenThresholdDb;
      const keepAlive =
        rmsDb >= closeThresholdDb || peakDb >= peakKeepAliveThresholdDb;

      if (looksLikeVoice) {
        openFrameCount = Math.min(openFrameCount + 1, 6);
      } else {
        openFrameCount = Math.max(openFrameCount - 1, 0);
      }

      if (!gateOpen && (openFrameCount >= 1 || peakDb >= peakOpenThresholdDb + 1.2)) {
        gateOpen = true;
        lastVoiceAt = nowPerf;
      }

      if (gateOpen && keepAlive) {
        lastVoiceAt = nowPerf;
      }

      const holdMs = 220 - thresholdTightness * 45;
      if (gateOpen && !keepAlive && nowPerf - lastVoiceAt > holdMs) {
        gateOpen = false;
        openFrameCount = 0;
      }

      const closedDbFloor = settings.rnnoiseEnabled ? -23.5 : -21.5;
      const targetGain = gateOpen ? 1 : clamp01(Math.pow(10, closedDbFloor / 20));
      const audioNow = analyser.context.currentTime;

      gateGain.gain.cancelScheduledValues(audioNow);
      gateGain.gain.setValueAtTime(gateGain.gain.value, audioNow);
      gateGain.gain.linearRampToValueAtTime(
        targetGain,
        audioNow + (gateOpen ? 0.015 : 0.075)
      );
    }, 35);
  };

  const ensureRnnoiseWorkletNode = async (
    audioContext: AudioContext,
    inputNode: AudioNode,
    outputNode: AudioNode
  ) => {
    if (!voiceAudioSettings.rnnoiseEnabled) {
      inputNode.connect(outputNode);
      return null;
    }

    if (!rnnoiseModuleLoadedRef.current) {
      await audioContext.audioWorklet.addModule(rnnoiseWorkletPath);
      rnnoiseModuleLoadedRef.current = true;
    }

    const wasmBinary = await loadRnnoise({
      url: rnnoiseWasmPath,
      simdUrl: rnnoiseSimdWasmPath,
    });

    const rnnoiseNode = new RnnoiseWorkletNode(audioContext, {
      wasmBinary,
      maxChannels: 1,
    });

    rnnoiseNodeRef.current = rnnoiseNode;
    inputNode.connect(rnnoiseNode);
    rnnoiseNode.connect(outputNode);
    return rnnoiseNode;
  };

  const createProcessedLocalMicTrack = async () => {
    const settings = readVoiceAudioSettings();
    setVoiceAudioSettings(settings);

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: 48000,
        sampleSize: 16,
        
        deviceId: settings.inputDeviceId
          ? { exact: settings.inputDeviceId }
          : undefined,
        echoCancellation: settings.echoCancellation,
        noiseSuppression: settings.rnnoiseEnabled ? false : settings.noiseSuppression,
        autoGainControl: settings.autoGainControl,
      },
      video: false,
    });

    const inputTrack = stream.getAudioTracks()[0];
    if (!inputTrack) {
      throw new Error("Mikrofon track alınamadı.");
    }

    appliedInputDeviceIdRef.current =
      settings.inputDeviceId || inputTrack.getSettings?.().deviceId || "";

    const AudioCtx =
      window.AudioContext || (window as any).webkitAudioContext;
    const audioContext = new AudioCtx({
      latencyHint: "interactive",
      sampleRate: 48000,
    });

    const source = audioContext.createMediaStreamSource(stream);
    const highPass = audioContext.createBiquadFilter();
    highPass.type = "highpass";
    highPass.frequency.value = settings.rnnoiseEnabled ? 92 : 110;
    highPass.Q.value = 0.72;

    const lowPass = audioContext.createBiquadFilter();
    lowPass.type = "lowpass";
    lowPass.frequency.value = settings.rnnoiseEnabled ? 13500 : 11000;
    lowPass.Q.value = 0.7;

    const mudCut = audioContext.createBiquadFilter();
    mudCut.type = "peaking";
    mudCut.frequency.value = 235;
    mudCut.Q.value = 0.9;
    mudCut.gain.value = -1.2;
    micMudEqRef.current = mudCut;

    const warmthEq = audioContext.createBiquadFilter();
    warmthEq.type = "lowshelf";
    warmthEq.frequency.value = 160;
    warmthEq.gain.value = settings.rnnoiseEnabled ? 1.0 : 0.65;
    micWarmthEqRef.current = warmthEq;

    const presenceBoost = audioContext.createBiquadFilter();
    presenceBoost.type = "peaking";
    presenceBoost.frequency.value = settings.rnnoiseEnabled ? 3000 : 2850;
    presenceBoost.Q.value = 0.8;
    presenceBoost.gain.value = settings.rnnoiseEnabled ? 1.35 : 1.0;
    micPresenceEqRef.current = presenceBoost;

    const harshCut = audioContext.createBiquadFilter();
    harshCut.type = "peaking";
    harshCut.frequency.value = settings.rnnoiseEnabled ? 5100 : 4600;
    harshCut.Q.value = 1.2;
    harshCut.gain.value = settings.rnnoiseEnabled ? -1.1 : -0.75;
    micHarshCutEqRef.current = harshCut;

    const gainNode = audioContext.createGain();
    gainNode.gain.value = Math.min(2.2, Math.max(0.5, settings.micGain * 1.08));
    micInputGainRef.current = gainNode;

    const compressor = audioContext.createDynamicsCompressor();
    compressor.threshold.value = -24;
    compressor.knee.value = 18;
    compressor.ratio.value = 2.6;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.18;
    micCompressorRef.current = compressor;

    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.84;

    const softGateGain = audioContext.createGain();
    softGateGain.gain.value = 0.08;

    const postGain = audioContext.createGain();
    postGain.gain.value = settings.rnnoiseEnabled ? 1.08 : 1.04;
    micPostGainRef.current = postGain;

    const splitter = audioContext.createChannelSplitter(1);
    const merger = audioContext.createChannelMerger(2);
    const destination = audioContext.createMediaStreamDestination();

    source.connect(highPass);

    let rnnoiseEnabledInPipeline = false;
    try {
      if (settings.rnnoiseEnabled) {
        await ensureRnnoiseWorkletNode(audioContext, highPass, lowPass);
        rnnoiseEnabledInPipeline = true;
      } else {
        highPass.connect(lowPass);
      }
    } catch (error) {
      console.error("rnnoise init error:", error);
      highPass.connect(lowPass);
    }

    lowPass.connect(mudCut);
    mudCut.connect(warmthEq);
    warmthEq.connect(presenceBoost);
    presenceBoost.connect(harshCut);
    harshCut.connect(gainNode);
    gainNode.connect(compressor);
    compressor.connect(analyser);
    compressor.connect(softGateGain);
    softGateGain.connect(postGain);
    postGain.connect(splitter);
    splitter.connect(merger, 0, 0);
    splitter.connect(merger, 0, 1);
    merger.connect(destination);

    const processedTrack = destination.stream.getAudioTracks()[0];
    if (!processedTrack) {
      throw new Error("İşlenmiş mikrofon track üretilemedi.");
    }

    micAudioContextRef.current = audioContext;
    micSourceStreamRef.current = stream;
    micAnalyserRef.current = analyser;
    micGateGainRef.current = softGateGain;

    const gateNow = audioContext.currentTime;
    softGateGain.gain.cancelScheduledValues(gateNow);
    softGateGain.gain.setValueAtTime(0.08, gateNow);
    softGateGain.gain.linearRampToValueAtTime(1, gateNow + 0.12);

    if (!rnnoiseEnabledInPipeline) {
      rnnoiseNodeRef.current = null;
    }

    updateMicGateThreshold();

    return new LocalAudioTrack(processedTrack, undefined, true);
  };

  const ensureProcessedMicrophone = async (room: Room) => {
    if (localMicTrackRef.current) {
      return localMicTrackRef.current;
    }

    const track = await createProcessedLocalMicTrack();
    localMicTrackRef.current = track;

    const publication = await room.localParticipant.publishTrack(track, {
      source: Track.Source.Microphone,
      stopMicTrackOnMute: false,
      audioEncoding: {
        maxBitrate: 128000,
      },
    } as any);

    localMicPublicationRef.current = publication as LocalTrackPublication;
    return track;
  };

  const setProcessedMicrophoneEnabled = async (enabled: boolean) => {
    const room = roomRef.current;
    if (!room) return;

    const track = await ensureProcessedMicrophone(room);

    if (enabled) {
      try {
        await track.unmute();
      } catch {}
      setMicLevel((prev) => prev);
      updateMicGateThreshold();
      return;
    }

    clearMicMeterLoop();
    setMicLevel(0);
    try {
      await track.mute();
    } catch {}
  };

  const getScreenShareProfile = (
    resolution: ScreenShareResolution,
    fps: ScreenShareFps
  ) => {
    const width = resolution === "1080p" ? 1920 : 1280;
    const height = resolution === "1080p" ? 1080 : 720;

    let maxBitrate = 3_000_000;
    if (resolution === "720p" && fps === 60) maxBitrate = 4_500_000;
    if (resolution === "1080p" && fps === 30) maxBitrate = 5_500_000;
    if (resolution === "1080p" && fps === 60) maxBitrate = 8_000_000;

    return {
      width,
      height,
      fps,
      maxBitrate,
      label: `${resolution}/${fps} FPS`,
    };
  };

  const saveScreenShareQualityPreference = (
    resolution: ScreenShareResolution,
    fps: ScreenShareFps,
    shareSystemAudio: boolean
  ) => {
    try {
      localStorage.setItem(
        SCREEN_SHARE_QUALITY_STORAGE_KEY,
        JSON.stringify({ resolution, fps, shareSystemAudio })
      );
    } catch {}
  };

  const getJoinChannelId = () => {
    if (mode === "dm") return dmChannelId || dmRoomName || null;
    return activeVoiceChannelId;
  };

  const isTrackPublicationLive = (publication: any) => {
    const mediaTrack = publication?.track?.mediaStreamTrack;
    if (!mediaTrack || mediaTrack.readyState !== "live") return false;
    if (publication?.isMuted) return false;
    if ((publication?.track as any)?.isMuted) return false;
    if (typeof mediaTrack.enabled === "boolean" && !mediaTrack.enabled) return false;
    return true;
  };

  const getLocalCameraPublication = () => {
    const room = roomRef.current;
    if (!room) return null;

    for (const pub of room.localParticipant.trackPublications.values()) {
      if (
        pub.kind === Track.Kind.Video &&
        pub.source === Track.Source.Camera &&
        isTrackPublicationLive(pub)
      ) {
        return pub;
      }
    }

    return null;
  };

  const getStableLocalMediaStream = (
    key: string,
    trackSid: string,
    mediaTrack: MediaStreamTrack
  ) => {
    const cached = localMediaStreamCacheRef.current.get(key);

    if (
      cached &&
      cached.trackSid === trackSid &&
      cached.mediaTrack === mediaTrack &&
      cached.mediaTrack.readyState === "live"
    ) {
      return cached.stream;
    }

    const stream = new MediaStream([mediaTrack]);
    localMediaStreamCacheRef.current.set(key, {
      trackSid,
      mediaTrack,
      stream,
    });

    return stream;
  };

  const clearLocalMediaStreamCache = (key?: "camera" | "screen") => {
    if (key) {
      localMediaStreamCacheRef.current.delete(key);
      return;
    }

    localMediaStreamCacheRef.current.clear();
  };

  const getCachedLocalMediaStream = (key: "camera" | "screen") => {
    const cached = localMediaStreamCacheRef.current.get(key);
    if (!cached) return null;
    if (cached.mediaTrack?.readyState === "live") {
      return cached.stream;
    }
    localMediaStreamCacheRef.current.delete(key);
    return null;
  };

  const getLocalCameraMediaStream = () => {
    if (localCameraSuppressedRef.current) {
      clearLocalMediaStreamCache("camera");
      return null;
    }

    const publication = getLocalCameraPublication();
    const mediaTrack = publication?.track?.mediaStreamTrack;
    const trackSid =
      publication?.trackSid ||
      publication?.track?.sid ||
      localCameraAnnouncementTrackSidRef.current ||
      (localIdentity ? `local-camera:${localIdentity}` : "local-camera");

    if (!mediaTrack || mediaTrack.readyState !== "live") {
      clearLocalMediaStreamCache("camera");
      return null;
    }

    return getStableLocalMediaStream("camera", trackSid, mediaTrack);
  };

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SCREEN_SHARE_QUALITY_STORAGE_KEY);
      if (!raw) return;

      const parsed = JSON.parse(raw) as {
        resolution?: ScreenShareResolution;
        fps?: ScreenShareFps;
        shareSystemAudio?: boolean;
      };

      if (parsed.resolution === "720p" || parsed.resolution === "1080p") {
        setScreenShareResolution(parsed.resolution);
      }

      if (parsed.fps === 30 || parsed.fps === 60) {
        setScreenShareFps(parsed.fps);
      }

      if (typeof parsed.shareSystemAudio === "boolean") {
        setScreenShareSystemAudioEnabled(parsed.shareSystemAudio);
      }
    } catch {}
  }, []);


  useEffect(() => {
    setVoiceAudioSettings(readVoiceAudioSettings());

    const syncSettings = () => {
      const next = readVoiceAudioSettings();
      setVoiceAudioSettings(next);
    };

    syncSettings();
    window.addEventListener("storage", syncSettings);
    window.addEventListener("vice-voice-audio-settings-updated", syncSettings as EventListener);

    return () => {
      window.removeEventListener("storage", syncSettings);
      window.removeEventListener(
        "vice-voice-audio-settings-updated",
        syncSettings as EventListener
      );
    };
  }, []);

  useEffect(() => {
    void applyOutputDeviceToAllAudioElements(voiceAudioSettings.outputDeviceId);
    if (voiceAudioSettings.outputDeviceId !== appliedOutputDeviceIdRef.current) {
      appliedOutputDeviceIdRef.current = voiceAudioSettings.outputDeviceId;
    }
  }, [voiceAudioSettings.outputDeviceId]);

  useEffect(() => {
    if (!roomRef.current || !localMicTrackRef.current) return;

    const nextInputDeviceId = String(voiceAudioSettings.inputDeviceId || "");
    const appliedInputDeviceId = String(appliedInputDeviceIdRef.current || "");
    if (nextInputDeviceId === appliedInputDeviceId) return;

    let cancelled = false;

    const restartProcessedMicrophone = async () => {
      try {
        const shouldEnableMicrophone = !(
          selfMutedRef.current ||
          selfDeafenedRef.current ||
          serverMutedRef.current ||
          serverDeafenedRef.current
        );

        await cleanupLocalMicProcessing(true);
        if (cancelled || !roomRef.current) return;
        await setProcessedMicrophoneEnabled(shouldEnableMicrophone);
      } catch (error) {
        console.error("input device switch error:", error);
      }
    };

    void restartProcessedMicrophone();

    return () => {
      cancelled = true;
    };
  }, [voiceAudioSettings.inputDeviceId]);

  useEffect(() => {
    const micInputGain = micInputGainRef.current;
    if (micInputGain) {
      const now = micInputGain.context.currentTime;
      micInputGain.gain.cancelScheduledValues(now);
      micInputGain.gain.setValueAtTime(micInputGain.gain.value, now);
      micInputGain.gain.linearRampToValueAtTime(
        voiceAudioSettings.micGain,
        now + 0.06
      );
    }

    const presenceEq = micPresenceEqRef.current;
    if (presenceEq) {
      const now = presenceEq.context.currentTime;
      presenceEq.gain.cancelScheduledValues(now);
      presenceEq.gain.setValueAtTime(presenceEq.gain.value, now);
      presenceEq.gain.linearRampToValueAtTime(
        voiceAudioSettings.rnnoiseEnabled ? 1.1 : 0.85,
        now + 0.08
      );
    }

    const warmthEq = micWarmthEqRef.current;
    if (warmthEq) {
      const now = warmthEq.context.currentTime;
      warmthEq.gain.cancelScheduledValues(now);
      warmthEq.gain.setValueAtTime(warmthEq.gain.value, now);
      warmthEq.gain.linearRampToValueAtTime(
        voiceAudioSettings.rnnoiseEnabled ? 1.25 : 0.8,
        now + 0.08
      );
    }

    const harshCutEq = micHarshCutEqRef.current;
    if (harshCutEq) {
      const now = harshCutEq.context.currentTime;
      harshCutEq.gain.cancelScheduledValues(now);
      harshCutEq.gain.setValueAtTime(harshCutEq.gain.value, now);
      harshCutEq.gain.linearRampToValueAtTime(
        voiceAudioSettings.rnnoiseEnabled ? -1.35 : -0.9,
        now + 0.08
      );
    }

    const mudEq = micMudEqRef.current;
    if (mudEq) {
      const now = mudEq.context.currentTime;
      mudEq.gain.cancelScheduledValues(now);
      mudEq.gain.setValueAtTime(mudEq.gain.value, now);
      mudEq.gain.linearRampToValueAtTime(-1.6, now + 0.08);
    }

    const postGain = micPostGainRef.current;
    if (postGain) {
      const now = postGain.context.currentTime;
      postGain.gain.cancelScheduledValues(now);
      postGain.gain.setValueAtTime(postGain.gain.value, now);
      postGain.gain.linearRampToValueAtTime(
        voiceAudioSettings.rnnoiseEnabled ? 1.13 : 1.08,
        now + 0.08
      );
    }

    audioElementsRef.current.forEach((element) => {
      element.volume = voiceAudioSettings.outputVolume;
      element.muted = isDeafened;
      void applyOutputDeviceToElement(element, voiceAudioSettings.outputDeviceId);
    });

    if (!roomRef.current || !localMicTrackRef.current) return;
    updateMicGateThreshold();
  }, [voiceAudioSettings, isDeafened]);

  const currentPresenceList = useMemo(() => {
    const key = getJoinChannelId();
    return key ? voicePresenceMap[key] || [] : [];
  }, [voicePresenceMap, mode, dmChannelId, dmRoomName, activeVoiceChannelId]);

  const getParticipantLabel = (participantId: string, fallback?: string | null) => {
    if (participantId === localIdentity) {
      return (
        localDisplayName ||
        getStoredUser()?.displayName ||
        getStoredUser()?.username ||
        fallback ||
        "Sen"
      );
    }

    const fromPresence = currentPresenceList.find(
      (item) => item.userId === participantId
    );
    const fromIdentity = identityMap[participantId];

    return (
      fromPresence?.displayName ||
      fromIdentity?.displayName ||
      fromPresence?.username ||
      fromIdentity?.username ||
      fallback ||
      dmDisplayName ||
      "Kullanıcı"
    );
  };

  const emitVoiceVisualState = (
  visuals: RemoteVisualEntry[],
  localScreenShareActive: boolean
) => {
  const channelId = getJoinChannelId();

  const labeledVisuals = visuals
    .filter((item) =>
      item.mediaStream
        .getVideoTracks()
        .some((track) => track.readyState === "live")
    )
    .map((item) => ({
      ...item,
      participantName: getParticipantLabel(item.participantId, item.participantName),
    }));

  const localCameraStream = getLocalCameraMediaStream();
  const localCameraPublication = getLocalCameraPublication();

  if (
    localCameraStream &&
    localIdentity &&
    localCameraStream.getVideoTracks().some((track) => track.readyState === "live")
  ) {
    labeledVisuals.push({
      participantId: localIdentity,
      participantName: getParticipantLabel(localIdentity, localDisplayName || "Sen"),
      trackSid: localCameraPublication?.trackSid || `local-camera:${localIdentity}`,
      mediaStream: localCameraStream,
      source: "camera",
    });
  }

  const dedupedVisuals = Array.from(
    labeledVisuals.reduce((map, item) => {
      map.set(`${item.participantId}:${item.source}`, item);
      return map;
    }, new Map<string, RemoteVisualEntry>()).values()
  );

  const detail = {
    channelId,
    visuals: dedupedVisuals,
    localScreenShareActive,
  };

  try {
    const snapshot = ((window as any)[STREAM_SNAPSHOT_KEY] || {}) as Record<
      string,
      any
    >;
    const nextSnapshot = { ...snapshot };

    if (channelId && (dedupedVisuals.length > 0 || localScreenShareActive)) {
      nextSnapshot[channelId] = detail;
    } else if (channelId) {
      delete nextSnapshot[channelId];
    }

    (window as any)[STREAM_SNAPSHOT_KEY] = nextSnapshot;
  } catch {}

  window.dispatchEvent(
    new CustomEvent(STREAM_EVENT_NAME, {
      detail,
    })
  );
};

  const clearPreviewCaptureLoop = () => {
    if (previewCaptureIntervalRef.current) {
      window.clearInterval(previewCaptureIntervalRef.current);
      previewCaptureIntervalRef.current = null;
    }
  };

  const updateLocalAnnouncementSnapshot = (
    channelId: string,
    nextAnnouncements: StreamAnnouncement[],
    options?: {
      emittedAt?: number;
      clearedParticipantId?: string | null;
      clearedTrackSid?: string | null;
      clearedSource?: "camera" | "screen" | null;
    }
  ) => {
    const emittedAt = options?.emittedAt ?? Date.now();

    try {
      const snapshot =
        ((window as any)[STREAM_ANNOUNCEMENT_SNAPSHOT_KEY] || {}) as Record<
          string,
          any
        >;
      const nextSnapshot = { ...snapshot };
      const currentEntry = nextSnapshot[channelId];
      const currentAnnouncements = Array.isArray(currentEntry?.announcements)
        ? currentEntry.announcements
        : [];

      const actorParticipantId =
        nextAnnouncements[0]?.participantId ||
        options?.clearedParticipantId ||
        localIdentity ||
        null;
      const actorSource =
        nextAnnouncements[0]?.source ||
        options?.clearedSource ||
        "screen";
      const actorTrackSid =
        nextAnnouncements[0]?.trackSid || options?.clearedTrackSid || null;

      const filterForActor = (item: any) => {
        if (actorTrackSid && String(item?.trackSid ?? "") === actorTrackSid) {
          return false;
        }
        if (actorParticipantId && actorSource) {
          return !(
            String(item?.participantId ?? "") === String(actorParticipantId) &&
            item?.source === actorSource
          );
        }
        if (actorParticipantId) {
          return String(item?.participantId ?? "") !== String(actorParticipantId);
        }
        return true;
      };

      const mergedAnnouncements =
        nextAnnouncements.length > 0
          ? [...currentAnnouncements.filter(filterForActor), ...nextAnnouncements]
          : currentAnnouncements.filter(filterForActor);

      if (mergedAnnouncements.length > 0) {
        nextSnapshot[channelId] = {
          channelId,
          announcements: mergedAnnouncements,
          emittedAt,
          userId: actorParticipantId || undefined,
          trackSid: actorTrackSid || undefined,
          source: actorSource || undefined,
        };
      } else {
        delete nextSnapshot[channelId];
      }

      (window as any)[STREAM_ANNOUNCEMENT_SNAPSHOT_KEY] = nextSnapshot;

      if (mergedAnnouncements.length > 0) {
        window.dispatchEvent(
          new CustomEvent(STREAM_ANNOUNCEMENT_EVENT_NAME, {
            detail: nextSnapshot[channelId],
          })
        );
      } else {
        window.dispatchEvent(
          new CustomEvent(STREAM_ANNOUNCEMENT_CLEAR_EVENT_NAME, {
            detail: {
              channelId,
              emittedAt,
              participantId: actorParticipantId || undefined,
              trackSid: actorTrackSid || undefined,
              source: actorSource || undefined,
            },
          })
        );
      }
    } catch {}
  };

  const forceClearAnnouncements = () => {
    const channelId = getJoinChannelId();
    if (!channelId) return;

    announcementVersionRef.current += 1;

    const clearedTrackSid = localScreenShareAnnouncementTrackSidRef.current;
    const clearedParticipantId = localIdentity;

    localScreenShareAnnouncementTrackSidRef.current = null;

    const detail = {
      channelId,
      announcements: [] as StreamAnnouncement[],
      emittedAt: Date.now(),
      participantId: clearedParticipantId,
      trackSid: clearedTrackSid,
      source: "screen" as const,
    };

    updateLocalAnnouncementSnapshot(channelId, [], {
      emittedAt: detail.emittedAt,
      clearedParticipantId,
      clearedTrackSid,
      clearedSource: "screen",
    });

    window.dispatchEvent(
      new CustomEvent(STREAM_ANNOUNCEMENT_UPSTREAM_EVENT_NAME, {
        detail,
      })
    );
  };

  const forceClearCameraAnnouncements = () => {
    const channelId = getJoinChannelId();
    if (!channelId) return;

    clearLocalMediaStreamCache("camera");

    const clearedTrackSid = localCameraAnnouncementTrackSidRef.current;
    const clearedParticipantId = localIdentity;

    localCameraAnnouncementTrackSidRef.current = null;

    const detail = {
      channelId,
      announcements: [] as StreamAnnouncement[],
      emittedAt: Date.now(),
      participantId: clearedParticipantId,
      trackSid: clearedTrackSid,
      source: "camera" as const,
    };

    updateLocalAnnouncementSnapshot(channelId, [], {
      emittedAt: detail.emittedAt,
      clearedParticipantId,
      clearedTrackSid,
      clearedSource: "camera",
    });

    window.dispatchEvent(
      new CustomEvent(STREAM_ANNOUNCEMENT_UPSTREAM_EVENT_NAME, {
        detail,
      })
    );
  };

  const getLocalScreenSharePublication = () => {
    const room = roomRef.current;
    if (!room) return null;

    for (const pub of room.localParticipant.trackPublications.values()) {
      if (
        pub.kind === Track.Kind.Video &&
        pub.source === Track.Source.ScreenShare &&
        isTrackPublicationLive(pub)
      ) {
        return pub;
      }
    }

    return null;
  };

  const getLocalScreenShareMediaStream = () => {
    const publication = getLocalScreenSharePublication();
    const mediaTrack = publication?.track?.mediaStreamTrack;
    const trackSid =
      localScreenShareAnnouncementTrackSidRef.current ||
      publication?.trackSid ||
      publication?.track?.sid ||
      (localIdentity ? `local-screen:${localIdentity}` : "local-screen");

    if (!mediaTrack || mediaTrack.readyState !== "live") {
      return getCachedLocalMediaStream("screen");
    }

    return getStableLocalMediaStream("screen", trackSid, mediaTrack);
  };

  const capturePreviewDataUrl = async (mediaStream: MediaStream) => {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.autoplay = true;
    video.srcObject = mediaStream;

    try {
      await video.play().catch(() => undefined);
    } catch {}

    await new Promise((resolve) => {
      if (video.readyState >= 2) {
        resolve(null);
        return;
      }

      const onReady = () => {
        cleanup();
        resolve(null);
      };
      const onTimeout = () => {
        cleanup();
        resolve(null);
      };
      const cleanup = () => {
        video.removeEventListener("loadeddata", onReady);
        window.clearTimeout(timeoutId);
      };

      video.addEventListener("loadeddata", onReady, { once: true });
      const timeoutId = window.setTimeout(onTimeout, 1200);
    });

    const width = Math.max(1, Math.min(960, video.videoWidth || 960));
    const height = Math.max(1, Math.min(540, video.videoHeight || 540));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    try {
      ctx.drawImage(video, 0, 0, width, height);
      return canvas.toDataURL("image/jpeg", 0.78);
    } catch {
      return null;
    } finally {
      try {
        video.pause();
      } catch {}
      try {
        video.srcObject = null;
      } catch {}
    }
  };

  const emitStreamAnnouncements = async (
    _visuals: RemoteVisualEntry[],
    localScreenShareActive: boolean
  ) => {
    const channelId = getJoinChannelId();
    if (!channelId) return;

    const emitVersion = ++announcementVersionRef.current;
    const announcements: StreamAnnouncement[] = [];

    if (localScreenShareActive && localIdentity) {
      const localPublication = getLocalScreenSharePublication();
      const localTrackSid =
        localScreenShareAnnouncementTrackSidRef.current ||
        localPublication?.trackSid ||
        `local-screen:${localIdentity}`;
      const localMediaStream = getLocalScreenShareMediaStream();
      const previewDataUrl = localMediaStream
        ? await capturePreviewDataUrl(localMediaStream).catch(() => null)
        : null;

      if (emitVersion !== announcementVersionRef.current) {
        return;
      }

      announcements.push({
        trackSid: localTrackSid,
        participantId: localIdentity,
        participantName: getParticipantLabel(localIdentity, localDisplayName || "Sen"),
        source: "screen",
        previewDataUrl,
        previewUpdatedAt: previewDataUrl ? Date.now() : null,
      });
    }

    if (emitVersion !== announcementVersionRef.current) {
      return;
    }

    const detail = {
  channelId,
  announcements,
  emittedAt: Date.now(),
};

updateLocalAnnouncementSnapshot(channelId, announcements, {
  emittedAt: detail.emittedAt,
  clearedParticipantId: localIdentity,
  clearedTrackSid: localScreenShareAnnouncementTrackSidRef.current,
  clearedSource: "screen",
});

window.dispatchEvent(
  new CustomEvent(STREAM_ANNOUNCEMENT_UPSTREAM_EVENT_NAME, {
    detail,
  })
);
  };

  const emitCameraAnnouncement = async (localCameraActive: boolean) => {
    const channelId = getJoinChannelId();
    if (!channelId) return;

    if (!localCameraActive || !localIdentity) {
      forceClearCameraAnnouncements();
      return;
    }

    const localPublication = getLocalCameraPublication();
    const localTrackSid =
      localCameraAnnouncementTrackSidRef.current ||
      localPublication?.trackSid ||
      `local-camera:${localIdentity}`;

    localCameraAnnouncementTrackSidRef.current = localTrackSid;

    const announcement: StreamAnnouncement = {
      trackSid: localTrackSid,
      participantId: localIdentity,
      participantName: getParticipantLabel(
        localIdentity,
        localDisplayName || "Sen"
      ),
      source: "camera",
      previewDataUrl: null,
      previewUpdatedAt: null,
    };

    const detail = {
      channelId,
      announcements: [announcement],
      emittedAt: Date.now(),
      participantId: localIdentity,
      trackSid: localTrackSid,
      source: "camera" as const,
    };

    updateLocalAnnouncementSnapshot(channelId, [announcement], {
      emittedAt: detail.emittedAt,
      clearedParticipantId: localIdentity,
      clearedTrackSid: localTrackSid,
      clearedSource: "camera",
    });

    window.dispatchEvent(
      new CustomEvent(STREAM_ANNOUNCEMENT_UPSTREAM_EVENT_NAME, {
        detail,
      })
    );
  };

  const persistServerReconnectState = (channel: Channel | null | undefined) => {
    if (!channel?.id) return;

    localStorage.setItem(SERVER_VOICE_CHANNEL_STORAGE_KEY, channel.id);

    if (channel.serverId) {
      localStorage.setItem(SERVER_VOICE_SERVER_STORAGE_KEY, channel.serverId);
    }
  };

  const clearServerReconnectState = () => {
    localStorage.removeItem(SERVER_VOICE_CHANNEL_STORAGE_KEY);
    localStorage.removeItem(SERVER_VOICE_SERVER_STORAGE_KEY);
  };

  const setAndEmitRemoteVisuals = (
    visuals: RemoteVisualEntry[],
    localScreenShareActiveOverride?: boolean
  ) => {
    remoteVisualsRef.current = visuals;
    setRemoteVisuals(visuals);
    emitVoiceVisualState(
      visuals,
      localScreenShareActiveOverride ?? isScreenShareEnabled
    );
  };

  const getStableRemoteMediaStream = (
    trackSid: string,
    mediaTrack: MediaStreamTrack,
    audioTrack?: MediaStreamTrack | null
  ) => {
    const cached = remoteMediaStreamCacheRef.current.get(trackSid);
    const hasLiveAudioTrack = Boolean(
      audioTrack && audioTrack.readyState === "live"
    );

    if (
      cached &&
      cached.mediaTrack === mediaTrack &&
      cached.mediaTrack.readyState === "live"
    ) {
      const cachedAudioTracks = cached.stream
        .getAudioTracks()
        .filter((track) => track.readyState === "live");
      const cachedAudioTrack = cachedAudioTracks[0] ?? null;

      if (hasLiveAudioTrack) {
        if (cachedAudioTrack !== audioTrack) {
          cachedAudioTracks.forEach((track) => {
            try {
              cached.stream.removeTrack(track);
            } catch {}
          });
          try {
            cached.stream.addTrack(audioTrack as MediaStreamTrack);
          } catch {}
        }
      } else if (cachedAudioTrack) {
        cachedAudioTracks.forEach((track) => {
          try {
            cached.stream.removeTrack(track);
          } catch {}
        });
      }

      return cached.stream;
    }

    const stream = new MediaStream([mediaTrack]);
    if (hasLiveAudioTrack) {
      try {
        stream.addTrack(audioTrack as MediaStreamTrack);
      } catch {}
    }
    remoteMediaStreamCacheRef.current.set(trackSid, {
      mediaTrack,
      stream,
    });

    return stream;
  };

  const pruneRemoteMediaStreamCache = (activeTrackSids: Set<string>) => {
    for (const [trackSid, cached] of remoteMediaStreamCacheRef.current.entries()) {
      if (!activeTrackSids.has(trackSid) || cached.mediaTrack.readyState !== "live") {
        remoteMediaStreamCacheRef.current.delete(trackSid);
      }
    }
  };

  const cleanupAudioElements = () => {
    audioElementsRef.current.forEach((el) => {
      try {
        el.pause?.();
      } catch {}
      try {
        el.srcObject = null;
      } catch {}
      try {
        el.removeAttribute("src");
      } catch {}
      try {
        el.load?.();
      } catch {}
      try {
        el.remove();
      } catch {}
    });

    audioElementsRef.current = [];
  };

  const cleanupVisuals = () => {
  localCameraSuppressedRef.current = false;
  clearPreviewCaptureLoop();
  if (cameraRefreshTimerRef.current) {
    window.clearTimeout(cameraRefreshTimerRef.current);
    cameraRefreshTimerRef.current = null;
  }
  remoteMediaStreamCacheRef.current.clear();
  clearLocalMediaStreamCache();
  announcementVersionRef.current += 1;

  forceClearCameraAnnouncements();
  forceClearAnnouncements();

  setAndEmitRemoteVisuals([], false);
  setIsCameraEnabled(false);
  setIsScreenShareEnabled(false);
};

 const syncRemoteVisualLabels = () => {
  const next = remoteVisualsRef.current.map((item) => ({
    ...item,
    participantName: getParticipantLabel(item.participantId, item.participantName),
  }));

  setAndEmitRemoteVisuals(next, isScreenShareEnabled);
};

  const syncLocalMediaFlags = () => {
    const room = roomRef.current;
    if (!room) {
      clearPreviewCaptureLoop();
      preserveCameraUiUntilRef.current = 0;
      preserveScreenUiUntilRef.current = 0;
      setIsCameraEnabled(false);
      setIsScreenShareEnabled(false);
      emitVoiceVisualState(remoteVisualsRef.current, false);
      forceClearAnnouncements();
      forceClearCameraAnnouncements();
      return;
    }

    let nextCam = Boolean(getLocalCameraMediaStream());
    let nextScreen = Boolean(getLocalScreenShareMediaStream());

    room.localParticipant.trackPublications.forEach((pub) => {
      if (pub.kind !== Track.Kind.Video) return;

      const mediaTrack = pub.track?.mediaStreamTrack;
      if (!mediaTrack || mediaTrack.readyState !== "live") return;

      if (pub.source === Track.Source.ScreenShare) {
        nextScreen = true;
        try {
          (mediaTrack as any).contentHint = "detail";
        } catch {}
        return;
      }

      if (pub.source === Track.Source.Camera) {
        nextCam = true;
      }
    });

    if (
      !nextCam &&
      preserveCameraUiUntilRef.current > Date.now() &&
      Boolean(getCachedLocalMediaStream("camera"))
    ) {
      nextCam = true;
    }

    if (
      !nextScreen &&
      (
        (preserveScreenUiUntilRef.current > Date.now() &&
          Boolean(
            localScreenShareTrackRef.current ||
              getCachedLocalMediaStream("screen") ||
              isScreenShareEnabled
          )) ||
        (isStartingScreenShare &&
          Boolean(
            localScreenShareTrackRef.current ||
              getLocalScreenSharePublication() ||
              getCachedLocalMediaStream("screen") ||
              isScreenShareEnabled
          ))
      )
    ) {
      nextScreen = true;
    }

    if (nextCam) {
      preserveCameraUiUntilRef.current = 0;
    }

    if (nextScreen) {
      preserveScreenUiUntilRef.current = Math.max(
        preserveScreenUiUntilRef.current,
        Date.now() + 900
      );
    }

    setIsCameraEnabled(nextCam);
    setIsScreenShareEnabled(nextScreen);
    emitVoiceVisualState(remoteVisualsRef.current, nextScreen);

    if (nextScreen) {
      void emitStreamAnnouncements(remoteVisualsRef.current, true);
      clearPreviewCaptureLoop();
      window.setTimeout(() => {
        void emitStreamAnnouncements(remoteVisualsRef.current, true);
      }, 900);
      previewCaptureIntervalRef.current = window.setInterval(() => {
        void emitStreamAnnouncements(remoteVisualsRef.current, true);
      }, SCREEN_PREVIEW_REFRESH_INTERVAL_MS);
    } else {
      clearPreviewCaptureLoop();
      if (!isStartingScreenShare) {
        forceClearAnnouncements();
      }
    }
  };

  const getLocalPresenceFromMap = () => {
    const channelId = getJoinChannelId();
    if (!channelId) return null;

    const myUserId = String(localIdentity || getStoredUserId() || "");
    if (!myUserId) return null;

    const participants = voicePresenceMap[channelId] || [];
    return (
      participants.find((item) => String(item.userId) === myUserId) || null
    );
  };

  const pruneSelfFromPresence = (channelId: string | null) => {
    if (!channelId || !setVoicePresenceMap) return;

    const me = getStoredUser();
    const myUserId = String(me?.id ?? "");
    if (!myUserId) return;

    setVoicePresenceMap((prev) => {
      const current = prev[channelId] || [];
      const nextMembers = current.filter((item) => item.userId !== myUserId);

      if (nextMembers.length === current.length) return prev;

      return {
        ...prev,
        [channelId]: nextMembers,
      };
    });
  };

  const hardResetLocalVoiceState = (
    nextStatus?: string,
    options?: {
      preserveActiveVoiceChannelId?: boolean;
      nextActiveVoiceChannelId?: string | null;
      preserveMuteState?: boolean;
      nextSelfMuted?: boolean;
      nextSelfDeafened?: boolean;
      nextServerMuted?: boolean;
      nextServerDeafened?: boolean;
      nextPreDeafenSelfMuted?: boolean;
    }
  ) => {
    cleanupAudioElements();
    cleanupVisuals();

    if (missingServerPresenceTimerRef.current) {
      window.clearTimeout(missingServerPresenceTimerRef.current);
      missingServerPresenceTimerRef.current = null;
    }

    roomRef.current = null;
    joinedVoiceKeyRef.current = null;
    joinInFlightRef.current = false;
    connectedModeRef.current = null;
    connectedServerChannelIdRef.current = null;

    const preserveMuteState = options?.preserveMuteState === true;
    const nextSelfMuted =
      typeof options?.nextSelfMuted === "boolean" ? options.nextSelfMuted : false;
    const nextSelfDeafened =
      typeof options?.nextSelfDeafened === "boolean" ? options.nextSelfDeafened : false;
    const nextServerMuted =
      typeof options?.nextServerMuted === "boolean" ? options.nextServerMuted : false;
    const nextServerDeafened =
      typeof options?.nextServerDeafened === "boolean" ? options.nextServerDeafened : false;
    const nextPreDeafenSelfMuted =
      typeof options?.nextPreDeafenSelfMuted === "boolean"
        ? options.nextPreDeafenSelfMuted
        : false;

    selfMutedRef.current = preserveMuteState ? nextSelfMuted : false;
    selfDeafenedRef.current = preserveMuteState ? nextSelfDeafened : false;
    serverMutedRef.current = preserveMuteState ? nextServerMuted : false;
    serverDeafenedRef.current = preserveMuteState ? nextServerDeafened : false;
    preDeafenSelfMutedRef.current = preserveMuteState
      ? nextPreDeafenSelfMuted
      : false;

    void cleanupLocalMicProcessing();
    setCurrentRoomName(null);
    setLocalIdentity(null);
    setLocalDisplayName(null);
    setVoiceParticipants([]);
    setSelfMuted(preserveMuteState ? nextSelfMuted : false);
    setSelfDeafened(preserveMuteState ? nextSelfDeafened : false);
    setIsMuted(preserveMuteState ? (nextSelfDeafened || nextSelfMuted || nextServerMuted) : false);
    setIsDeafened(preserveMuteState ? (nextSelfDeafened || nextServerDeafened) : false);

    const preserveActiveVoiceChannelId =
      options?.preserveActiveVoiceChannelId === true;
    const nextActiveVoiceChannelId =
      typeof options?.nextActiveVoiceChannelId === "string"
        ? options.nextActiveVoiceChannelId
        : null;

    if (preserveActiveVoiceChannelId) {
      setActiveVoiceChannelId(nextActiveVoiceChannelId);
    } else {
      setActiveVoiceChannelId(null);
    }

    setIsConnected(false);
    setSelfMuted(false);
    setSelfDeafened(false);
    setIsMuted(false);
    setIsDeafened(false);

    if (nextStatus) setStatus(nextStatus);
  };

  const disconnectRoomOnly = async () => {
    const existingRoom = roomRef.current;

    roomRef.current = null;
    joinedVoiceKeyRef.current = null;

    if (existingRoom) {
      try {
        existingRoom.removeAllListeners?.();
      } catch {}

      try {
        await existingRoom.disconnect(true as any);
      } catch {
        try {
          existingRoom.disconnect();
        } catch {}
      }
    }

    cleanupAudioElements();
    cleanupVisuals();
    await cleanupLocalMicProcessing();
    setIsConnected(false);
    setVoiceParticipants([]);
  };

  const leaveVoice = async (options?: {
    silentForDm?: boolean;
    preserveServerReconnect?: boolean;
  }) => {
    if (disconnectingRef.current) return;
    disconnectingRef.current = true;

    const silentForDm = Boolean(options?.silentForDm);
    const preserveServerReconnect = Boolean(options?.preserveServerReconnect);

    try {
      const authToken = getAuthToken();
      const currentChannelId =
        connectedModeRef.current === "server"
          ? connectedServerChannelIdRef.current
          : getJoinChannelId();

      if (
        connectedModeRef.current === "server" &&
        authToken &&
        currentChannelId
      ) {
        try {
          await fetch("http://localhost:3001/voice/leave", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${authToken}`,
            },
            body: JSON.stringify({}),
          });
        } catch (error) {
          console.error("voice leave fetch error:", error);
        }
      }

      if (connectedModeRef.current === "server") {
        pruneSelfFromPresence(currentChannelId);

        if (!preserveServerReconnect) {
          clearServerReconnectState();
        }
      }

      const shouldPlayLeaveSound = connectedModeRef.current === "server";

      await disconnectRoomOnly();

      hardResetLocalVoiceState(
        mode === "dm" ? "DM görüşmesinden ayrıldın" : "Voice kanaldan ayrıldın"
      );

      if (shouldPlayLeaveSound) {
        void playServerVoiceNotification("voice-leave");
      }

      if (mode === "dm" && !silentForDm && !unmountingRef.current) {
        await onDmLeave?.();
      }
    } finally {
      disconnectingRef.current = false;
    }
  };

  const forceLeaveFromServer = async (nextStatus = "Voice kanaldan atıldın") => {
    if (mode !== "server") return;

    const currentChannelId =
      connectedServerChannelIdRef.current || getJoinChannelId();

    if (missingServerPresenceTimerRef.current) {
      window.clearTimeout(missingServerPresenceTimerRef.current);
      missingServerPresenceTimerRef.current = null;
    }

    disconnectingRef.current = true;

    try {
      if (currentChannelId) {
        pruneSelfFromPresence(currentChannelId);
      }

      clearServerReconnectState();
      await disconnectRoomOnly();
      hardResetLocalVoiceState(nextStatus);
      void playServerVoiceNotification("voice-leave");
    } finally {
      disconnectingRef.current = false;
    }
  };

  const attachRemoteAudio = (
    track: RemoteTrack,
    trackSid?: string,
    publication?: RemoteTrackPublication
  ) => {
    if (!track || track.kind !== Track.Kind.Audio) return;

    const isScreenShareAudio =
      publication?.source === Track.Source.ScreenShareAudio;

    if (isScreenShareAudio) {
      return;
    }

    const exists = audioElementsRef.current.some(
      (el) => el.dataset?.trackSid === trackSid
    );
    if (exists) return;

    const element = track.attach() as HTMLMediaElement;
    element.autoplay = true;
    element.style.display = "none";
    element.muted = isDeafened;
    element.volume = voiceAudioSettings.outputVolume;
    if (trackSid) element.dataset.trackSid = trackSid;

    document.body.appendChild(element);
    void applyOutputDeviceToElement(element, voiceAudioSettings.outputDeviceId);
    audioElementsRef.current.push(element);
  };

  const reconcileRemoteVisualsFromRoom = () => {
    const room = roomRef.current;
    if (!room) {
      remoteMediaStreamCacheRef.current.clear();
      setAndEmitRemoteVisuals([], false);
      return;
    }

    const nextVisuals: RemoteVisualEntry[] = [];
    const activeTrackSids = new Set<string>();

    room.remoteParticipants.forEach((participant) => {
      const remoteScreenAudioPublication = Array.from(
        participant.trackPublications.values()
      ).find((publication) => {
        const track = publication.track;
        if (!track || track.kind !== Track.Kind.Audio) return false;
        if (publication.source !== Track.Source.ScreenShareAudio) return false;
        if (!publication.isSubscribed) return false;
        if (publication.isMuted || (track as any).isMuted) return false;

        const mediaTrack = track.mediaStreamTrack;
        return Boolean(
          mediaTrack &&
            mediaTrack.readyState === "live" &&
            mediaTrack.enabled !== false
        );
      });

      const remoteScreenAudioTrack =
        remoteScreenAudioPublication?.track?.mediaStreamTrack ?? null;

      participant.trackPublications.forEach((publication) => {
        const track = publication.track;
        if (!track || track.kind !== Track.Kind.Video) return;
        if (!publication.isSubscribed) return;
        if (publication.isMuted || (track as any).isMuted) return;

        const mediaTrack = track.mediaStreamTrack;
        if (!mediaTrack || mediaTrack.readyState !== "live" || mediaTrack.enabled === false) return;

        activeTrackSids.add(publication.trackSid);

        nextVisuals.push({
          participantId: participant.identity,
          participantName: getParticipantLabel(
            participant.identity,
            participant.name || null
          ),
          trackSid: publication.trackSid,
          mediaStream: getStableRemoteMediaStream(
            publication.trackSid,
            mediaTrack,
            publication.source === Track.Source.ScreenShare
              ? remoteScreenAudioTrack
              : null
          ),
          source:
            publication.source === Track.Source.ScreenShare ? "screen" : "camera",
        });
      });
    });

    pruneRemoteMediaStreamCache(activeTrackSids);
    setAndEmitRemoteVisuals(nextVisuals, isScreenShareEnabled);
  };

  const flushPendingVoiceConnect = () => {
    const pending = pendingVoiceConnectRef.current;
    if (!pending) return;

    if (joinInFlightRef.current || disconnectingRef.current) {
      return;
    }

    pendingVoiceConnectRef.current = null;
    void connectToVoice(pending.targetRoomName, pending.channelIdForJoin);
  };

  const requestVoiceConnect = (
    targetRoomName: string,
    channelIdForJoin: string
  ) => {
    const normalizedTargetRoomName = String(targetRoomName || "").trim();
    const normalizedChannelId = String(channelIdForJoin || "").trim();
    if (!normalizedTargetRoomName || !normalizedChannelId) return;

    const currentConnectedChannelId = String(connectedServerChannelIdRef.current || "").trim();
    const currentActiveChannelId = String(activeVoiceChannelId || "").trim();

    if (
      roomRef.current &&
      !joinInFlightRef.current &&
      !disconnectingRef.current &&
      currentConnectedChannelId === normalizedChannelId &&
      currentActiveChannelId === normalizedChannelId
    ) {
      return;
    }

    if (joinInFlightRef.current || disconnectingRef.current) {
      pendingVoiceConnectRef.current = {
        targetRoomName: normalizedTargetRoomName,
        channelIdForJoin: normalizedChannelId,
      };
      return;
    }

    void connectToVoice(normalizedTargetRoomName, normalizedChannelId);
  };

  const connectToVoice = async (
    targetRoomName: string,
    channelIdForJoin: string
  ) => {
    const normalizedTargetRoomName = String(targetRoomName || "").trim();
    const normalizedChannelId = String(channelIdForJoin || "").trim();
    if (!normalizedTargetRoomName || !normalizedChannelId) return;

    if (disconnectingRef.current) {
      pendingVoiceConnectRef.current = {
        targetRoomName: normalizedTargetRoomName,
        channelIdForJoin: normalizedChannelId,
      };
      return;
    }

    if (joinInFlightRef.current) {
      pendingVoiceConnectRef.current = {
        targetRoomName: normalizedTargetRoomName,
        channelIdForJoin: normalizedChannelId,
      };
      return;
    }

    if (
      joinedVoiceKeyRef.current === normalizedTargetRoomName &&
      roomRef.current &&
      connectedServerChannelIdRef.current === normalizedChannelId
    ) {
      pendingVoiceConnectRef.current = null;
      return;
    }

    const connectSessionId = activeConnectSessionRef.current + 1;
    activeConnectSessionRef.current = connectSessionId;
    joinInFlightRef.current = true;

    const isSuperseded = () =>
      activeConnectSessionRef.current !== connectSessionId;

    try {
      const authToken = getAuthToken();
      if (!authToken) {
        setStatus("Oturum bulunamadı");
        return;
      }

      const storedUser = getStoredUser();
      const meDisplayName =
        storedUser?.displayName || storedUser?.username || dmDisplayName || "Sen";

      const reconnectSelfMuted = selfMutedRef.current;
      const reconnectSelfDeafened = selfDeafenedRef.current;
      const reconnectServerMuted = serverMutedRef.current;
      const reconnectServerDeafened = serverDeafenedRef.current;
      const reconnectPreDeafenSelfMuted = preDeafenSelfMutedRef.current;

      if (roomRef.current) {
        await disconnectRoomOnly();
        if (isSuperseded()) return;
        hardResetLocalVoiceState(undefined, {
          preserveActiveVoiceChannelId: mode === "server",
          nextActiveVoiceChannelId: mode === "server" ? channelIdForJoin : null,
          preserveMuteState: mode === "server",
          nextSelfMuted: reconnectSelfMuted,
          nextSelfDeafened: reconnectSelfDeafened,
          nextServerMuted: reconnectServerMuted,
          nextServerDeafened: reconnectServerDeafened,
          nextPreDeafenSelfMuted: reconnectPreDeafenSelfMuted,
        });
      }

      if (disconnectingRef.current || isSuperseded()) return;

      if (normalizedChannelId && mode === "server") {
        const joinRes = await fetch("http://localhost:3001/voice/join", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify({
            channelId: normalizedChannelId,
          }),
        });

        if (!joinRes.ok) {
          const text = await joinRes.text().catch(() => "");
          throw new Error(text || "Voice join başarısız");
        }
        if (isSuperseded()) return;
      }

      const tokenRes = await fetch(
        `http://localhost:3001/livekit/token?room=${encodeURIComponent(
          normalizedTargetRoomName
        )}`,
        {
          headers: {
            Authorization: `Bearer ${authToken}`,
          },
        }
      );

      const tokenData = await tokenRes.json().catch(() => null);

      if (!tokenRes.ok) {
        throw new Error(tokenData?.error || "LiveKit token alınamadı.");
      }

      const accessToken = tokenData?.token || tokenData?.accessToken;
      if (!accessToken) {
        throw new Error("LiveKit token cevabı geçersiz.");
      }
      if (isSuperseded()) return;

      const room = new Room({
        adaptiveStream: false,
        dynacast: false,
        stopLocalTrackOnUnpublish: true,
        publishDefaults: {
          videoEncoding: {
            maxBitrate: 8_000_000,
            maxFramerate: 60,
          },
          screenShareEncoding: {
            maxBitrate: 8_000_000,
            maxFramerate: 60,
          },
        } as any,
      });

      roomRef.current = room;

      room.on(
        RoomEvent.TrackSubscribed,
        (track: RemoteTrack, publication: RemoteTrackPublication) => {
          if (activeConnectSessionRef.current !== connectSessionId || roomRef.current !== room) return;
          if (track.kind === Track.Kind.Audio) {
            attachRemoteAudio(track, publication.trackSid, publication);
          }

          reconcileRemoteVisualsFromRoom();
        }
      );

      room.on(
        RoomEvent.TrackUnsubscribed,
        (track: RemoteTrack, publication: RemoteTrackPublication) => {
          if (activeConnectSessionRef.current !== connectSessionId || roomRef.current !== room) return;
          try {
            track.detach().forEach((el: Element) => {
              try {
                (el as HTMLMediaElement).pause?.();
              } catch {}
              try {
                el.remove();
              } catch {}
            });
          } catch {}

          audioElementsRef.current = audioElementsRef.current.filter(
            (el) => el.dataset?.trackSid !== publication.trackSid
          );
          remoteMediaStreamCacheRef.current.delete(publication.trackSid);

          reconcileRemoteVisualsFromRoom();
        }
      );

      room.on(RoomEvent.TrackMuted, () => {
        if (activeConnectSessionRef.current !== connectSessionId || roomRef.current !== room) return;
        reconcileRemoteVisualsFromRoom();
      });

      room.on(RoomEvent.TrackUnmuted, () => {
        if (activeConnectSessionRef.current !== connectSessionId || roomRef.current !== room) return;
        reconcileRemoteVisualsFromRoom();
      });

      room.on(RoomEvent.ParticipantConnected, () => {
        if (activeConnectSessionRef.current !== connectSessionId || roomRef.current !== room) return;
        const remoteCount = room.remoteParticipants.size;
        setVoiceParticipants(Array.from(room.remoteParticipants.keys()));
        setStatus(
          mode === "dm"
            ? `${dmDisplayName || "Kullanıcı"} ile görüşme aktif`
            : `${remoteCount} kişi bağlı`
        );
        reconcileRemoteVisualsFromRoom();
      });

      room.on(RoomEvent.ParticipantDisconnected, () => {
        if (activeConnectSessionRef.current !== connectSessionId || roomRef.current !== room) return;
        const remoteCount = room.remoteParticipants.size;
        setVoiceParticipants(Array.from(room.remoteParticipants.keys()));
        setStatus(
          mode === "dm"
            ? remoteCount > 0
              ? `${dmDisplayName || "Kullanıcı"} ile görüşme aktif`
              : "Görüşme devam etmiyor"
            : `${remoteCount} kişi bağlı`
        );
        reconcileRemoteVisualsFromRoom();
      });

      room.on(RoomEvent.LocalTrackPublished, (pub: LocalTrackPublication) => {
        if (activeConnectSessionRef.current !== connectSessionId || roomRef.current !== room) return;
        syncLocalMediaFlags();
        reconcileRemoteVisualsFromRoom();

        if (pub.kind === Track.Kind.Video && pub.source === Track.Source.Camera) {
          void emitCameraAnnouncement(true);
          return;
        }

        if (
          pub.kind === Track.Kind.Video &&
          pub.source === Track.Source.ScreenShare
        ) {
          preserveScreenUiUntilRef.current = Date.now() + 2500;
          setIsScreenShareEnabled(true);
          syncLocalMediaFlags();
          reconcileRemoteVisualsFromRoom();
          void emitStreamAnnouncements(remoteVisualsRef.current, true);

          if (getLocalCameraMediaStream()) {
            void emitCameraAnnouncement(true);
          }
        }
      });

      room.on(RoomEvent.LocalTrackUnpublished, (pub: LocalTrackPublication) => {
        if (activeConnectSessionRef.current !== connectSessionId || roomRef.current !== room) return;
        syncLocalMediaFlags();

        if (pub.kind === Track.Kind.Video && pub.source === Track.Source.Camera) {
          window.setTimeout(() => {
            const stillHasLiveCamera = Boolean(getLocalCameraMediaStream());

            if (stillHasLiveCamera) {
              localCameraSuppressedRef.current = false;
              syncLocalMediaFlags();
              reconcileRemoteVisualsFromRoom();
              void emitCameraAnnouncement(true);
              return;
            }

            localCameraAnnouncementTrackSidRef.current = null;
            clearLocalMediaStreamCache("camera");
            setIsCameraEnabled(false);
            forceClearCameraAnnouncements();
            syncLocalMediaFlags();
            reconcileRemoteVisualsFromRoom();
          }, 120);
          return;
        }

        if (
          pub.kind === Track.Kind.Video &&
          pub.source === Track.Source.ScreenShare
        ) {
          window.setTimeout(() => {
            const stillHasLiveScreen = Boolean(
              getLocalScreenShareMediaStream() ||
              getLocalScreenSharePublication() ||
              localScreenShareTrackRef.current
            );
            const shouldKeepScreenUi =
              isStartingScreenShare ||
              (preserveScreenUiUntilRef.current > Date.now() &&
                Boolean(localScreenShareTrackRef.current || isScreenShareEnabled));

            if (!stillHasLiveScreen && !shouldKeepScreenUi) {
              clearLocalMediaStreamCache("screen");
              forceClearAnnouncements();
              setIsScreenShareEnabled(false);
            } else {
              setIsScreenShareEnabled(true);
            }

            syncLocalMediaFlags();
            reconcileRemoteVisualsFromRoom();

            if (getLocalCameraMediaStream()) {
              void emitCameraAnnouncement(true);
            }
          }, isStartingScreenShare ? 380 : 120);
          return;
        }

        reconcileRemoteVisualsFromRoom();
      });

      room.on(RoomEvent.TrackPublished, () => {
        if (activeConnectSessionRef.current !== connectSessionId || roomRef.current !== room) return;
        window.setTimeout(() => {
          reconcileRemoteVisualsFromRoom();
        }, 120);
      });

      room.on(RoomEvent.TrackUnpublished, () => {
        if (activeConnectSessionRef.current !== connectSessionId || roomRef.current !== room) return;
        window.setTimeout(() => {
          reconcileRemoteVisualsFromRoom();
        }, 120);
      });

      room.on(RoomEvent.Reconnected, () => {
        if (activeConnectSessionRef.current !== connectSessionId || roomRef.current !== room) return;
        syncLocalMediaFlags();
        reconcileRemoteVisualsFromRoom();
      });

      room.on(RoomEvent.Reconnecting, () => {
        if (activeConnectSessionRef.current !== connectSessionId || roomRef.current !== room) return;
        setAndEmitRemoteVisuals([], isScreenShareEnabled);
      });

      room.on(RoomEvent.Disconnected, () => {
        if (activeConnectSessionRef.current !== connectSessionId || roomRef.current !== room) return;
        cleanupAudioElements();
        cleanupVisuals();
        roomRef.current = null;
        joinedVoiceKeyRef.current = null;
        setIsConnected(false);
        setVoiceParticipants([]);
      });

      await room.connect(
        (((import.meta as any)?.env?.VITE_LIVEKIT_URL as string) ||
          "ws://localhost:7880"),
        accessToken
      );
      if (isSuperseded() || roomRef.current !== room) {
        try {
          await room.disconnect(true as any);
        } catch {
          try {
            room.disconnect();
          } catch {}
        }
        return;
      }

      await cleanupLocalMicProcessing(true);
      if (isSuperseded() || roomRef.current !== room) return;
      await setProcessedMicrophoneEnabled(true);
      if (isSuperseded() || roomRef.current !== room) return;

      connectedModeRef.current = mode;
      connectedServerChannelIdRef.current =
        mode === "server" ? normalizedChannelId : null;

      if (mode === "server") {
        const reconnectChannel: Channel = selectedChannel
          ? {
              id: selectedChannel.id,
              name: selectedChannel.name,
              type: selectedChannel.type,
              serverId: selectedChannel.serverId,
              isPrivate: selectedChannel.isPrivate,
            }
          : {
              id: normalizedChannelId,
              name: normalizedTargetRoomName,
              type: "voice",
            };

        persistServerReconnectState(reconnectChannel);
      }

      setCurrentRoomName(normalizedTargetRoomName);
      setLocalIdentity(room.localParticipant.identity || null);
      setLocalDisplayName(meDisplayName);
      setActiveVoiceChannelId(normalizedChannelId);
      setIsConnected(true);
      if (mode !== "server") {
        selfMutedRef.current = false;
        selfDeafenedRef.current = false;
        serverMutedRef.current = false;
        serverDeafenedRef.current = false;
        preDeafenSelfMutedRef.current = false;
        setSelfMuted(false);
        setSelfDeafened(false);
        setIsMuted(false);
        setIsDeafened(false);
      } else {
        setSelfMuted(selfMutedRef.current);
        setSelfDeafened(selfDeafenedRef.current);
        await applyEffectiveVoiceState({
          selfMuted: selfMutedRef.current,
          selfDeafened: selfDeafenedRef.current,
          serverMuted: serverMutedRef.current,
          serverDeafened: serverDeafenedRef.current,
        });
      }
      joinedVoiceKeyRef.current = normalizedTargetRoomName;

      syncLocalMediaFlags();
      reconcileRemoteVisualsFromRoom();

      window.setTimeout(() => {
        syncLocalMediaFlags();
        reconcileRemoteVisualsFromRoom();
      }, 180);

      const remoteCount = room.remoteParticipants.size;
      setVoiceParticipants(Array.from(room.remoteParticipants.keys()));
      setStatus(
        mode === "dm"
          ? `${dmDisplayName || "Kullanıcı"} ile görüşme aktif`
          : remoteCount > 0
            ? `${remoteCount} kişi bağlı`
            : "Voice kanala bağlandın"
      );

      if (mode === "server") {
        void playServerVoiceNotification("voice-join");
      }
    } catch (error: any) {
      console.error("voice connect error:", error);
      if (activeConnectSessionRef.current === connectSessionId) {
        hardResetLocalVoiceState(error?.message || "Voice bağlantı hatası");
      }
    } finally {
      if (activeConnectSessionRef.current === connectSessionId) {
        joinInFlightRef.current = false;
      }
      window.setTimeout(() => {
        flushPendingVoiceConnect();
      }, 0);
    }
  };

  const handleMuteToggle = async () => {
    const room = roomRef.current;
    if (!room) return;

    const nextSelfMuted = !selfMutedRef.current;
    selfMutedRef.current = nextSelfMuted;
    setSelfMuted(nextSelfMuted);

    await applyEffectiveVoiceState({
      selfMuted: nextSelfMuted,
      selfDeafened: selfDeafenedRef.current,
      serverMuted: serverMutedRef.current,
      serverDeafened: serverDeafenedRef.current,
    });

    await syncVoiceStateToBackend(
      nextSelfMuted,
      selfDeafenedRef.current
    );
  };

  const handleDeafenToggle = async () => {
    const room = roomRef.current;
    if (!room) return;

    const nextSelfDeafened = !selfDeafenedRef.current;

    if (nextSelfDeafened) {
      preDeafenSelfMutedRef.current = selfMutedRef.current;
      selfMutedRef.current = true;
      setSelfMuted(true);
    } else {
      selfMutedRef.current = preDeafenSelfMutedRef.current;
      setSelfMuted(preDeafenSelfMutedRef.current);
    }

    selfDeafenedRef.current = nextSelfDeafened;
    setSelfDeafened(nextSelfDeafened);

    await applyEffectiveVoiceState({
      selfMuted: selfMutedRef.current,
      selfDeafened: nextSelfDeafened,
      serverMuted: serverMutedRef.current,
      serverDeafened: serverDeafenedRef.current,
    });

    await syncVoiceStateToBackend(
      selfMutedRef.current,
      nextSelfDeafened
    );
  };

  const handleLeaveClick = async () => {
    if (mode === "dm") {
      await leaveVoice({ silentForDm: true });
      await onDmLeave?.();
      return;
    }

    await leaveVoice();
  };
const handleCameraToggle = async () => {
  const room = roomRef.current;
  if (!room) return;

  const hasLiveCamera = Boolean(getLocalCameraPublication()) || Boolean(getCachedLocalMediaStream("camera"));
  const nextCameraEnabled = !hasLiveCamera;

  if (nextCameraEnabled) {
    localCameraSuppressedRef.current = false;
  }

  if (cameraRefreshTimerRef.current) {
    window.clearTimeout(cameraRefreshTimerRef.current);
    cameraRefreshTimerRef.current = null;
  }

  try {
    await room.localParticipant.setCameraEnabled(nextCameraEnabled);

    if (!nextCameraEnabled) {
      localCameraSuppressedRef.current = true;
      localCameraAnnouncementTrackSidRef.current = null;
      clearLocalMediaStreamCache("camera");
      setIsCameraEnabled(false);
      forceClearCameraAnnouncements();
      emitVoiceVisualState(remoteVisualsRef.current, Boolean(getLocalScreenShareMediaStream()));
      syncLocalMediaFlags();
      window.setTimeout(() => {
        syncLocalMediaFlags();
        reconcileRemoteVisualsFromRoom();
      }, 0);
      return;
    }

    setIsCameraEnabled(true);
    localCameraSuppressedRef.current = false;
    syncLocalMediaFlags();

    cameraRefreshTimerRef.current = window.setTimeout(() => {
      syncLocalMediaFlags();
      reconcileRemoteVisualsFromRoom();

      if (getLocalCameraMediaStream()) {
        void emitCameraAnnouncement(true);
      }

      cameraRefreshTimerRef.current = null;
    }, 140);
  } catch (error) {
    console.error("camera toggle error:", error);
  }
};

  const cleanupLocalScreenShareTrackRef = (stopTrack: boolean) => {
    localScreenShareAnnouncementTrackSidRef.current = null;
    localScreenShareAudioPublicationSidRef.current = null;

    const currentTrack = localScreenShareTrackRef.current;
    const mediaTrack = currentTrack?.mediaStreamTrack ?? null;
    const currentAudioTrack = localScreenShareAudioTrackRef.current;
    const audioMediaTrack = currentAudioTrack?.mediaStreamTrack ?? null;

    if (mediaTrack && localScreenShareEndedHandlerRef.current) {
      try {
        mediaTrack.removeEventListener(
          "ended",
          localScreenShareEndedHandlerRef.current
        );
      } catch {}
    }

    localScreenShareEndedHandlerRef.current = null;

    if (stopTrack) {
      try {
        currentTrack?.stop();
      } catch {}
      try {
        mediaTrack?.stop();
      } catch {}
      try {
        currentAudioTrack?.stop();
      } catch {}
      try {
        audioMediaTrack?.stop();
      } catch {}
    }

    try {
      currentTrack?.detach();
    } catch {}
    try {
      currentAudioTrack?.detach();
    } catch {}

    clearLocalMediaStreamCache("screen");
    localScreenShareTrackRef.current = null;
    localScreenShareAudioTrackRef.current = null;
  };

  const emitScreenShareStateAfterLocalChange = (
    nextLocalScreenShareActive: boolean,
    options?: { clearAll?: boolean }
  ) => {
    emitVoiceVisualState(remoteVisualsRef.current, nextLocalScreenShareActive);

    if (options?.clearAll) {
      forceClearAnnouncements();
      return;
    }

    void emitStreamAnnouncements(
      remoteVisualsRef.current,
      nextLocalScreenShareActive
    );
  };

  const stopLocalScreenShare = async () => {
    const room = roomRef.current;
    if (!room) return;
    if (isStoppingScreenShareRef.current) return;

    isStoppingScreenShareRef.current = true;
    preserveScreenUiUntilRef.current = 0;
    localScreenShareSessionRef.current += 1;
    const hadLiveCameraBeforeStop = Boolean(getLocalCameraMediaStream());
    if (hadLiveCameraBeforeStop) {
      preserveCameraUiUntilRef.current = Date.now() + 1500;
    }

    try {
      const publication = getLocalScreenSharePublication();
      const liveTrack = publication?.track ?? localScreenShareTrackRef.current ?? null;

      if (liveTrack) {
        try {
          await room.localParticipant.unpublishTrack(liveTrack as any, true as any);
        } catch {
          try {
            await room.localParticipant.unpublishTrack(liveTrack as any);
          } catch {}
        }
      }

      const screenAudioPublication = Array.from(
        room.localParticipant.trackPublications.values()
      ).find(
        (pub) =>
          pub.kind === Track.Kind.Audio &&
          pub.source === Track.Source.ScreenShareAudio
      );

      const liveAudioTrack =
        screenAudioPublication?.track ?? localScreenShareAudioTrackRef.current ?? null;

      if (liveAudioTrack) {
        try {
          await room.localParticipant.unpublishTrack(liveAudioTrack as any, true as any);
        } catch {
          try {
            await room.localParticipant.unpublishTrack(liveAudioTrack as any);
          } catch {}
        }
      }

      cleanupLocalScreenShareTrackRef(true);
      clearLocalMediaStreamCache("screen");
      clearPreviewCaptureLoop();
      setShowScreenShareModal(false);
      setIsScreenShareEnabled(false);
      if (hadLiveCameraBeforeStop) {
        localCameraSuppressedRef.current = false;
        setIsCameraEnabled(true);
      } else {
        setIsCameraEnabled(Boolean(getLocalCameraMediaStream()));
      }
      emitScreenShareStateAfterLocalChange(false);
      void playServerVoiceNotification("screen-share-stop");

      if (hadLiveCameraBeforeStop) {
        window.setTimeout(() => {
          void emitCameraAnnouncement(true);
        }, 60);
      }

      window.setTimeout(() => {
        syncLocalMediaFlags();
        reconcileRemoteVisualsFromRoom();
      }, 140);
      window.setTimeout(() => {
        syncLocalMediaFlags();
        reconcileRemoteVisualsFromRoom();

        if (hadLiveCameraBeforeStop) {
          void emitCameraAnnouncement(true);
        }
      }, 520);
    } finally {
      window.setTimeout(() => {
        isStoppingScreenShareRef.current = false;
      }, 120);
      window.setTimeout(() => {
        if (!Boolean(getLocalCameraMediaStream())) {
          preserveCameraUiUntilRef.current = 0;
        }
      }, 1600);
    }
  };

  const startScreenShareWithQuality = async () => {
    const room = roomRef.current;
    if (!room || isStartingScreenShare || isStoppingScreenShareRef.current) return;

    const hadLiveCameraBeforeStart = Boolean(getLocalCameraMediaStream());
    const hadLiveScreenShareBeforeStart = Boolean(
      isScreenShareEnabled ||
      getLocalScreenSharePublication() ||
      localScreenShareTrackRef.current
    );

    preserveScreenUiUntilRef.current = Date.now() + 2500;
    setIsStartingScreenShare(true);

    try {
      if (hadLiveScreenShareBeforeStart) {
        await stopLocalScreenShare();
        await new Promise((resolve) => window.setTimeout(resolve, 180));
      }
      const profile = getScreenShareProfile(screenShareResolution, screenShareFps);

      const mediaStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: profile.width, max: profile.width },
          height: { ideal: profile.height, max: profile.height },
          frameRate: { ideal: profile.fps, max: profile.fps },
        } as MediaTrackConstraints,
        audio: screenShareSystemAudioEnabled
          ? ({
              suppressLocalAudioPlayback: false,
            } as MediaTrackConstraints)
          : false,
        selfBrowserSurface: "exclude" as any,
        surfaceSwitching: "include" as any,
        systemAudio: "include" as any,
        windowAudio: "window" as any,
        monitorTypeSurfaces: "include" as any,
      } as any);

      const mediaTrack = mediaStream.getVideoTracks()[0];
      if (!mediaTrack) {
        throw new Error("Screen share track alınamadı.");
      }

      try {
        await mediaTrack.applyConstraints({
          width: profile.width,
          height: profile.height,
          frameRate: profile.fps,
          aspectRatio: profile.width / profile.height,
        });
      } catch {}

      try {
        const settings = mediaTrack.getSettings?.();
        console.log("[vICE] screen share capture settings", settings);
      } catch {}

      try {
        (mediaTrack as any).contentHint = "detail";
      } catch {}

      const localTrack = new LocalVideoTrack(mediaTrack);
      const sessionId = localScreenShareSessionRef.current + 1;
      localScreenShareSessionRef.current = sessionId;
      const publication = await room.localParticipant.publishTrack(localTrack, {
        source: Track.Source.ScreenShare,
        simulcast: true,
        videoEncoding: {
          maxBitrate: profile.maxBitrate,
          maxFramerate: profile.fps,
        },
      } as any);

      const screenAudioMediaTrack = mediaStream.getAudioTracks()[0] ?? null;
      if (screenAudioMediaTrack) {
        try {
          const settings = screenAudioMediaTrack.getSettings?.();
          console.log("[vICE] screen share audio settings", settings);
        } catch {}

        try {
          (screenAudioMediaTrack as any).contentHint = "music";
        } catch {}

        const localAudioTrack = new LocalAudioTrack(
          screenAudioMediaTrack,
          undefined,
          true
        );
        const audioPublication = await room.localParticipant.publishTrack(
          localAudioTrack,
          {
            source: Track.Source.ScreenShareAudio,
          } as any
        );

        localScreenShareAudioTrackRef.current = localAudioTrack;
        localScreenShareAudioPublicationSidRef.current =
          audioPublication?.trackSid || localAudioTrack.sid || null;
      } else {
        localScreenShareAudioTrackRef.current = null;
        localScreenShareAudioPublicationSidRef.current = null;
      }

      localScreenShareTrackRef.current = localTrack;
      localScreenShareAnnouncementTrackSidRef.current =
        publication?.trackSid ||
        localTrack.sid ||
        `local-screen:${room.localParticipant.identity}`;

      const handleEnded = () => {
        if (isStoppingScreenShareRef.current) return;
        if (localScreenShareSessionRef.current !== sessionId) return;
        void stopLocalScreenShare();
      };
      localScreenShareEndedHandlerRef.current = handleEnded;

      try {
        mediaTrack.addEventListener("ended", handleEnded, { once: true });
      } catch {}

      saveScreenShareQualityPreference(
        screenShareResolution,
        screenShareFps,
        screenShareSystemAudioEnabled
      );
      setShowScreenShareModal(false);
      setIsScreenShareEnabled(true);
      preserveScreenUiUntilRef.current = Date.now() + 2500;
      if (hadLiveCameraBeforeStart) {
        preserveCameraUiUntilRef.current = Date.now() + 1200;
      }
      void playServerVoiceNotification("screen-share-start");

      syncLocalMediaFlags();
      emitScreenShareStateAfterLocalChange(true);
      reconcileRemoteVisualsFromRoom();
      if (hadLiveCameraBeforeStart) {
        void emitCameraAnnouncement(true);
      }

      window.setTimeout(() => {
        syncLocalMediaFlags();
        reconcileRemoteVisualsFromRoom();
      }, 700);
    } catch (error) {
      console.error("screen share start error:", error);
      cleanupLocalScreenShareTrackRef(true);
      clearLocalMediaStreamCache("screen");
      preserveScreenUiUntilRef.current = 0;
      setShowScreenShareModal(false);
      setIsScreenShareEnabled(false);

      if (hadLiveCameraBeforeStart) {
        localCameraSuppressedRef.current = false;
        preserveCameraUiUntilRef.current = Date.now() + 1200;
        setIsCameraEnabled(true);
      } else {
        setIsCameraEnabled(Boolean(getLocalCameraMediaStream()));
      }

      if (hadLiveScreenShareBeforeStart) {
        emitScreenShareStateAfterLocalChange(false);
      }

      window.setTimeout(() => {
        syncLocalMediaFlags();
        reconcileRemoteVisualsFromRoom();

        if (hadLiveCameraBeforeStart || getLocalCameraMediaStream()) {
          void emitCameraAnnouncement(true);
        }
      }, 60);
    } finally {
      setIsStartingScreenShare(false);
    }
  };

  const handleScreenShareToggle = async () => {
    const room = roomRef.current;
    if (!room) return;

    try {
      if (isScreenShareEnabled) {
        await stopLocalScreenShare();
        return;
      }

      setShowScreenShareModal(true);
      return;
    } catch (error) {
      console.error("screen share toggle error:", error);
    }
  };

  useEffect(() => {
    remoteVisualsRef.current = remoteVisuals;
  }, [remoteVisuals]);

  useEffect(() => {
    const handler = (event: Event) => {
      const customEvent = event as CustomEvent<{ channelId?: string | null }>;
      const requestedChannelId = customEvent.detail?.channelId ?? null;
      const currentChannelId = getJoinChannelId();
      if (!currentChannelId || requestedChannelId !== currentChannelId) return;
      reconcileRemoteVisualsFromRoom();
    };

    window.addEventListener(
      REQUEST_VISUAL_RECONCILE_EVENT_NAME,
      handler as EventListener
    );
    return () => {
      window.removeEventListener(
        REQUEST_VISUAL_RECONCILE_EVENT_NAME,
        handler as EventListener
      );
    };
  }, [mode, dmChannelId, dmRoomName, activeVoiceChannelId, isScreenShareEnabled]);


  useEffect(() => {
    if (mode !== "server") {
      hadServerPresenceRef.current = false;
      if (missingServerPresenceTimerRef.current) {
        window.clearTimeout(missingServerPresenceTimerRef.current);
        missingServerPresenceTimerRef.current = null;
      }
      return;
    }

    const localPresence = getLocalPresenceFromMap();
    const nextServerMuted = Boolean(localPresence?.serverMuted);
    const nextServerDeafened = Boolean(localPresence?.serverDeafened);

    if (
      serverMutedRef.current !== nextServerMuted ||
      serverDeafenedRef.current !== nextServerDeafened
    ) {
      serverMutedRef.current = nextServerMuted;
      serverDeafenedRef.current = nextServerDeafened;

      void applyEffectiveVoiceState({
        selfMuted: selfMutedRef.current,
        selfDeafened: selfDeafenedRef.current,
        serverMuted: nextServerMuted,
        serverDeafened: nextServerDeafened,
      });
    }

    if (localPresence) {
      hadServerPresenceRef.current = true;
    }

    if (
      isConnected &&
      connectedModeRef.current === "server" &&
      roomRef.current &&
      !joinInFlightRef.current &&
      !disconnectingRef.current
    ) {
      if (!localPresence && hadServerPresenceRef.current) {
        if (!missingServerPresenceTimerRef.current) {
          missingServerPresenceTimerRef.current = window.setTimeout(() => {
            missingServerPresenceTimerRef.current = null;

            const latestChannelId = getJoinChannelId();
            const myUserId = String(localIdentity || getStoredUserId() || "");
            const latestPresence =
              latestChannelId && myUserId
                ? (voicePresenceMap[latestChannelId] || []).find(
                    (item) => String(item.userId) === myUserId
                  ) || null
                : null;

            if (latestPresence || joinInFlightRef.current || disconnectingRef.current) {
              hadServerPresenceRef.current = Boolean(latestPresence);
              return;
            }

            hadServerPresenceRef.current = false;
            void leaveVoice({ preserveServerReconnect: false });
          }, 900);
        }
      } else if (localPresence && missingServerPresenceTimerRef.current) {
        window.clearTimeout(missingServerPresenceTimerRef.current);
        missingServerPresenceTimerRef.current = null;
      }
    }
  }, [mode, isConnected, currentPresenceList, localIdentity, activeVoiceChannelId, voicePresenceMap]);

  useEffect(() => {
    if (mode !== "dm") return;

    window.dispatchEvent(
      new CustomEvent(DM_MEDIA_STATE_EVENT_NAME, {
        detail: {
          channelId: getJoinChannelId(),
          muted: isMuted,
          deafened: isDeafened,
          camera: isCameraEnabled || Boolean(getLocalCameraMediaStream()),
          screen: isScreenShareEnabled || Boolean(getLocalScreenShareMediaStream()),
        },
      })
    );
  }, [mode, dmChannelId, dmRoomName, isMuted, isDeafened, isCameraEnabled, isScreenShareEnabled, isConnected]);

  useEffect(() => {
    const handler = (event: Event) => {
      const customEvent = event as CustomEvent<{
        action?: "toggleMute" | "toggleDeafen" | "toggleCamera" | "toggleScreenShare" | "leave";
        channelId?: string | null;
      }>;
      const requestedAction = customEvent.detail?.action ?? null;
      const requestedChannelId = customEvent.detail?.channelId ?? null;
      if (mode !== "dm") return;
      const currentChannelId = getJoinChannelId();
      if (!currentChannelId || requestedChannelId !== currentChannelId) return;

      if (requestedAction === "toggleMute") {
        void handleMuteToggle();
        return;
      }
      if (requestedAction === "toggleDeafen") {
        void handleDeafenToggle();
        return;
      }
      if (requestedAction === "toggleCamera") {
        void handleCameraToggle();
        return;
      }
      if (requestedAction === "toggleScreenShare") {
        void handleScreenShareToggle();
        return;
      }
      if (requestedAction === "leave") {
        void handleLeaveClick();
      }
    };

    window.addEventListener(DM_MEDIA_CONTROL_EVENT_NAME, handler as EventListener);
    return () => {
      window.removeEventListener(DM_MEDIA_CONTROL_EVENT_NAME, handler as EventListener);
    };
  }, [mode, dmChannelId, dmRoomName, isMuted, isScreenShareEnabled, isCameraEnabled, isConnected]);

  useEffect(() => {
    if (mode !== "server") return;

    const handler = (event: Event) => {
      const customEvent = event as CustomEvent<{ channelId?: string | null; userId?: string | null }>;
      const forcedChannelId = String(customEvent.detail?.channelId ?? "");
      const forcedUserId = String(customEvent.detail?.userId ?? getStoredUserId() ?? "");
      const currentUserId = String(localIdentity || getStoredUserId() || "");
      const currentChannelId = String(connectedServerChannelIdRef.current || getJoinChannelId() || "");

      if (!forcedChannelId || !currentChannelId) return;
      if (forcedUserId && currentUserId && forcedUserId !== currentUserId) return;
      if (forcedChannelId !== currentChannelId) return;

      void forceLeaveFromServer("Voice kanaldan atıldın");
    };

    window.addEventListener(FORCE_SERVER_VOICE_LEFT_EVENT_NAME, handler as EventListener);
    return () =>
      window.removeEventListener(
        FORCE_SERVER_VOICE_LEFT_EVENT_NAME,
        handler as EventListener
      );
  }, [mode, localIdentity, activeVoiceChannelId, isConnected]);

  useEffect(() => {
    if (mode !== "server") return;

    const handler = (event: Event) => {
      const customEvent = event as CustomEvent<{ channel?: Channel }>;
      const channel = customEvent.detail?.channel;
      if (!channel || channel.type !== "voice") return;

      requestVoiceConnect(channel.id, channel.id);
    };

    window.addEventListener("vice-join-voice-channel", handler as EventListener);
    return () =>
      window.removeEventListener(
        "vice-join-voice-channel",
        handler as EventListener
      );
  }, [mode, selectedChannel, activeVoiceChannelId]);

  useEffect(() => {
    if (mode !== "server") return;
    if (!selectedChannel || selectedChannel.type !== "voice") return;
    if (!activeVoiceChannelId || selectedChannel.id !== activeVoiceChannelId) return;
    if (roomRef.current || joinInFlightRef.current || disconnectingRef.current) return;

    requestVoiceConnect(selectedChannel.id, selectedChannel.id);
  }, [mode, selectedChannel, activeVoiceChannelId]);

  useEffect(() => {
    if (mode !== "server") return;
    if (!activeVoiceChannelId) return;
    if (!roomRef.current) return;
    if (joinInFlightRef.current || disconnectingRef.current) return;

    const connectedChannelId = connectedServerChannelIdRef.current;
    if (!connectedChannelId || connectedChannelId === activeVoiceChannelId) return;

    requestVoiceConnect(activeVoiceChannelId, activeVoiceChannelId);
  }, [mode, activeVoiceChannelId, selectedChannel]);


  useEffect(() => {
    if (mode !== "dm") return;

    const wasConnecting = lastDmShouldConnectRef.current;
    lastDmShouldConnectRef.current = dmShouldConnect;

    if (!dmActive || !dmRoomName) {
      if (roomRef.current && connectedModeRef.current === "dm") {
        void leaveVoice({ silentForDm: true });
      } else if (connectedModeRef.current !== "server") {
        hardResetLocalVoiceState("DM çağrısı beklemede");
      }
      return;
    }

    if (!dmShouldConnect) {
      if (roomRef.current && connectedModeRef.current === "dm") {
        void leaveVoice({ silentForDm: true });
      } else if (!wasConnecting && connectedModeRef.current !== "server") {
        hardResetLocalVoiceState(
          dmSelfLeft || dmStatus === "left"
            ? "DM görüşmesinden ayrıldın"
            : "DM çağrısı beklemede"
        );
      }

      if (dmStatus === "incoming") {
        setStatus(`${dmDisplayName || "Kullanıcı"} seni arıyor`);
      } else if (dmStatus === "outgoing") {
        setStatus(`${dmDisplayName || "Kullanıcı"} aranıyor`);
      }

      return;
    }

    if (disconnectingRef.current) return;
    requestVoiceConnect(dmRoomName, dmChannelId || dmRoomName);
  }, [
    mode,
    dmActive,
    dmShouldConnect,
    dmRoomName,
    dmChannelId,
    dmSelfLeft,
    dmStatus,
    dmDisplayName,
  ]);

  useEffect(() => {
    const handler = (event: Event) => {
      const customEvent = event as CustomEvent<{ map?: IdentityMap }>;
      setIdentityMap(customEvent.detail?.map || {});
    };

    window.addEventListener(USER_IDENTITY_EVENT_NAME, handler as EventListener);
    return () => {
      window.removeEventListener(USER_IDENTITY_EVENT_NAME, handler as EventListener);
    };
  }, []);

  useEffect(() => {
    syncRemoteVisualLabels();
  }, [identityMap, currentPresenceList]);

  useEffect(() => {
    emitVoiceVisualState(remoteVisualsRef.current, isScreenShareEnabled);
    void emitStreamAnnouncements(remoteVisualsRef.current, isScreenShareEnabled);
  }, [isScreenShareEnabled]);

  useEffect(() => {
    emitVoiceVisualState(remoteVisualsRef.current, isScreenShareEnabled);
    void emitCameraAnnouncement(isCameraEnabled);
  }, [isCameraEnabled]);

  useEffect(() => {
    return () => {
      unmountingRef.current = true;
      clearPreviewCaptureLoop();
      cleanupLocalScreenShareTrackRef(true);
      forceClearCameraAnnouncements();
      void leaveVoice({
        silentForDm: true,
        preserveServerReconnect: connectedModeRef.current === "server",
      });
    };
  }, []);

  const participantCount = useMemo(() => {
    const key = getJoinChannelId();
    if (!key) return 0;
    return (voicePresenceMap[key] || []).length;
  }, [voicePresenceMap, activeVoiceChannelId, dmChannelId, dmRoomName, mode]);

  const isServerMuted = mode === "server" && serverMutedRef.current;
  const isServerDeafened = mode === "server" && serverDeafenedRef.current;
  const muteButtonActive = selfMuted || selfDeafened;
  const deafenButtonActive = selfDeafened;

  const isControlDisabled = !roomRef.current;
  const leaveDisabled = !roomRef.current && !dmActive;

  const outerStyle: React.CSSProperties = {
  marginTop: "auto",
  padding: "10px 10px 12px",
  borderTop: "1px solid #232833",
  background: "transparent",
};

const shellStyle: React.CSSProperties = {
  border: "1px solid rgba(255,255,255,0.05)",
  background: "linear-gradient(180deg, #171a20 0%, #14171d 100%)",
  borderRadius: 16,
  padding: 12,
  boxShadow: "none",
};

  const iconButtonBase: React.CSSProperties = {
    width: 46,
    height: 46,
    minWidth: 46,
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.07)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "#f2f3f5",
    cursor: "pointer",
    transition: "all 0.18s ease",
    boxShadow:
      "inset 0 1px 0 rgba(255,255,255,0.05), 0 8px 18px rgba(0,0,0,0.22)",
    backdropFilter: "blur(10px)",
  };

  const getControlButtonStyle = (
    variant: "default" | "activeRed" | "activeBlue" | "activeGreen" | "danger",
    disabled?: boolean
  ): React.CSSProperties => {
    const styleMap: Record<string, React.CSSProperties> = {
      default: {
        background: "linear-gradient(180deg, #2b2d31 0%, #23252a 100%)",
      },
      activeRed: {
        background: "linear-gradient(135deg, #ed4245 0%, #ff5d63 100%)",
        boxShadow:
          "inset 0 1px 0 rgba(255,255,255,0.08), 0 10px 20px rgba(237,66,69,0.28)",
      },
      activeBlue: {
        background: "linear-gradient(135deg, #5865f2 0%, #7983ff 100%)",
        boxShadow:
          "inset 0 1px 0 rgba(255,255,255,0.08), 0 10px 20px rgba(88,101,242,0.28)",
      },
      activeGreen: {
        background: "linear-gradient(135deg, #23a559 0%, #37c871 100%)",
        boxShadow:
          "inset 0 1px 0 rgba(255,255,255,0.08), 0 10px 20px rgba(35,165,89,0.28)",
      },
      danger: {
        background: "linear-gradient(135deg, #da373c 0%, #f04f55 100%)",
        boxShadow:
          "inset 0 1px 0 rgba(255,255,255,0.08), 0 10px 20px rgba(218,55,60,0.28)",
      },
    };

    return {
      ...iconButtonBase,
      ...styleMap[variant],
      opacity: disabled ? 0.42 : 1,
      cursor: disabled ? "not-allowed" : "pointer",
    };
  };

  const renderIconButton = ({
    icon,
    onClick,
    disabled,
    variant = "default",
  }: {
    icon: React.ReactNode;
    onClick: () => void;
    disabled?: boolean;
    variant?: "default" | "activeRed" | "activeBlue" | "activeGreen" | "danger";
  }) => (
    <button
      onClick={onClick}
      disabled={disabled}
      style={getControlButtonStyle(variant, disabled)}
    >
      {icon}
    </button>
  );

  return (
    <div style={outerStyle}>
      <div style={shellStyle}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginBottom: 12,
          }}
        >
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 14,
              background: isConnected
                ? "linear-gradient(135deg, #5865f2 0%, #7983ff 100%)"
                : "linear-gradient(135deg, #2f3136 0%, #26282d 100%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
              flexShrink: 0,
              boxShadow: isConnected
                ? "0 10px 22px rgba(88,101,242,0.24)"
                : "0 8px 18px rgba(0,0,0,0.18)",
            }}
          >
            <Radio size={18} strokeWidth={2.3} />
          </div>

          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                minWidth: 0,
              }}
            >
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 800,
                  color: "#ffffff",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {mode === "dm"
                  ? dmDisplayName || "DM görüşmesi"
                  : selectedChannel?.name || currentRoomName || "Voice kanal"}
              </div>

              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 999,
                  background: isConnected ? "#23a559" : "#80848e",
                  boxShadow: isConnected
                    ? "0 0 10px rgba(35,165,89,0.45)"
                    : "none",
                  flexShrink: 0,
                }}
              />
            </div>

            <div
              style={{
                marginTop: 4,
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 12,
                color: "#a7adb7",
                minWidth: 0,
              }}
            >
              <span
                style={{
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {mode === "dm"
                  ? status
                  : isConnected
                    ? "Ses bağlantısı aktif"
                    : status}
              </span>

              <span
                style={{
                  padding: "3px 8px",
                  borderRadius: 999,
                  background: "rgba(255,255,255,0.05)",
                  color: "#c9ced6",
                  fontWeight: 700,
                  flexShrink: 0,
                }}
              >
                {participantCount}
              </span>
            </div>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginBottom: 12,
          }}
        >
          
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
          }}
        >
          {renderIconButton({
            icon: muteButtonActive ? (
              <MicOff size={18} strokeWidth={2.3} />
            ) : (
              <Mic size={18} strokeWidth={2.3} />
            ),
            onClick: () => void handleMuteToggle(),
            disabled: isControlDisabled,
            variant: muteButtonActive ? "activeRed" : "default",
          })}

          {renderIconButton({
            icon: deafenButtonActive ? (
              <HeadphoneOff size={18} strokeWidth={2.3} />
            ) : (
              <Headphones size={18} strokeWidth={2.3} />
            ),
            onClick: () => void handleDeafenToggle(),
            disabled: isControlDisabled,
            variant: deafenButtonActive ? "activeRed" : "default",
          })}

          {renderIconButton({
            icon: isCameraEnabled ? (
              <Video size={18} strokeWidth={2.3} />
            ) : (
              <VideoOff size={18} strokeWidth={2.3} />
            ),
            onClick: () => void handleCameraToggle(),
            disabled: isControlDisabled,
            variant: isCameraEnabled ? "activeGreen" : "default",
          })}

          {renderIconButton({
            icon: <MonitorUp size={18} strokeWidth={2.3} />,
            onClick: () => void handleScreenShareToggle(),
            disabled: isControlDisabled,
            variant: isScreenShareEnabled ? "activeBlue" : "default",
          })}

          {renderIconButton({
            icon: <PhoneOff size={18} strokeWidth={2.3} />,
            onClick: () => void handleLeaveClick(),
            disabled: leaveDisabled,
            variant: "danger",
          })}
        </div>
      </div>

      <ScreenShareQualityModal
        open={showScreenShareModal}
        isStarting={isStartingScreenShare}
        resolution={screenShareResolution}
        fps={screenShareFps}
        shareSystemAudio={screenShareSystemAudioEnabled}
        onClose={() => {
          if (isStartingScreenShare) return;
          setShowScreenShareModal(false);
        }}
        onResolutionChange={setScreenShareResolution}
        onFpsChange={setScreenShareFps}
        onShareSystemAudioChange={setScreenShareSystemAudioEnabled}
        onConfirm={() => {
          void startScreenShareWithQuality();
        }}
      />
    </div>
  );
}
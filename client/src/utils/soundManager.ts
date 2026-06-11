export type NotificationSoundKey =
  | "dm-message"
  | "dm-call"
  | "server-message"
  | "voice-join"
  | "voice-leave"
  | "screen-share-start"
  | "screen-share-stop";

type NotificationChannelSetting = {
  enabled: boolean;
  volume: number;
};

export type ServerNotificationSetting = {
  message: NotificationChannelSetting;
};

export type DmNotificationSetting = {
  message: NotificationChannelSetting;
  call: NotificationChannelSetting;
};

const SERVER_SETTINGS_KEY = "vice_server_notification_settings_v1";
const DM_SETTINGS_KEY = "vice_dm_notification_settings_v1";

let audioContext: AudioContext | null = null;

let dmCallInterval: number | null = null;

export function startDmCallLoop(volume = 1) {
  stopDmCallLoop();
  dmCallInterval = window.setInterval(() => {
    void playViceSound("dm-call", volume);
  }, 1200);
}

export function stopDmCallLoop() {
  if (dmCallInterval != null) {
    window.clearInterval(dmCallInterval);
    dmCallInterval = null;
  }
}

function clampVolume(value?: number) {
  const n = Number(value ?? 1);
  if (!Number.isFinite(n)) return 1;
  return Math.max(0, Math.min(1, n));
}

function ensureAudioContext() {
  if (typeof window === "undefined") return null;
  const Ctx = window.AudioContext || (window as any).webkitAudioContext;
  if (!Ctx) return null;
  if (!audioContext) {
    audioContext = new Ctx();
  }
  return audioContext;
}

export async function resumeViceAudioContext() {
  const ctx = ensureAudioContext();
  if (!ctx) return;
  if (ctx.state === "suspended") {
    try {
      await ctx.resume();
    } catch {}
  }
}

function beep({
  frequency,
  durationMs,
  type = "sine",
  volume = 0.3,
  attackMs = 8,
  releaseMs = 90,
  delayMs = 0,
}: {
  frequency: number;
  durationMs: number;
  type?: OscillatorType;
  volume?: number;
  attackMs?: number;
  releaseMs?: number;
  delayMs?: number;
}) {
  const ctx = ensureAudioContext();
  if (!ctx) return;
  const now = ctx.currentTime + delayMs / 1000;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(frequency, now);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume), now + attackMs / 1000);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + durationMs / 1000 + releaseMs / 1000);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + durationMs / 1000 + releaseMs / 1000 + 0.03);
}

export async function playViceSound(sound: NotificationSoundKey, volume = 1) {
  const finalVolume = clampVolume(volume);
  if (finalVolume <= 0) return;

  await resumeViceAudioContext();

  switch (sound) {
    case "dm-message":
      beep({ frequency: 720, durationMs: 42, type: "sine", volume: 0.12 * finalVolume });
      beep({ frequency: 960, durationMs: 56, type: "triangle", volume: 0.07 * finalVolume, delayMs: 34 });
      return;
    case "dm-call":
      beep({ frequency: 540, durationMs: 180, type: "sine", volume: 0.14 * finalVolume });
      beep({ frequency: 720, durationMs: 180, type: "sine", volume: 0.12 * finalVolume, delayMs: 210 });
      return;
    case "server-message":
      beep({ frequency: 610, durationMs: 38, type: "triangle", volume: 0.11 * finalVolume });
      beep({ frequency: 820, durationMs: 52, type: "triangle", volume: 0.065 * finalVolume, delayMs: 24 });
      return;
    case "voice-join":
      beep({ frequency: 520, durationMs: 55, type: "sine", volume: 0.12 * finalVolume });
      beep({ frequency: 760, durationMs: 72, type: "sine", volume: 0.08 * finalVolume, delayMs: 48 });
      return;
    case "voice-leave":
      beep({ frequency: 760, durationMs: 55, type: "sine", volume: 0.11 * finalVolume });
      beep({ frequency: 520, durationMs: 74, type: "sine", volume: 0.07 * finalVolume, delayMs: 44 });
      return;
    case "screen-share-start":
      beep({ frequency: 560, durationMs: 48, type: "triangle", volume: 0.11 * finalVolume });
      beep({ frequency: 760, durationMs: 56, type: "triangle", volume: 0.085 * finalVolume, delayMs: 34 });
      beep({ frequency: 980, durationMs: 62, type: "triangle", volume: 0.065 * finalVolume, delayMs: 70 });
      return;
    case "screen-share-stop":
      beep({ frequency: 980, durationMs: 42, type: "triangle", volume: 0.09 * finalVolume });
      beep({ frequency: 760, durationMs: 48, type: "triangle", volume: 0.072 * finalVolume, delayMs: 36 });
      beep({ frequency: 560, durationMs: 58, type: "triangle", volume: 0.058 * finalVolume, delayMs: 72 });
      return;
  }
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return { ...fallback, ...JSON.parse(raw) };
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

const defaultChannel = (): NotificationChannelSetting => ({ enabled: true, volume: 1 });
const defaultServer = (): ServerNotificationSetting => ({ message: defaultChannel() });
const defaultDm = (): DmNotificationSetting => ({ message: defaultChannel(), call: defaultChannel() });

export function getServerNotificationSettings(serverId?: string | null): ServerNotificationSetting {
  if (!serverId) return defaultServer();
  const map = readJson<Record<string, Partial<ServerNotificationSetting>>>(SERVER_SETTINGS_KEY, {});
  const stored = map[String(serverId)] || {};
  return {
    message: { ...defaultChannel(), ...(stored as any).message },
  };
}

export function updateServerNotificationSettings(serverId: string, patch: Partial<ServerNotificationSetting>) {
  const currentMap = readJson<Record<string, Partial<ServerNotificationSetting>>>(SERVER_SETTINGS_KEY, {});
  const current = getServerNotificationSettings(serverId);
  const next = {
    message: { ...current.message, ...(patch.message || {}) },
  };
  currentMap[String(serverId)] = next;
  writeJson(SERVER_SETTINGS_KEY, currentMap);
  return next;
}

export function getDmNotificationSettings(conversationId?: string | null): DmNotificationSetting {
  if (!conversationId) return defaultDm();
  const map = readJson<Record<string, Partial<DmNotificationSetting>>>(DM_SETTINGS_KEY, {});
  const stored = map[String(conversationId)] || {};
  return {
    message: { ...defaultChannel(), ...(stored as any).message },
    call: { ...defaultChannel(), ...(stored as any).call },
  };
}

export function updateDmNotificationSettings(conversationId: string, patch: Partial<DmNotificationSetting>) {
  const currentMap = readJson<Record<string, Partial<DmNotificationSetting>>>(DM_SETTINGS_KEY, {});
  const current = getDmNotificationSettings(conversationId);
  const next = {
    message: { ...current.message, ...(patch.message || {}) },
    call: { ...current.call, ...(patch.call || {}) },
  };
  currentMap[String(conversationId)] = next;
  writeJson(DM_SETTINGS_KEY, currentMap);
  return next;
}


export async function playSound(sound: NotificationSoundKey, volume = 1) {
  return playViceSound(sound, volume);
}

export async function resumeAudioContext() {
  return resumeViceAudioContext();
}



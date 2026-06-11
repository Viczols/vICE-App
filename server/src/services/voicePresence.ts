type VoiceParticipant = {
  userId: string;
  channelId: string;
  joinedAt: number;
  muted: boolean;
  deafened: boolean;
};

class VoicePresenceService {
  private participants = new Map<string, VoiceParticipant>();

  getAll() {
    return Array.from(this.participants.values());
  }

  getByChannel(channelId: string) {
    return this.getAll().filter((p) => p.channelId === channelId);
  }

  getByUserId(userId: string) {
    return this.participants.get(userId) ?? null;
  }

  join(userId: string, channelId: string) {
    const existing = this.participants.get(userId);

    const participant: VoiceParticipant = {
      userId,
      channelId,
      joinedAt:
        existing && existing.channelId === channelId
          ? existing.joinedAt
          : Date.now(),
      muted: existing?.muted ?? false,
      deafened: existing?.deafened ?? false,
    };

    this.participants.set(userId, participant);
    return participant;
  }

  leave(userId: string) {
    const existing = this.participants.get(userId);
    if (!existing) return null;

    this.participants.delete(userId);
    return existing;
  }

  move(userId: string, channelId: string) {
    const existing = this.participants.get(userId);
    if (!existing) return null;

    const moved: VoiceParticipant = {
      ...existing,
      channelId,
      joinedAt: Date.now(),
    };

    this.participants.set(userId, moved);
    return {
      previous: existing,
      current: moved,
    };
  }

  setMuted(userId: string, muted: boolean) {
    const existing = this.participants.get(userId);
    if (!existing) return null;

    existing.muted = muted;
    return existing;
  }

  setDeafened(userId: string, deafened: boolean) {
    const existing = this.participants.get(userId);
    if (!existing) return null;

    existing.deafened = deafened;
    return existing;
  }

  setServerState(userId: string, state: { muted?: boolean; deafened?: boolean }) {
    const existing = this.participants.get(userId);
    if (!existing) return null;

    if (typeof state.muted === "boolean") {
      existing.muted = state.muted;
    }

    if (typeof state.deafened === "boolean") {
      existing.deafened = state.deafened;
    }

    return existing;
  }
}

export const voicePresence = new VoicePresenceService();
export type { VoiceParticipant };

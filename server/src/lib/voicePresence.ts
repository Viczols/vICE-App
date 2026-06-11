export type VoicePresenceParticipant = {
  userId: string;
  channelId: string;
  joinedAt: number;
  muted: boolean;
  deafened: boolean;
};

export type VoiceVisualItem = {
  trackSid: string;
  source: "camera" | "screen";
  active: boolean;
  updatedAt: number;
};

export type VoiceVisualParticipantState = {
  userId: string;
  channelId: string;
  visuals: VoiceVisualItem[];
  updatedAt: number;
};

class VoicePresenceStore {
  private participantsByUser = new Map<string, VoicePresenceParticipant>();
  private visualsByKey = new Map<string, VoiceVisualParticipantState>();

  private getVisualKey(channelId: string, userId: string) {
    return `${channelId}::${userId}`;
  }

  private normalizeVisuals(
    visuals: Array<{
      trackSid?: string;
      source?: "camera" | "screen";
      active?: boolean;
    }>
  ): VoiceVisualItem[] {
    const now = Date.now();
    const seen = new Set<string>();
    const next: VoiceVisualItem[] = [];

    for (const item of visuals) {
      const trackSid = String(item?.trackSid ?? "").trim();
      if (!trackSid || seen.has(trackSid)) continue;
      seen.add(trackSid);

      next.push({
        trackSid,
        source: item?.source === "screen" ? "screen" : "camera",
        active: item?.active !== false,
        updatedAt: now,
      });
    }

    return next;
  }

  get(userId: string) {
    return this.participantsByUser.get(userId) ?? null;
  }

  getAll() {
    return Array.from(this.participantsByUser.values());
  }

  getByChannel(channelId: string) {
    return this.getAll().filter((participant) => participant.channelId === channelId);
  }

  join(channelId: string, userId: string) {
    const existing = this.participantsByUser.get(userId) ?? null;

    if (existing && existing.channelId !== channelId) {
      this.clearVisualsForUser(userId, existing.channelId);
    }

    const nextParticipant: VoicePresenceParticipant = {
      userId,
      channelId,
      joinedAt: existing?.channelId === channelId ? existing.joinedAt : Date.now(),
      muted: existing?.channelId === channelId ? existing.muted : false,
      deafened: existing?.channelId === channelId ? existing.deafened : false,
    };

    this.participantsByUser.set(userId, nextParticipant);
    return nextParticipant;
  }

  leave(userId: string) {
    const existing = this.participantsByUser.get(userId) ?? null;
    if (!existing) return null;

    this.participantsByUser.delete(userId);
    this.clearVisualsForUser(userId, existing.channelId);
    return existing;
  }

  updateState(
    userId: string,
    patch: Partial<Pick<VoicePresenceParticipant, "muted" | "deafened">>
  ) {
    const existing = this.participantsByUser.get(userId) ?? null;
    if (!existing) return null;

    const nextParticipant: VoicePresenceParticipant = {
      ...existing,
      muted: typeof patch.muted === "boolean" ? patch.muted : existing.muted,
      deafened:
        typeof patch.deafened === "boolean" ? patch.deafened : existing.deafened,
    };

    this.participantsByUser.set(userId, nextParticipant);
    return nextParticipant;
  }

  upsertVisuals(
    channelId: string,
    userId: string,
    visuals: Array<{
      trackSid?: string;
      source?: "camera" | "screen";
      active?: boolean;
    }>
  ) {
    const normalized = this.normalizeVisuals(visuals);
    const key = this.getVisualKey(channelId, userId);

    if (normalized.length === 0) {
      this.visualsByKey.delete(key);
      return null;
    }

    const nextState: VoiceVisualParticipantState = {
      channelId,
      userId,
      visuals: normalized,
      updatedAt: Date.now(),
    };

    this.visualsByKey.set(key, nextState);
    return nextState;
  }

  getVisualsByChannel(channelId: string) {
    return Array.from(this.visualsByKey.values()).filter(
      (state) => state.channelId === channelId
    );
  }

  getAllVisuals() {
    return Array.from(this.visualsByKey.values());
  }

  clearVisualsForUser(userId: string, channelId?: string | null) {
    const cleared: VoiceVisualParticipantState[] = [];

    for (const [key, state] of this.visualsByKey.entries()) {
      if (state.userId !== userId) continue;
      if (channelId && state.channelId !== channelId) continue;

      this.visualsByKey.delete(key);
      cleared.push(state);
    }

    return cleared;
  }

  clearChannel(channelId: string) {
    const removedParticipants: VoicePresenceParticipant[] = [];
    const removedVisuals: VoiceVisualParticipantState[] = [];

    for (const participant of this.participantsByUser.values()) {
      if (participant.channelId !== channelId) continue;
      this.participantsByUser.delete(participant.userId);
      removedParticipants.push(participant);
    }

    for (const [key, state] of this.visualsByKey.entries()) {
      if (state.channelId !== channelId) continue;
      this.visualsByKey.delete(key);
      removedVisuals.push(state);
    }

    return {
      removedParticipants,
      removedVisuals,
    };
  }

  buildVisualSnapshot() {
    const visualsByChannel: Record<string, VoiceVisualParticipantState[]> = {};

    for (const state of this.visualsByKey.values()) {
      if (!visualsByChannel[state.channelId]) {
        visualsByChannel[state.channelId] = [];
      }

      visualsByChannel[state.channelId].push(state);
    }

    return { visualsByChannel };
  }
}

export const voicePresence = new VoicePresenceStore();

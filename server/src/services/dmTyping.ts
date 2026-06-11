type TypingEntry = {
  timeout: NodeJS.Timeout;
};

const DEFAULT_TYPING_TIMEOUT_MS = 1500;

// conversationId -> userId -> entry
const typingState = new Map<string, Map<string, TypingEntry>>();

function getConversationMap(conversationId: string) {
  let conversationMap = typingState.get(conversationId);

  if (!conversationMap) {
    conversationMap = new Map<string, TypingEntry>();
    typingState.set(conversationId, conversationMap);
  }

  return conversationMap;
}

function cleanupConversationIfEmpty(conversationId: string) {
  const conversationMap = typingState.get(conversationId);
  if (!conversationMap || conversationMap.size > 0) return;
  typingState.delete(conversationId);
}

export function isUserTypingInConversation(userId: string, conversationId: string) {
  const conversationMap = typingState.get(conversationId);
  if (!conversationMap) return false;
  return conversationMap.has(userId);
}

export function startTyping(
  userId: string,
  conversationId: string,
  onAutoStop?: () => void,
  timeoutMs = DEFAULT_TYPING_TIMEOUT_MS
) {
  const conversationMap = getConversationMap(conversationId);
  const existing = conversationMap.get(userId);

  if (existing?.timeout) {
    clearTimeout(existing.timeout);
  }

  const timeout = setTimeout(() => {
    const currentMap = typingState.get(conversationId);
    if (!currentMap) return;

    const currentEntry = currentMap.get(userId);
    if (!currentEntry) return;

    currentMap.delete(userId);
    cleanupConversationIfEmpty(conversationId);

    if (onAutoStop) {
      onAutoStop();
    }
  }, timeoutMs);

  conversationMap.set(userId, { timeout });

  return {
    wasAlreadyTyping: Boolean(existing),
  };
}

export function stopTyping(userId: string, conversationId: string) {
  const conversationMap = typingState.get(conversationId);
  if (!conversationMap) {
    return { removed: false };
  }

  const existing = conversationMap.get(userId);
  if (!existing) {
    return { removed: false };
  }

  clearTimeout(existing.timeout);
  conversationMap.delete(userId);
  cleanupConversationIfEmpty(conversationId);

  return { removed: true };
}

export function stopTypingEverywhereForUser(userId: string) {
  const stoppedConversationIds: string[] = [];

  for (const [conversationId, conversationMap] of typingState.entries()) {
    const entry = conversationMap.get(userId);
    if (!entry) continue;

    clearTimeout(entry.timeout);
    conversationMap.delete(userId);
    cleanupConversationIfEmpty(conversationId);
    stoppedConversationIds.push(conversationId);
  }

  return stoppedConversationIds;
}

export function getTypingUserIds(conversationId: string) {
  const conversationMap = typingState.get(conversationId);
  if (!conversationMap) return [];
  return Array.from(conversationMap.keys());
}

export function clearAllTypingState() {
  for (const conversationMap of typingState.values()) {
    for (const entry of conversationMap.values()) {
      clearTimeout(entry.timeout);
    }
  }

  typingState.clear();
}
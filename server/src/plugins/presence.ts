type PresenceUser = {
  userId: string;
  displayName: string;
};

const onlineUsers = new Map<string, PresenceUser>();

export function addOnlineUser(userId: string, displayName: string) {
  onlineUsers.set(userId, { userId, displayName });
}

export function removeOnlineUser(userId: string) {
  onlineUsers.delete(userId);
}

export function getOnlineUsers() {
  return Array.from(onlineUsers.values());
}
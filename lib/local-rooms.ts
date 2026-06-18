export type LocalRoom = {
  id: string;
  playerName: string;
  label: string;
  savedAt: number;
};

const roomsStorageKey = "foodmatch:rooms";

export function playerStorageKey(roomId: string) {
  return `foodmatch:room:${roomId}:player`;
}

export function getLocalRooms() {
  if (typeof window === "undefined") return [];

  const rawRooms = window.localStorage.getItem(roomsStorageKey);
  if (!rawRooms) return [];

  try {
    const rooms = JSON.parse(rawRooms);
    if (!Array.isArray(rooms)) return [];

    return rooms.filter((room): room is LocalRoom => {
      return (
        typeof room?.id === "string" &&
        typeof room?.playerName === "string" &&
        typeof room?.label === "string" &&
        typeof room?.savedAt === "number"
      );
    });
  } catch (error) {
    console.warn("Unable to read saved FoodMatch rooms. Resetting local room list.", error);
    window.localStorage.removeItem(roomsStorageKey);
    return [];
  }
}

export function saveLocalRoom(room: Omit<LocalRoom, "savedAt">) {
  if (typeof window === "undefined") return [];

  const nextRoom: LocalRoom = { ...room, savedAt: Date.now() };
  const rooms = [nextRoom, ...getLocalRooms().filter((item) => item.id !== room.id)];
  window.localStorage.setItem(roomsStorageKey, JSON.stringify(rooms));
  window.localStorage.setItem(playerStorageKey(room.id), room.playerName);
  return rooms;
}

export function removeLocalRoom(roomId: string) {
  if (typeof window === "undefined") return [];

  window.localStorage.removeItem(playerStorageKey(roomId));
  const rooms = getLocalRooms().filter((room) => room.id !== roomId);
  window.localStorage.setItem(roomsStorageKey, JSON.stringify(rooms));
  return rooms;
}

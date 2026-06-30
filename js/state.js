// Tiny shared state + event bus used across modules.

export const app = {
  view: "auth",          // auth | games | game | editor | builder
  user: null,
  currentGameId: null,   // active game
  currentGameName: "",
  currentFolderId: null, // selected folder filter: null=All, "unfiled", or a folder id
  // editor working state
  editor: {
    id: null,            // template id (null = new)
    name: "",
    width: 750,
    height: 1050,
    gameId: null,
  },
  // builder working state
  builder: {
    id: null,            // card id (null = new)
    name: "",
    template: null,      // the loaded template row
    gameId: null,
    folderId: null,
  },
};

const listeners = {};

export function on(event, cb) {
  (listeners[event] ||= []).push(cb);
  return () => {
    listeners[event] = (listeners[event] || []).filter((f) => f !== cb);
  };
}

export function emit(event, payload) {
  (listeners[event] || []).forEach((cb) => cb(payload));
}

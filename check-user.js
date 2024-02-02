const { get, set } = require("./db");
const profiles = require("./profiles.json");

module.exports = (username) => {
  if (!username || !profiles[username]) return;
  const users = get("users") || {};
  const r = get("rooms") || {};
  const u = users[profiles[username].id] || {};
  const defaultSettings = {
    theme: false,
    accent: true,
    emoji: true,
    notifications: {},
    notificationSound: "Bounce",
    dontDisturb: false,
  };
  const user = {
    ...profiles[username],
    room: r[u.room] ? u.room : "main",
    unread: typeof u.unread == "object" ? u.unread : [],
    settings:
      typeof u.settings != "undefined" && Object.keys(u.settings).length > 0
        ? u.settings
        : defaultSettings,
    menu: typeof u.menu != "undefined" ? u.menu : true,
    camera: false,
    audio: false,
  };
  Object.keys(defaultSettings).forEach((k) => {
    if (typeof user.settings[k] != typeof defaultSettings[k])
      user.settings[k] = defaultSettings[k];
  });
  if (r[u.room]?.allowed != "all" && !r[u.room]?.allowed.includes(u.id))
    user.room = "main";
  return user;
};

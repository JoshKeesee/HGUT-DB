const cookie = require("cookie");
const { get, set } = require("./db");
const profiles = require("./profiles.json");

module.exports = (socket, next) => {
  const h = socket.handshake.query;
  if (!h.user) return next();
  const username = cookie.parse(h.user)["user"];
  if (username) {
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
    socket.user = {
      ...profiles[username],
      room: r[u.room] ? u.room : "main",
      unread: typeof u.unread == "object" ? u.unread : [],
      settings: typeof u.settings != "undefined" ? u.settings : defaultSettings,
      menu: typeof u.menu != "undefined" ? u.menu : true,
      camera: false,
      audio: false,
    };
    Object.keys(defaultSettings).forEach((k) => {
      if (typeof socket.user.settings[k] != typeof defaultSettings[k])
        socket.user.settings[k] = defaultSettings[k];
    });
    if (r[u.room].allowed != "all" && !r[u.room].allowed.includes(u.id))
      socket.user.room = "main";
  }
  next();
};

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
    socket.user = {
      ...profiles[username],
      room: r[u.room] ? u.room : "main",
      unread: u.unread?.length > 0 ? u.unread : [],
      settings:
        typeof u.settings != "undefined"
          ? u.settings
          : {
              theme: false,
              accent: true,
              emoji: true,
              notifications: {},
            },
      menu: typeof u.menu != "undefined" ? u.menu : true,
      camera: false,
      audio: false,
    };
    if (typeof socket.user.settings.notifications == "boolean")
      socket.user.settings.notifications = {};
    if (r[u.room].allowed != "all" && !r[u.room].allowed.includes(u.id))
      socket.user.room = "main";
  }
  next();
};

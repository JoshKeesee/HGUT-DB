const cookie = require("cookie");
const checkUser = require("./check-user");

module.exports = (socket, next) => {
  const h = socket.handshake.headers;
  if (!h.user) return next();
  const username = cookie.parse(h.user)["user"];
  socket.user = checkUser(username);
  next();
};

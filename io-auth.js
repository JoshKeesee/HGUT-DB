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
			room: r[u.room] ? u.room : Object.keys(r)[0],
			unread: u.unread?.length > 0 ? u.unread : [],
			theme: typeof u.theme != "undefined" ? u.theme : false,
			menu: typeof u.menu != "undefined" ? u.menu : true,
			camera: false,
			audio: false,
		};
	}
	next();
}
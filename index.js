const express = require("express");
const app = express();
const server = require("http").createServer(app);
const io = require("socket.io")(server, {
	cors: {
		origin: "*",
		methods: ["GET", "POST"],
	},
});
const { get, set } = require("./db");
const fs = require("fs");
const dotenv = require("dotenv");
dotenv.config();
const bcrypt = require("bcrypt");
const webpush = require("web-push");
const pushKeys = {
  public: process.env.PUBLIC_KEY,
  private: process.env.PRIVATE_KEY,
};
webpush.setVapidDetails(
  "mailto:joshuakeesee1@gmail.com",
  pushKeys.public,
  pushKeys.private
);
const profiles = require("./profiles.json");
Object.keys(profiles).forEach((p) => {
  if (profiles[p].setPassword) {
    profiles[p].password = bcrypt.hashSync(profiles[p].setPassword, 10);
    delete profiles[p].setPassword;
    profiles[p].hasPassword = true;
  } else if (!profiles[p].hasPassword)
    profiles[p].password = bcrypt.hashSync("password", 10);
});
fs.writeFileSync("profiles.json", JSON.stringify(profiles, null, 2));
const ioAuth = require("./io-auth");
const p = "./profiles";
const im = "./images";
const maxMessages = 50;
const online = {},
  switched = {},
  typing = {};

const setup = () => {
  if (!fs.existsSync(p)) fs.mkdirSync(p);
  if (!fs.existsSync(im)) fs.mkdirSync(im);
  if (!get("rooms"))
    set({
      rooms: {
        main: {
          name: "Main",
          messages: [],
          allowed: "all",
        },
        writers: {
          name: "Writers",
          messages: [],
          allowed: "all",
        },
        disease: {
          name: '"The Disease"',
          messages: [],
          allowed: [2, 3, 4, 6],
        },
      },
    });
  if (!get("users")) set({ users: {} });
  Object.keys(get("rooms")).forEach((k) => (typing[k] = []));
};

setup();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(__dirname + "/public"));
app.use("/profiles", express.static(__dirname + "/profiles"));
app.use("/images", express.static(__dirname + "/images"));
app.post("/subscribe", (req, res) => {
  if (!req.user) return res.status(201).json({});
  const subscriptions = get("subscriptions") || {};
  const s = req.body;
  if (!subscriptions[req.user.id]) subscriptions[req.user.id] = [];
  if (!subscriptions[req.user.id].length)
    subscriptions[req.user.id] = [subscriptions[req.user.id]];
  if (subscriptions[req.user.id].includes(s)) return;
  subscriptions[req.user.id].push(s);
  set({ subscriptions });
  res.status(201).json({});
});
app.post("/message", (req, res) => {
  if (!req.user) return res.status(201).json({});
  const r = req.body;
  req.user.room = r.room;
  sendMessage(r.message, req.user, "chat", true);
});
app.get("/p", (req, res) => {
	res.json(profiles);
});

io.of("chat").use(ioAuth);
io.of("voice").use(ioAuth);

io.of("voice").on("connection", (socket) => {
  if (!socket.user) return socket.emit("redirect", "/login");
  const curr = "voice";
  if (!online[curr]) online[curr] = {};
  const o = online[curr];
  o[socket.user.id] = { visible: true, room: socket.user.room };

  io.of(curr).emit("online", o);
  socket.emit("profiles", profiles);

  socket.on("theme", (t) => (socket.user.theme = t));
  socket.on("visible", (v) => {
    if (!o[socket.user.id])
      o[socket.user.id] = { visible: false, room: socket.user.room };
    o[socket.user.id].visible = v;
    io.of(curr).emit("online", o);
  });
  socket.on("camera", (c) => {
    socket.user.camera = c;
    switched[socket.user.peerId].camera = c;
    socket.broadcast.emit("camera", [c, socket.user.peerId]);
  });
  socket.on("audio", (a) => {
    socket.user.audio = a;
    switched[socket.user.peerId].audio = a;
    socket.broadcast.emit("audio", [a, socket.user.peerId]);
  });
  socket.on("present", (p) => {
    socket.user.present = p;
    switched[socket.user.peerId].present = p;
    io.of(curr).emit("switched", switched);
    socket.broadcast.emit("add person", [p, socket.user.peerId, true]);
  });

  socket.on("id", (id) => {
    socket.user.peerId = id;
    switched[socket.user.peerId] = {
      camera: socket.user.camera,
      audio: socket.user.audio,
      id: socket.user.id,
    };
    socket.emit("user", socket.user);
    io.of(curr).emit("switched", switched);
    socket.broadcast.emit("add person", socket.user);
  });

  socket.on("chat message", (message) => {
    sendMessage(message, socket.user, curr);
  });

  socket.on("get switched", (cb) => cb(switched));

  socket.on("disconnect", () => {
    delete o[socket.user.id];
    delete switched[socket.user.peerId];
    socket.broadcast.emit("remove person", socket.user);
    socket.broadcast.emit("online", o);
    socket.broadcast.emit("switched", switched);
  });
});

io.of("chat").on("connection", (socket) => {
  if (!socket.user) return socket.emit("redirect", "/login");
  socket.user.sid = socket.id;
  const users = get("users") || {};
  users[socket.user.id] = socket.user;
  set({ users });
  const curr = "chat";
  if (!online[curr]) online[curr] = {};
  const o = online[curr];
  o[socket.user.id] = { visible: true, room: socket.user.room };

  socket.join(socket.user.room);
  socket.emit("user", socket.user);
  const cr = {};
  const r = get("rooms") || {};
  Object.keys(r).forEach((k) => {
    const v = r[k];
    if (socket.user.room == k) v.messages = v.messages.slice(-maxMessages);
    else delete v.messages;
    cr[k] = v;
  });
  socket.emit("rooms", [cr, profiles]);
  socket.emit("typing", typing[socket.user.room]);
  socket.emit("unread", socket.user.unread);
  io.of(curr).emit("online", o);

  socket.on("theme", (t) => (socket.user.theme = t));
  socket.on("visible", (v) => {
    if (!o[socket.user.id])
      o[socket.user.id] = { visible: true, room: socket.user.room };
    o[socket.user.id].visible = v;
    io.of(curr).emit("online", o);
  });
  socket.on("typing", (t) => {
    if (t && !typing[socket.user.room].includes(socket.user.id))
      typing[socket.user.room].push(socket.user.id);
    else if (!t && typing[socket.user.room].includes(socket.user.id))
      typing[socket.user.room].splice(
        typing[socket.user.room].indexOf(socket.user.id),
        1
      );
    io.of(curr).to(socket.user.room).emit("typing", typing[socket.user.room]);
  });

  socket.on("disconnect", () => {
    const users = get("users") || {};
    users[socket.user.id] = socket.user;
    delete o[socket.user.id];
    if (typing[socket.user.room].includes(socket.user.id))
      typing[socket.user.room].splice(
        typing[socket.user.room].indexOf(socket.user.id),
        1
      );
    io.of(curr).to(socket.user.room).emit("typing", typing[socket.user.room]);
    io.of(curr).emit("online", o);
    set({ users });
  });

  socket.on("chat message", (message) => {
    sendMessage(message, socket.user, curr);
  });

  socket.on("load messages", (lm) => {
    const rooms = get("rooms");
    const m = rooms[socket.user.room].messages;
    socket.emit(
      "load messages",
      m.slice(
        Math.max(0, m.length - lm - maxMessages),
        Math.max(0, m.length - lm)
      )
    );
  });

  socket.on("join room", (room, cb) => {
    const rooms = get("rooms");
    if (!rooms[room]) {
      const u = room.split("-").map((e) => Number(e));
      if (rooms[u[1] + "-" + u[0]]) room = u[1] + "-" + u[0];
      else if (u[0] == socket.user.id || u[1] == socket.user.id) {
        typing[room] = [];
        rooms[room] = {
          name: room,
          messages: [],
          allowed: u,
        };
        set({ rooms });
      } else return;
    }
    if (
      !rooms[room].allowed.includes(socket.user.id) &&
      rooms[room].allowed != "all"
    )
      return;
    if (typing[socket.user.room].includes(socket.user.id))
      typing[socket.user.room].splice(
        typing[socket.user.room].indexOf(socket.user.id),
        1
      );
    socket.leave(socket.user.room);
    io.of(curr).to(socket.user.room).emit("typing", typing[socket.user.room]);
    socket.user.room = room;
    if (!o[socket.user.id])
      o[socket.user.id] = { visible: true, room: socket.user.room };
    o[socket.user.id].room = socket.user.room;
    io.of(curr).emit("online", o);
    socket.join(socket.user.room);
    if (socket.user.unread.includes(socket.user.room))
      socket.user.unread.splice(
        socket.user.unread.indexOf(socket.user.room),
        1
      );
    const users = get("users") || {};
    users[socket.user.id] = socket.user;
    set({ users });
    socket.emit("typing", typing[socket.user.room]);
    socket.emit("join room", [
      rooms[socket.user.room].messages.slice(-maxMessages),
      room,
      socket.user.unread,
    ]);
  });
});

const upload = (file) => {
  if (!file.includes("data:")) return file;
  const ext = file.split(";")[0].split("/")[1];
  const length = fs.readdirSync(im).length;
  const name = im + "/" + length + "." + ext;
  fs.writeFileSync(name, Buffer.from(file.split(",")[1], "base64"));
  return name.replace(".", "");
};

const sendMessage = (message, us, curr, p = false) => {
  const o = online[curr];
  let isImage = false;
  if (!message) return;
  if (message.includes("data:")) {
    message = upload(message);
    isImage = true;
  }
  if (message.length > 250) return;
  if (curr == "chat") {
    const rooms = get("rooms");
    rooms[us.room].messages.push({ message, name: us.name, date: new Date() });
    set({ rooms });
    const users = get("users") || {};
    const subscriptions = get("subscriptions") || {};
    const a =
      rooms[us.room].allowed == "all"
        ? Object.keys(users)
        : rooms[us.room].allowed;
    a.forEach((a) => {
      const u = users[a];
      if (!u) return;
      if (subscriptions[u.id] && !o[u.id]?.visible) {
        const n = rooms[us.room].name;
        const payload = JSON.stringify({
          title: `${us.name}${!rooms[n] ? " in " + n : ""}`,
          body: `${!isImage ? message : " sent an image"}`,
          image: isImage ? message : false,
          icon: profiles[us.name].profile,
          tag: us.room,
          actions: [
            {
              title: "Reply",
              action: "reply",
              type: "text",
            },
          ],
        });
        if (!subscriptions[u.id].length)
          subscriptions[u.id] = [subscriptions[u.id]];
        subscriptions[u.id].forEach((e) => {
          webpush.sendNotification(e, payload).catch((e) => {});
        });
      }
      if (!o[u.id] || u.id == us.id || u.room == us.room) return;
      if (!u.unread) u.unread = [];
      if (!u.unread.includes(us.room)) {
        u.unread.push(us.room);
      }
      io.of(curr).to(u.sid).emit("unread", u.unread);
    });
    set({ users });
    if (typing[us.room].includes(us.id) && !p)
      typing[us.room].splice(typing[us.room].indexOf(us.id), 1);
    if (!p) io.of(curr).to(us.room).emit("typing", typing[us.room]);
    io.of(curr).to(us.room).emit("chat message", [message, us, new Date()]);
  } else io.of(curr).emit("chat message", [message, us, new Date()]);
};

server.listen(3000, () => {
  console.log("Listening on port 3000");
});

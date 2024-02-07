const express = require("express");
const app = express();
const cors = require("cors");
const server = require("http").createServer(app);
const io = require("socket.io")(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});
const { get, set } = require("./db");
const checkUser = require("./check-user");
const fs = require("fs");
const dotenv = require("dotenv");
dotenv.config();
const bcrypt = require("bcrypt");
const webpush = require("web-push");
const { execSync, spawn } = require("child_process");
const pushKeys = {
  public: process.env.PUBLIC_KEY,
  private: process.env.PRIVATE_KEY,
};
webpush.setVapidDetails(
  "mailto:joshuakeesee1@gmail.com",
  pushKeys.public,
  pushKeys.private,
);
const profiles = require("./profiles.json");
const accessCode = bcrypt.hashSync(process.env.ACCESS_CODE, 10);
Object.keys(profiles).forEach((p) => {
  if (profiles[p].setPassword) {
    profiles[p].password = bcrypt.hashSync(profiles[p].setPassword, 10);
    delete profiles[p].setPassword;
    profiles[p].hasPassword = true;
  } else if (!profiles[p].password)
    profiles[p].password = bcrypt.hashSync("password", 10);
});
const filterProfiles = () => {
  const p = Object.keys(profiles);
  const ret = {};
  p.forEach((k) => {
    const dismiss = ["password", "setPassword", "hasPassword"];
    const p = Object.keys(profiles[k]).filter((k) => !dismiss.includes(k));
    p.forEach((j) => {
      if (!ret[k]) ret[k] = {};
      ret[k][j] = profiles[k][j];
    });
  });
  return ret;
};
let fp = filterProfiles();
fs.writeFileSync("profiles.json", JSON.stringify(profiles, null, 2));
const sounds = [];
fs.readdirSync("./sounds").forEach((f) => sounds.push(f.split(".")[0]));
const ioAuth = require("./io-auth");
const p = "./profiles";
const im = "./images";
const online = {},
  switched = {},
  typing = {},
  callList = [],
  maxMessages = 50;

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
        eth: {
          name: '"Eth"',
          messages: [],
          allowed: "all",
        },
      },
    });
  if (!get("users")) set({ users: {} });
  const r = get("rooms");
  if (!r["eth"])
    r["eth"] = {
      name: '"Eth"',
      messages: [],
      allowed: "all",
    };
  if (!r["oldtimeycommunication"])
    r["oldtimeycommunication"] = {
      name: "Old Timey Communication",
      messages: [],
      allowed: [0, 2, 3, 6, 8],
    };
  set("rooms", r);
  updateMessageIds();
  Object.keys(get("rooms")).forEach((k) => (typing[k] = []));
};

const updateMessageIds = () => {
  const r = get("rooms");
  Object.keys(r).forEach((k) => r[k].messages.forEach((m, i) => (m.id = i)));
  set({ rooms: r });
};

const getAllowedFiles = (u) => {
  const r = get("rooms");
  const a = Object.keys(r).filter(
    (k) => r[k].allowed == "all" || r[k].allowed.includes(u.id),
  );
  const files = [];
  a.forEach((k) => {
    r[k].messages.forEach((m) => {
      if (m.message.startsWith("/images/"))
        files.push({
          name: m.message.replace("/images/", ""),
          url: m.message.replace("/images/", "images/"),
          room: k,
        });
    });
  });
  return [...new Set(files)];
};

setup();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(__dirname + "/public"));
app.use(cors());
app.use("/profiles", express.static(__dirname + "/profiles"));
app.use("/images", express.static(__dirname + "/images"));
app.use("/sounds", express.static(__dirname + "/sounds"));
app.post("/subscribe", (req, res) => {
  const user = fp[req.body.user];
  if (!user) return res.status(201).json({});
  const subscriptions = get("subscriptions") || {};
  const s = req.body.subscription;
  if (!subscriptions[user.id]) subscriptions[user.id] = {};
  subscriptions[user.id][req.body.deviceId] = s;
  set({ subscriptions });
  res.status(201).json({});
});
app.post("/message", (req, res) => {
  if (!req.body.user) return res.status(201).json({});
  const r = req.body;
  r.user.room = r.room;
  sendMessage(r.message, r.user, "chat", true);
});
app.get("/p", (req, res) => {
  res.json(fp);
});
app.post("/p", (req, res) => {
  const r = req.body;
  const ret = {};
  if (r.passwords) ret.profiles = profiles;
  else ret.profiles = fp;
  if (r.accessCode) ret.accessCode = accessCode;
  res.json(ret);
});
app.post("/user-data", (req, res) => {
  const id =
    profiles[Object.keys(profiles).find((k) => profiles[k].id == req.body.user)]
      .name;
  const u = checkUser(id);
  if (!u) return res.status(201).json({ error: true });
  const cr = {};
  const r = get("rooms") || {};
  Object.keys(r).forEach((k) => {
    const v = r[k];
    delete v.messages;
    if (v.allowed == "all" || v.allowed.includes(u.id)) cr[k] = v;
  });
  res.status(201).json({
    user: u,
    profiles: fp,
    rooms: cr,
  });
});
app.post("/github-webhooks", (req, res) => {
  const githubEvent = req.headers["x-github-event"];
  console.log(`Received ${githubEvent} from GitHub`);
  if (githubEvent == "push") {
    execSync("git pull", { stdio: "inherit" });
    process.disconnect();
    spawn("npm", ["start"], { detached: true, stdio: "inherit" }).unref();
  } else if (githubEvent == "ping") console.log(`Received ping from GitHub`);
  else console.log(`Unhandled event ${githubEvent}`);
  res.status(201).json({});
});

io.of("chat").use(ioAuth);
io.of("voice").use(ioAuth);

io.of("voice").on("connection", (socket) => {
  if (!socket.user) return socket.emit("redirect", "/login");
  const curr = "voice";
  if (!online) online = {};
  const o = online;
  o[socket.user.id] = { visible: true, room: socket.user.room };

  io.of(curr).emit("online", o);
  socket.broadcast.emit("person joined", socket.user);
  socket.emit("profiles", fp);

  socket.on("theme", (t) => (socket.user.theme = t));
  socket.on("visible", (v) => {
    if (!o[socket.user.id])
      o[socket.user.id] = { visible: false, room: socket.user.room };
    o[socket.user.id].visible = v;
    io.of(curr).emit("online", o);
  });
  socket.on("camera", (c) => {
    socket.user.camera = c;
    if (!switched[socket.user.peerId])
      switched[socket.user.peerId] = {
        camera: socket.user.camera,
        audio: socket.user.audio,
        id: socket.user.id,
      };
    switched[socket.user.peerId].camera = c;
    socket.broadcast.emit("camera", [c, socket.user.peerId]);
  });
  socket.on("audio", (a) => {
    socket.user.audio = a;
    if (!switched[socket.user.peerId])
      switched[socket.user.peerId] = {
        camera: socket.user.camera,
        audio: socket.user.audio,
        id: socket.user.id,
      };
    switched[socket.user.peerId].audio = a;
    socket.broadcast.emit("audio", [a, socket.user.peerId]);
  });
  socket.on("present", (p) => {
    socket.user.present = p;
    if (!switched[socket.user.peerId])
      switched[socket.user.peerId] = {
        camera: socket.user.camera,
        audio: socket.user.audio,
        id: socket.user.id,
      };
    switched[socket.user.peerId].present = p;
    io.of(curr).emit("switched", switched);
    if (!p) socket.broadcast.emit("remove person", [socket.user, true]);
  });

  socket.on("id", (id) => {
    if (id == null) return;
    socket.user.peerId = id;
    switched[socket.user.peerId] = {
      camera: socket.user.camera,
      audio: socket.user.audio,
      id: socket.user.id,
    };
    socket.emit("user", socket.user);
    socket.emit("call list", callList);
    io.of(curr).emit("switched", switched);
    callList.push(socket.user);
  });

  socket.on("chat message", (message) => {
    sendMessage(message, socket.user, curr);
  });

  socket.on("react emoji", (e) => {
    socket.broadcast.emit("react emoji", [e, socket.user.name]);
  });

  socket.on("get switched", (cb) => cb(switched));

  socket.on("disconnect", () => {
    delete o[socket.user.id];
    delete switched[socket.user.peerId];
    if (callList.includes(socket.user))
      callList.splice(callList.indexOf(socket.user), 1);
    socket.broadcast.emit("remove person", [socket.user, false]);
    if (socket.user.present)
      socket.broadcast.emit("remove person", [socket.user, true]);
    socket.broadcast.emit("online", o);
    socket.broadcast.emit("switched", switched);
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
  if (!online) online = {};
  const o = online;
  o[socket.user.id] = { visible: true, room: socket.user.room };

  socket.join(socket.user.room);
  const r = get("rooms") || {};
  const m = structuredClone(r[socket.user.room].messages).slice(-maxMessages);
  socket.emit("load messages", [m, false]);
  socket.emit("typing", typing[socket.user.room]);
  socket.emit("unread", socket.user.unread);
  io.of(curr).emit("online", o);
  socket.broadcast.emit("person joined", socket.user);

  socket.on("settings", (s) => (socket.user.settings = s));
  socket.on("add emoji", (e, cb) => {
    if (!socket.user.emojis) socket.user.emojis = [];
    if (!socket.user.emojis.includes(e)) socket.user.emojis.push(e);
    cb(socket.user.emojis);
  });
  socket.on("remove emoji", (e, cb) => {
    if (!socket.user.emojis) socket.user.emojis = [];
    if (socket.user.emojis.includes(e))
      socket.user.emojis.splice(socket.user.emojis.indexOf(e), 1);
    cb(socket.user.emojis);
  });
  socket.on("password", ([o, n], cb) => {
    const p = profiles[socket.user.name];
    if (!p) return;
    if (
      (p.hasPassword && !o) ||
      !n ||
      (p.hasPassword && !bcrypt.compareSync(o, p.password)) ||
      o == n ||
      n.length < 6 ||
      n.length > 50 ||
      n.match(/\s/g)
    ) return cb(false);
    p.password = bcrypt.hashSync(n, 10);
    p.hasPassword = true;
    profiles[socket.user.name] = p;
    fs.writeFileSync("profiles.json", JSON.stringify(profiles, null, 2));
    cb(true);
  });
  socket.on("profile", (file, cb) => {
    if (!file.startsWith("data:")) return;
    const ext = file.split(";")[0].split("/")[1];
    const name = "profiles/" + socket.user.name + "." + ext;
    fs.writeFileSync(name, Buffer.from(file.split(",")[1], "base64"));
    if (fs.existsSync(socket.user.profile)) fs.unlinkSync(socket.user.profile);
    socket.user.profile = name;
    profiles[socket.user.name].profile = name;
    fs.writeFileSync("./profiles.json", JSON.stringify(profiles, null, 2));
    fp = filterProfiles();
    const users = get("users") || {};
    users[socket.user.id] = socket.user;
    set({ users });
    cb();
    io.of(curr).emit("update profile", socket.user);
  });
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
        1,
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
        1,
      );
    io.of(curr).to(socket.user.room).emit("typing", typing[socket.user.room]);
    io.of(curr).emit("online", o);
    set({ users });
  });

  socket.on("chat message", (message) => {
    sendMessage(message, socket.user, curr);
  });

  socket.on("get sounds", (cb) => cb(sounds));

  socket.on("edit", ({ id, message, profile, room }) => {
    const user = fp[profile];
    if (!user) return;
    const rooms = get("rooms");
    const r = rooms[room];
    if (!r) return;
    r.messages[id].message = message;
    r.messages[id].edited = true;
    set({ rooms });
    io.of(curr).to(room).emit("edit", {
      id,
      message,
    });
  });

  socket.on("reply", ({ id, message, profile, room }) => {
    const user = fp[profile];
    if (!user) return;
    const rooms = get("rooms");
    const r = rooms[room];
    if (!r) return;
    if (!r.messages[id].replies) r.messages[id].replies = [];
    const date = new Date();
    r.messages[id].replies.push({
      message,
      name: socket.user.name,
      date,
    });
    set({ rooms });
    const i = r.messages[id].replies.length - 1;
    io.of(curr)
      .to(room)
      .emit("reply", {
        id,
        message,
        user,
        date,
        prev: r.messages[id].replies[i - 1],
        i,
      });
  });

  socket.on("delete", ({ id, profile, room }) => {
    const user = fp[profile];
    if (!user) return;
    const rooms = get("rooms");
    const r = rooms[room];
    if (!r) return;
    r.messages.splice(id, 1);
    set({ rooms });
    updateMessageIds();
    io.of(curr).to(room).emit("delete", { id });
  });

  socket.on("react", ({ id, profile, room, type }) => {
    const rooms = get("rooms");
    const r = rooms[room];
    if (!r) return;
    if (!r.messages[id].reactions) r.messages[id].reactions = [];
    r.messages[id].reactions.push({
      id: socket.user.id,
      name: socket.user.name,
      type,
    });
    set({ rooms });
    io.of(curr).to(room).emit("react", {
      id,
      user: socket.user,
      message: r.messages[id],
      type,
      reactions: r.messages[id].reactions,
    });
  });

  socket.on("files", (cb) => {
    const files = getAllowedFiles(socket.user);
    cb(files);
  });

  socket.on("load messages", (lm) => {
    const rooms = get("rooms");
    const m = rooms[socket.user.room].messages;
    socket.emit("load messages", [
      m.slice(
        Math.max(0, m.length - lm - maxMessages),
        Math.max(0, m.length - lm),
      ),
    ]);
  });

  socket.on("join room", (room) => {
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
        1,
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
        1,
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

  socket.on("note start", (note) => {
    socket.broadcast.emit("note start", [note, socket.user]);
  });

  socket.on("note stop", (note) => {
    socket.broadcast.emit("note stop", [note, socket.user]);
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
  const o = online;
  let isImage = false;
  if (!message) return;
  if (message.includes("data:")) {
    message = upload(message);
    isImage = true;
  }
  if (message.length > 250) return;
  const rooms = get("rooms");
  const lastMessage =
    rooms[us.room].messages[rooms[us.room].messages.length - 1];
  if (curr == "chat") {
    rooms[us.room].messages.push({
      message,
      name: us.name,
      date: new Date(),
      id: rooms[us.room].messages.length,
    });
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
          icon: fp[us.name].profile,
          tag: us.room,
          actions: [
            {
              title: "Reply",
              action: "reply",
              type: "text",
            },
          ],
        });
        Object.keys(subscriptions[u.id]).forEach((k) => {
          const e = subscriptions[u.id][k];
          if (!e) return;
          if (u.settings?.notifications[k])
            webpush.sendNotification(e, payload).catch((e) => {});
        });
      }
      if (!o[u.id] || u.id == us.id || u.room == us.room) return;
      if (!u.unread.includes(us.room)) u.unread.push(us.room);
      io.of(curr).to(u.sid).emit("unread", u.unread);
    });
    set({ users });
    if (typing[us.room].includes(us.id) && !p)
      typing[us.room].splice(typing[us.room].indexOf(us.id), 1);
    if (!p) io.of(curr).to(us.room).emit("typing", typing[us.room]);
    const m = [
      message,
      us,
      new Date(),
      lastMessage,
      rooms[us.room].allowed,
      rooms[us.room].messages.length - 1,
    ];
    io.of(curr).emit("chat message", m);
  } else
    io.of(curr).emit("chat message", [message, us, new Date(), lastMessage, 0]);
};

const port = process.env.PORT || 3000;

server.listen(port, () => {
  console.log(`Listening on port ${port}`);
});

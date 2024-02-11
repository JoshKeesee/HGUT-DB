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
    (k) => r[k].allowed == "all" || r[k].allowed.includes(u.id) || u == "all",
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

const removeUnusedFiles = () => {
  const files = getAllowedFiles("all");
  const f = fs.readdirSync(im);
  f.forEach((file) => {
    if (!files.find((e) => e.name == file)) fs.unlinkSync(im + "/" + file);
  });
}

setup();
removeUnusedFiles();

const { GoogleGenerativeAI } = require("@google/generative-ai");
const path = require("path");
const { send } = require("process");
const genAI = new GoogleGenerativeAI(process.env.API_KEY);

const getFormattedMessages = (messages, u) => {
  const fm = [];
  let currRole = null;
  for (const m of messages) {
    const r = m.name == u.name ? "model" : "user";
    if (currRole == r) fm[fm.length - 1].parts.push(m.message.replace("@" + u.name.replace(" ", "-"), ""));
    else {
      currRole = r;
      fm.push({
        role: currRole,
        parts: [m.message.replace("@" + u.name.replace(" ", "-"), "")],
      });
    }
  }
  return fm;
};

const fileToGenerativePart = (path, mimeType) => {
  return {
    inlineData: {
      data: Buffer.from(fs.readFileSync(path)).toString("base64"),
      mimeType,
    },
  };
};

const generate = async (prompt, history = [], stream = false, fn = () => {}) => {
  const img = prompt.startsWith("/images/");
  const m = "gemini-pro", imgParts = [];
  const model = genAI.getGenerativeModel({ model: img ? "gemini-pro-vision" : m });
  try {
    if (img) {
      const imgPath = prompt.replace("/images/", "images/");
      imgParts.push(fileToGenerativePart(imgPath, "image/" + path.extname(prompt).replace(".", "")));
      const result = await model.generateContent(["", ...imgParts]);
      const response = await result.response;
      const text = response.text();
      return text;
    }
    const chat = model.startChat({ history });
    if (stream) {
      const result = await chat.sendMessageStream(prompt);
      let text = "";
      for await (const chunk of result.stream) {
        const chunkText = chunk.text();
        text += chunkText;
        fn(chunkText);
      }
      return text;
    }
    const result = await chat.sendMessage(prompt);
    const response = await result.response;
    const text = response.text();
    return text;
  } catch (e) {
    console.log(e);
    return { error: e };
  }
};

const generateImage = async (prompt, num = 1) => {
  const raw = JSON.stringify({
    inputs: prompt,
  });
  const reqOpts = {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.IMAGE_API_KEY}`,
    },
    body: raw,
  };
  const res = await fetch("https://api-inference.huggingface.co/models/stabilityai/stable-diffusion-xl-base-1.0", reqOpts);
  const data = await res.blob();
  const buffer = await data.arrayBuffer();
  if (buffer.byteLength > 0) {
    const file = Buffer.from(buffer).toString("base64");
    const name = upload("data:image/png;base64," + file);
    return name;
  }
  return { error: "No image generated" };
};

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
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
  res.status(201).json(fp);
});
app.post("/p", (req, res) => {
  const r = req.body;
  const ret = {};
  if (r.passwords) ret.profiles = profiles;
  else ret.profiles = fp;
  if (r.accessCode) ret.accessCode = accessCode;
  res.status(201).json(ret);
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
    if (fs.existsSync(socket.user.profile)) fs.unlinkSync(socket.user.profile);
    fs.writeFileSync(name, Buffer.from(file.split(",")[1], "base64"));
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
    if (message == "/clear") {
      if (socket.user.room != socket.user.id + "--1" || curr != "chat") return io.of(curr).to(socket.user.room).emit("cancel clear");
      const rooms = get("rooms");
      rooms[socket.user.room].messages = [];
      set({ rooms });
      io.of(curr).to(socket.user.room).emit("clear", socket.user);
      removeUnusedFiles();
      return;
    }
    const { isImage, message: m } = sendMessage(message, socket.user, curr);

    const aiUser = profiles[Object.keys(profiles).find((k) => profiles[k].id == -1)];
    const reply = message.includes("@" + aiUser.name.replace(" ", "-"));
    sendAIMessage(message, socket.user, reply, curr, isImage && m);
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
    if (!r.messages[id]) return;
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
    
    const m = r.messages[id].message;
    const aiUser = profiles[Object.keys(profiles).find((k) => profiles[k].id == -1)];
    const reply = m.includes("@" + aiUser.name.replace(" ", "-"));
    if (reply || r.messages[id].name == aiUser.name) sendAIMessage(message, socket.user, true, curr);
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
    removeUnusedFiles();
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
      const u = room.replace("-", ",").split(",").filter((e) => e >= Object.values(fp)[0].id).map((e) => parseInt(e));
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
  const nm = Date.now();
  const name = im + "/" + nm + "." + ext;
  fs.writeFileSync(name, Buffer.from(file.split(",")[1], "base64"));
  return name.replace(".", "");
};

const sendAIMessage = async (message, us, reply, curr, imgUrl = false) => {
  const aiUser = profiles[Object.keys(profiles).find((k) => profiles[k].id == -1)];
  const { room: r, id: id1 } = us;
  const { id: id2 } = aiUser;
  if (reply || r == id1 + "-" + id2 || r == id2 + "-" + id1) {
    aiUser.room = r;
    let prompt = imgUrl || message.replace("@" + aiUser.name.replace(" ", "-"), "");
    const messages = get("rooms")[r].messages;
    const m = structuredClone(messages).splice(-1)[0];
    const id = m.id;
    let fm = reply ?
      getFormattedMessages(m?.replies || [], aiUser) :
      getFormattedMessages(messages, aiUser);
    if (fm[fm.length - 1]?.role == "user") fm.pop();
    if (fm[0]?.role == "model") {
      if (m.name != aiUser.name) fm.unshift({ role: "user", parts: [m.message] });
      else fm.unshift({ role: "user", parts: ["hello"] });
    }

    const setTyping = (t = true) => {
      if (!t) typing[r].splice(typing[r].indexOf(id2), 1);
      else if (!typing[r].includes(id2)) typing[r].push(id2);
      io.of(curr).to(r).emit("typing", typing[r]);
    };

    const gts = ["generate", "make", "create", "form", "produce", "construct", "build", "imagine", "fabricate", "design", "develop", "compose", "formulate", "forge", "conjure", "originate", "invent", "concoct", "spawn", "hatch", "dream up", "cook up", "whip up", "come up with", "devise", "think up"];
    const imgTerms = ["image", "picture", "photo", "visual", "illustration", "drawing", "diagram", "portrait", "painting", "sketch"];
    const isImgPrompt = gts.some((e) => prompt.includes(e)) && imgTerms.some((e) => prompt.includes(e));

    setTyping();
  
    if (isImgPrompt) {
      const gis = ["I'll try to create that", "Sure, I'll give it a shot", "I'll see what I can do", "I'll try to generate an image for that", "I'll see what I can come up with"];
      sendMessage(gis[Math.floor(Math.random() * gis.length)], aiUser, curr);
      setTyping();
      const res = await generateImage(prompt);
      if (res.error) return io.of(curr).to(r).emit("ai error", res.error);
      sendMessage(res, aiUser, curr);
      prompt = res;
    }

    setTyping();

    const res = await generate(prompt, fm);
    setTyping(false);
    if (res.error) return io.of(curr).to(r).emit("ai error", res.error);
    if (reply) {
      const rooms = get("rooms");
      const messages = rooms[r].messages;
      const m = messages[id];
      if (!m.replies) m.replies = [];
      m.replies.push({
        message: res,
        name: aiUser.name,
        date: new Date(),
      });
      set({ rooms });
      const i = m.replies.length - 1;
      io.of(curr)
        .to(r)
        .emit("reply", {
          id,
          message: res,
          user: aiUser,
          date: new Date(),
          prev: m.replies[i - 1],
          i,
        });
    } else sendMessage(res, aiUser, curr);
  }
};

const sendMessage = (message, us, curr, p = false) => {
  const o = online;
  let isImage = false;
  if (!message) return;
  if (message.includes("data:")) {
    message = upload(message);
    isImage = true;
  }
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
  return {
    isImage,
    message,
  };
};

const port = process.env.PORT || 3000;

server.listen(port, () => {
  console.log(`Listening on port ${port}`);
});

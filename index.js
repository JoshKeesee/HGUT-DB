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
const pushKeys = {
  public: process.env.PUBLIC_KEY,
  private: process.env.PRIVATE_KEY,
};
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
const im = "./files";
const online = {},
  switched = {},
  typing = {},
  callList = [],
  initMessages = 20;

const setup = () => {
  if (!fs.existsSync(p)) fs.mkdirSync(p);
  if (!fs.existsSync(im)) fs.mkdirSync(im);
  const defaultRooms = {
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
  };
  if (!get("rooms")) set({ rooms: defaultRooms });
  if (!get("users")) set({ users: {} });
  const r = get("rooms");
  Object.keys(defaultRooms).forEach((k) => !r[k] && (r[k] = defaultRooms[k]));
  set("rooms", r);
  updateMessageIds();
  Object.keys(r).forEach((k) => (typing[k] = []));
};

const updateMessageIds = () => {
  const r = get("rooms");
  Object.keys(r).forEach((k) => r[k].messages.forEach((m, i) => (m.id = i)));
  set({ rooms: r });
};

const getAllowedFiles = (u) => {
  const r = get("rooms");
  const a = Object.keys(r).filter(
    (k) => r[k].allowed == "all" || r[k].allowed.includes(u.id) || u == "all"
  );
  const files = [];
  a.forEach((k) => {
    r[k].messages.forEach((m) => {
      if (m.message.startsWith("/files/"))
        files.push({
          name: m.message.replace("/files/", ""),
          url: m.message.replace("/files/", "files/"),
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
};

setup();
removeUnusedFiles();

const docs = require("@googleapis/docs");
const mime = require("mime-types");
const tools = ["text-to-image", "text-to-audio", "text-to-video", "web-search"];
const toolTokens = ["BEGIN_CALL", "END_CALL"];

const client = docs.docs({
  version: "v1",
  auth: new docs.auth.GoogleAuth({
    keyFile: "credentials.json",
    scopes: ["https://www.googleapis.com/auth/documents.readonly"],
  }),
});

const documentId = "1xsxMONOYieKK_a87PTJwvmgwRZVNxOE4OhxtWc2oz7I";
let docText = "";
let docTC = "";

const getDocument = async () => {
  const res = await client.documents.get({
    documentId,
  });
  return res.data;
};

const getDocumentText = async (data) => {
  const text = data.body.content
    .map((e) => e.paragraph?.elements.map((e) => e.textRun?.content).join(""))
    .join("")
    .replaceAll("…", "...");
  return text;
};

const getDocumentTC = async (data) => {
  const tc = data.body.content.filter((e) => e.tableOfContents)[0]
    .tableOfContents.content;
  let txt = tc
    ?.map((e) => e.paragraph?.elements.map((e) => e.textRun?.content).join(""))
    .join("")
    .replaceAll("…", "...");
  const re = /\d+/g;
  const matches = txt.match(re);
  if (matches) matches.forEach((m) => (txt = txt.replace(m, "")));
  txt = txt
    .split("\n")
    .map((e) => e.trim())
    .join("\n");
  return txt;
};

const updateDoc = async () => {
  const data = await getDocument();
  docText = await getDocumentText(data);
  docTC = await getDocumentTC(data);
  console.log("Document updated: " + new Date().toLocaleString());
};

updateDoc();
setInterval(updateDoc, 1000 * 60 * 60 * 24);

const getRules = (u, rn, allowed) => {
  if (allowed == "all")
    allowed = Object.keys(profiles).map((k) => profiles[k].id);
  const authorInfo = `
    Name: %n
    Id (in the chat app): %id
    Color theme (in the chat app): %ct
    Character: %c
    Character description: %cd
    Date of birth: %d
    Gender: %g
    Is a character in the book: %ib
    ----------
  `;
  return `
    You are a fun, helpful, clean, and engaging assistant named ${u.name}.
    You were developed by Joshua Keesee.
    We are in a chat app called HGUT, short for "The Hobo's Guide to the Universe of Texas".
    The name of this chat room is "${rn}" (if it is 2 numbers separated by a hyphen then it's a personal chat).
    The people accessible in this chat room include: ${allowed
      .map(
        (e) =>
          profiles[Object.keys(profiles).find((p) => profiles[p].id == e)].name
      )
      .join(", ")}.
    To mention someone, you can type an "@" followed by their capitalized real first and last name separated with a hyphen (e.g. "@Joshua-Keesee"), but do not mention them all the time.
    You can also mention someone by clicking the "@" icon, "Mention Someone", and then select a name.
    HGUT is a book which can be found at https://docs.google.com/document/d/1xsxMONOYieKK_a87PTJwvmgwRZVNxOE4OhxtWc2oz7I/edit#heading=h.usr1krprpaoe.
    The authors of HGUT are: ${Object.values(fp)
      .filter((k) => k.id >= 0 && !k.notInBook)
      .map((k) => k.name)
      .join(", ")}.
    These are the authors that relate to the characters in the story (HGUT): ${Object.values(
      fp
    )
      .filter((k) => k.id >= 0 && !k.notInBook)
      .map((k) => k.name + "'s character is " + k.character)
      .join(", ")}.
    Here is each character's profile info:
    ----------
    ${Object.values(fp)
      .map((e) =>
        authorInfo
          .replace("%n", e.name)
          .replace("%id", e.id)
          .replace("%ct", e.color)
          .replace("%c", e.character)
          .replace("%cd", e.description)
          .replace("%d", e.dob)
          .replace("%g", e.gender)
          .replace("%ib", !e.notInBook)
      )
      .join("")}
      PS stands for "Pre-Spawn" but is also known as "BC" or "BCE". IZ stands for "Includes-Zhenzhen" but is also known as "AD" or "CE". Only use these when listing dates.
      Here are the months in the HGUT calendar: January, February, March, April, Octember (32 days long), June, July, August, September, Muy (30 days long), November, and December.
      Here is the HGUT story timeline:
      ----------
      ∞ PS - God was/is/always will be never born
      450 PS - General Sherman is born
      4 PS - Jesus Christ is born
      1 IZ - Zhenzhen materializes in a slob in Ireland
      721 IZ - Sucram is born
      738 IZ - Sucram is cursed with perpetual birth
        - Always dies at 4:50 P.M. 
          - Relates to the birth of General Sherman as all curses do
          - Relates to the start of the Roman Calendar (738 PS)
          - Relates to Zhenzhen cursing the calendar
      1779 IZ - Tina and Napolean are born
      1780 IZ - Tina's parents hate her face so they kick her out and she lives on the streets like a... HOBO!
        - Relates to the title of the story
      1942 IZ - Chad Magenta is born; gets hit by a stick in the head that has to do with Experiment 4.2 at age 1 on June 4th, 1943 whenever Teddy Roosevelt's child Kermit Roosevelt died causing physical harm to the aging gland causing him to stop aging after age 33 forever.
      1987 IZ - Miss is born
      1994 IZ - Clementine Favila is born / materializes
      2010 IZ - Kycumber materializes in a Suncash Coffee Shop in the country of Texas, finding Liam buying a large Kopi Iuwak
      2042 IZ - Kycumber is born
      2057 IZ - General Sherman is killed
      2058 IZ - Kycumber leaves the future and travels back to 2010 IZ in the Suncash Coffee Shop
      ----------
      Here are the chapter titles in order: ${docTC.split("\n").join(", ")}
      Here is the current story:
      ----------
      ${docText}
      ----------
      You personally have access to these tools: ${tools.join(", ")}.
      Here are the parameters for each tool:
      ----------
      {
        "name": "text-to-image",
        "prompt": "prompt",
        "width": [256-1536], // Default: 1024
        "height": [256-1536], // Default: 1024
        "NUM_IMAGES_PER_PROMPT": [1-4] // Default: 1
      }
      ----------
      ----------
      {
        "name": "text-to-audio",
        "prompt": "prompt",
        "seconds_total": [0-47] // Default: 30
      }
      ----------
      ----------
      {
        "name": "text-to-video",
        "prompt": "prompt",
        "base": ["Cartoon", "Realistic", "3d", "Anime"], // Default: "Realistic"
        "motion": ["", "guoyww/animatediff-motion-lora-zoom-in", "guoyww/animatediff-motion-lora-zoom-out", "guoyww/animatediff-motion-lora-tilt-up", "guoyww/animatediff-motion-lora-tilt-down", "guoyww/animatediff-motion-lora-pan-left", "guoyww/animatediff-motion-lora-pan-right", "guoyww/animatediff-motion-lora-rolling-anticlockwise", "guoyww/animatediff-motion-lora-rolling-clockwise"] // Default: "guoyww/animatediff-motion-lora-zoom-in"
      }
      ----------
      ----------
      {
        "name": "web-search",
        "query": "query",
        "num_results": [1-10], // Default: 4
      }
      ----------
      To use a tool, you and only you can use this format in your response:
      ----------
      ${toolTokens[0]}
        {
          "name": "tool-name",
          ... // other tool-specific parameters
        }
      ${toolTokens[1]}
      ----------
      You can use the requested tools anywhere in a message, but never change default parameters unless asked.
      Before you call a tool (or tools), say something like, "Sure, I'll use the text-to-image tool to generate an image of a cat for you."
      After you call a tool (or tools), say something like, "Here is the image of a cat you requested."
      You have access to real-time information using the "web-search" tool. If you don't know something, use this tool.
      Ensure that you exactly follow the tool-calling format with "${
        toolTokens[0]
      }" at the start and "${
    toolTokens[1]
  }" at the end otherwise the tool will not work.
  `;
};

const formatMessages = (messages, u, user, rn, allowed) => {
  const fm = [];
  let currRole = user ? "assistant" : null;
  for (const m of messages) {
    const r = m.name == u.name ? "assistant" : "user";
    const part =
      (r == "user" ? `${m.name} (${new Date(m.date)}): ` : "") + m.message;
    if (m.message.startsWith("<tool-status>")) continue;
    if (currRole == r && fm.length) fm[fm.length - 1].content += `\n${part}`;
    else {
      currRole = r;
      fm.push({
        role: currRole,
        content: part,
      });
    }
  }
  if (user)
    fm.unshift({
      role: "system",
      content: getRules(u, rn, allowed),
    });
  return fm;
};

let localServer = "http://127.0.0.1:5000";
const AlfredIndigo = async (prompt, us, messages = [], max_tokens = 1000) => {
  messages.push({
    role: "user",
    content: `${us.name} at ${new Date()}: ${prompt}`,
  });
  const data = await (
    await fetch(localServer + "/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        messages,
        max_tokens,
      }),
    })
  ).json();
  if (data["error"]) return { error: data["error"] };
  else return data["response"];
};
const generateContent = async (d, sfn = () => {}) => {
  const response = await fetch(`${localServer}/generate-content`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(d),
  });

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let done = false;
  let data = {};

  while (!done) {
    const { value, done: readerDone } = await reader.read();
    done = readerDone;

    if (value) {
      const chunk = decoder.decode(value, { stream: true });
      const es = chunk.replaceAll("data: ", "").split("<end-event>");
      for (const e of es) {
        if (e.trim().length > 0) {
          let p;
          try {
            p = JSON.parse(e);
          } catch {}
          if (p) data = p;
          if (data.status) sfn(data.status);
        }
      }
    }
  }

  if (data["error"]) return { error: data["error"] };
  else return data["response"];
};

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());
app.use("/profiles", express.static(__dirname + "/profiles"));
app.use("/files", express.static(__dirname + "/files"));
app.use("/sounds", express.static(__dirname + "/sounds"));
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
      ?.name;
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
app.post("/login", async (req, res) => {
  const username = req.body["name"];
  const password = req.body["password"];
  const ac = req.body["access-code"];
  if (!username) return res.json({ error: "Please enter a username" });
  if (!password) return res.json({ error: "Please enter a password" });
  if (!ac) return res.json({ error: "Please enter an access code" });
  if (!bcrypt.compareSync(ac, accessCode))
    return res.json({ error: "Invalid access code" });
  if (!profiles[username]) return res.json({ error: "Invalid username" });
  if (profiles[username].id < 0) return res.json({ error: "Invalid username" });
  const p = profiles[username].password;
  if (!bcrypt.compareSync(password, p))
    return res.json({ error: "Invalid password" });
  res.json({ success: true, user: username, redirect: "/chat" });
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
  const m = structuredClone(r[socket.user.room].messages).slice(-initMessages);
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
    )
      return cb(false);
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

  const msg = async (message) => {
    if (message == "/clear") {
      const bot = socket.user.room == socket.user.id + "--1" ? -1 : 0;
      if (bot == 0 || curr != "chat")
        return io.of(curr).to(socket.user.room).emit("cancel clear");
      const rooms = get("rooms");
      rooms[socket.user.room].messages = [];
      set({ rooms });
      io.of(curr).to(socket.user.room).emit("clear", socket.user);
      removeUnusedFiles();
      return;
    }
    const { isFile, message: m } = sendMessage(message, socket.user, curr);
    let aiUser =
      profiles[Object.keys(profiles).find((k) => profiles[k].id == -1)];
    aiUser.room = socket.user.room;
    let reply = message.includes("@" + aiUser.name.replace(" ", "-"));
    sendAIMessage(message, socket.user, aiUser, reply, curr, isFile && m);
  };

  socket.on("chat message", msg);

  socket.on("upload", ([file, mimeType], cb) => {
    const buffer = Buffer.from(file, "base64");
    const dataUri = "data:" + mimeType + ";base64," + buffer.toString("base64");
    msg(dataUri);
  });

  socket.on("upload chunk", ([file, name, ext, i, l]) => {
    const buffer = Buffer.from(file, "base64");
    const p = im + "/" + name + (ext ? "." + ext : "");
    if (i == 0) fs.writeFileSync(p, buffer);
    else fs.appendFileSync(p, buffer);
    if (i == l - 1) msg(p.replace(".", ""));
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
    let aiUser =
      profiles[Object.keys(profiles).find((k) => profiles[k].id == -1)];
    let reply = m.includes("@" + aiUser.name.replace(" ", "-"));
    aiUser.room = socket.user.room;
    if (reply || r.messages[id].name == aiUser.name)
      sendAIMessage(message, socket.user, aiUser, true, curr);
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

  socket.on("load messages", (lm, mm = initMessages) => {
    const rooms = get("rooms");
    const m = rooms[socket.user.room].messages;
    socket.emit("load messages", [
      m.slice(Math.max(0, m.length - lm - mm), Math.max(0, m.length - lm)),
    ]);
  });

  socket.on("join room", async (room, mm = initMessages) => {
    const rooms = get("rooms");
    if (!rooms[room]) {
      const u = room
        .replace("-", ",")
        .split(",")
        .filter((e) => e >= Object.values(fp)[0].id)
        .map((e) => parseInt(e));
      if (rooms[u[1] + "-" + u[0]]) room = u[1] + "-" + u[0];
      else if (u[0] == socket.user.id || u[1] == socket.user.id) {
        typing[room] = [];
        rooms[room] = {
          name: room,
          messages: [],
          allowed: u,
        };
        set({ rooms });
        newRoom = true;
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
      rooms[socket.user.room].messages.slice(-mm),
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
  const mimeType = file.split(";")[0].split(":")[1];
  const ext = mime.extension(mimeType);
  const nm = Date.now();
  const name = im + "/" + nm + "." + ext;
  fs.writeFileSync(name, Buffer.from(file.split(",")[1], "base64"));
  return name.replace(".", "");
};

const sendAIMessage = async (
  message,
  us,
  aiUser,
  reply,
  curr,
  isFile = false,
  useWebTool = true
) => {
  aiUser = structuredClone(aiUser);
  const { room: r, id: id1 } = us;
  const { id: id2 } = aiUser;
  if (reply || r == id1 + "-" + id2 || r == id2 + "-" + id1) {
    let prompt =
      isFile || message.replace("@" + aiUser.name.replace(" ", "-"), "");
    const room = get("rooms")[r];
    const messages = room.messages;
    const m = structuredClone(messages).splice(-1)[0];
    const id = m.id;
    let fm = formatMessages(
      reply ? m?.replies?.concat(...m.message) || [] : messages,
      aiUser,
      aiUser.id == -1 ? us : "",
      room.name,
      room.allowed
    );

    const setTyping = (t = true) => {
      if (!t) typing[r].splice(typing[r].indexOf(id2), 1);
      else if (!typing[r].includes(id2)) typing[r].push(id2);
      io.of(curr).to(r).emit("typing", typing[r]);
    };

    setTyping();
    const res = await AlfredIndigo(prompt, us, fm);
    setTyping(false);
    if (res.error) return io.of(curr).to(r).emit("ai error", res.error);

    const getIndices = (str, find, end = false) => {
      const id = [];
      let i = -1;
      while ((i = str.indexOf(find, i + 1)) >= 0)
        id.push(end ? i + find.length : i);
      return id;
    };

    const sendReply = (res) => {
      const rooms = get("rooms");
      const messages = rooms[r].messages;
      const m = messages[id];
      if (!m) return;
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
    };

    const sendFn = (re) => {
      if (!re) return;
      if (reply) sendReply(re);
      else sendMessage(re, { room: r, ...aiUser }, curr);
    };

    const nextIter = (i, st, et) => {
      const t = res.slice(st[i], et[i]),
        r = res.split(t);
      return r;
    };

    try {
      const tc = [];
      const st = getIndices(res, toolTokens[0]);
      const et = getIndices(res, toolTokens[1], true);
      for (let i = 0; i < st.length; i++) {
        const s = st[i];
        const e = et[i];
        const tool = res
          .slice(s, e)
          .replace(toolTokens[0], "")
          .replace(toolTokens[1], "");
        try {
          const t = JSON.parse(tool);
          tc.push(t);
        } catch {}
      }

      if (tc.length == 0) return sendFn(res);
      let i = 0;
      for (const t of tc) {
        setTyping();
        const re = nextIter(i, st, et)[0];
        if (re && !re.includes(toolTokens[0])) sendFn(re);
        if (!tools.includes(t.name)) continue;
        const ws = t.name == "web-search";
        if (ws && !useWebTool) continue;
        const id = crypto.randomUUID();
        const sfn = (s) => io.of(curr).to(r).emit("tool status", [id, s]);
        sendFn(`<tool-status>${id}|${t.name}</tool-status>`);
        setTyping();
        const data = await generateContent(t, sfn);
        if (data.error) {
          io.of(curr).to(r).emit("ai error", data.error);
          sendFn(`Sorry, an error occurred while using the ${t.name} tool.`);
          return;
        }
        if (ws)
          return sendAIMessage(
            `
            With the data provided by the ${t.name} tool:
            ${data}

            Reply to the user's prompt:
            ${prompt}
          `,
            us,
            aiUser,
            false,
            curr,
            false,
            false
          );
        sendFn(data);
        i++;
      }
      setTyping();
      const e = nextIter(i, st, et);
      const re = e[e.length - 1];
      if (re && !re.includes(toolTokens[0])) sendFn(re);
    } catch (e) {
      console.log(e);
    }
    setTyping(false);
  }
};

const sendMessage = (message, us, curr, p = false) => {
  const o = online;
  let isFile = false;
  if (!message) return;
  if (message.includes("data:")) {
    message = upload(message);
    isFile = true;
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
    const a =
      rooms[us.room].allowed == "all"
        ? Object.keys(users)
        : rooms[us.room].allowed;
    a.forEach((a) => {
      const u = users[a];
      if (!u) return;
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
    isFile,
    message,
  };
};

const port = process.env.PORT || 3000;

server.listen(port, () => console.log(`Listening on port ${port}`));

process.on("uncaughtException", (e) => console.log(e));

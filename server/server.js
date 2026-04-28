const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");

const app = express();
const PORT = 3000;
const DATA_FILE = "./dashboard_data.json";

const ADMIN_USER = "admin";
const ADMIN_PASS = "admin123";

app.use(cors());
app.use(express.json());
app.use(express.static("public"));
app.use("/admin", express.static("admin"));

function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    return {
      players: [],
      users: [],
      sessions: [],
      linkCodes: [],
      redeemCodes: [],
      badges: [],
      events: []
    };
  }

  const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));

  if (!data.players) data.players = [];
  if (!data.users) data.users = [];
  if (!data.sessions) data.sessions = [];
  if (!data.linkCodes) data.linkCodes = [];
  if (!data.redeemCodes) data.redeemCodes = [];
  if (!data.badges) data.badges = [];
  if (!data.events) data.events = [];

  return data;
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function findUser(data, username) {
  return data.users.find(u => u.username.toLowerCase() === username.toLowerCase());
}

function findPlayer(data, playerName) {
  return data.players.find(p => p.playerName.toLowerCase() === playerName.toLowerCase());
}

function generateToken() {
  return crypto.randomBytes(32).toString("hex");
}

function generateRedeemCode() {
  return "EVT-" + crypto.randomBytes(3).toString("hex").toUpperCase();
}

function getTokenFromRequest(req) {
  const auth = req.headers.authorization;
  if (!auth) return null;
  return auth.replace("Bearer ", "");
}

function getSessionUser(data, req) {
  const token = getTokenFromRequest(req);
  if (!token) return null;

  const session = data.sessions.find(s => s.token === token);
  if (!session) return null;

  if (new Date(session.expiresAt) < new Date()) return null;

  return findUser(data, session.username);
}

function requireLogin(req, res, next) {
  const data = loadData();
  const user = getSessionUser(data, req);

  if (!user) return res.status(401).json({ error: "Não autorizado" });

  req.user = user;
  req.data = data;
  next();
}

function requireAdmin(req, res, next) {
  const token = getTokenFromRequest(req);

  if (!token || token !== "ADMIN_TOKEN") {
    return res.status(401).json({ error: "Admin não autorizado" });
  }

  req.data = loadData();
  next();
}

function createEmptyPlayer(playerName) {
  return {
    playerName,
    level: 1,
    rank: "Novato",
    xp: 0,
    totalPlayTime: 0,
    distanceDrivenKm: 0,
    racesWon: 0,
    racesPlayed: 0,
    achievements: [],
    badges: [],
    matchHistory: []
  };
}

function getEventCurrentValue(player, type) {
  if (type === "RACES_WON") return player.racesWon || 0;
  if (type === "RACES_PLAYED") return player.racesPlayed || 0;
  if (type === "PLAY_TIME") return player.totalPlayTime || 0;
  if (type === "DISTANCE_KM") return player.distanceDrivenKm || 0;
  if (type === "LEVEL") return player.level || 0;
  if (type === "XP") return player.xp || 0;
  return 0;
}

function hasCompletedEvent(player, event) {
  return getEventCurrentValue(player, event.requirementType) >= event.requirementValue;
}

function isEventExpired(event) {
  if (!event.expiresAt) return false;
  return new Date(event.expiresAt) < new Date();
}

function evaluateEventsForPlayer(data, player) {
  data.events.forEach(event => {
    if (!event.active) return;
    if (isEventExpired(event)) return;
    if (!hasCompletedEvent(player, event)) return;

    if (!player.badges) player.badges = [];

    if (player.badges.includes(event.rewardBadge)) return;

    const existingCode = data.redeemCodes.find(c =>
      c.playerName.toLowerCase() === player.playerName.toLowerCase() &&
      c.eventId === event.eventId &&
      c.used === false
    );

    if (existingCode) return;

    data.redeemCodes.push({
      code: generateRedeemCode(),
      playerName: player.playerName,
      eventId: event.eventId,
      title: event.title,
      description: event.description,
      rewardBadge: event.rewardBadge,
      used: false,
      createdAt: new Date().toISOString()
    });
  });
}

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "admin", "index.html"));
});

// AUTH

app.post("/auth/register", async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) return res.status(400).json({ error: "Usuário e senha são obrigatórios" });
  if (username.length < 3) return res.status(400).json({ error: "Usuário precisa ter pelo menos 3 caracteres" });
  if (password.length < 6) return res.status(400).json({ error: "Senha precisa ter pelo menos 6 caracteres" });

  const data = loadData();

  if (findUser(data, username)) return res.status(400).json({ error: "Esse usuário já existe" });

  const passwordHash = await bcrypt.hash(password, 10);

  data.users.push({
    username,
    passwordHash,
    linkedPlayerName: null,
    createdAt: new Date().toISOString()
  });

  saveData(data);

  res.json({ success: true, message: "Conta criada com sucesso" });
});

app.post("/auth/login", async (req, res) => {
  const { username, password } = req.body;

  const data = loadData();
  const user = findUser(data, username || "");

  if (!user) return res.status(401).json({ error: "Usuário ou senha inválidos" });

  const validPassword = await bcrypt.compare(password || "", user.passwordHash);

  if (!validPassword) return res.status(401).json({ error: "Usuário ou senha inválidos" });

  const token = generateToken();

  data.sessions.push({
    username: user.username,
    token,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString()
  });

  saveData(data);

  res.json({
    success: true,
    token,
    username: user.username,
    linkedPlayerName: user.linkedPlayerName
  });
});

app.post("/auth/logout", requireLogin, (req, res) => {
  const token = getTokenFromRequest(req);
  const data = req.data;

  data.sessions = data.sessions.filter(s => s.token !== token);
  saveData(data);

  res.json({ success: true, message: "Logout feito" });
});

app.get("/profile/me", requireLogin, (req, res) => {
  const data = req.data;

  if (!req.user.linkedPlayerName) {
    return res.json({
      username: req.user.username,
      linkedPlayerName: null,
      player: null
    });
  }

  const player = findPlayer(data, req.user.linkedPlayerName);

  res.json({
    username: req.user.username,
    linkedPlayerName: req.user.linkedPlayerName,
    player: player || null
  });
});

// LINK

app.post("/link/create", (req, res) => {
  const { playerName } = req.body;

  if (!playerName) return res.status(400).json({ error: "playerName obrigatório" });

  const data = loadData();

  let player = findPlayer(data, playerName);

  if (!player) {
    player = createEmptyPlayer(playerName);
    data.players.push(player);
  }

  data.linkCodes = data.linkCodes.filter(c =>
    !(c.playerName.toLowerCase() === playerName.toLowerCase() && c.used === false)
  );

  const code = "LINK-" + crypto.randomBytes(3).toString("hex").toUpperCase();
  const expiresAt = new Date(Date.now() + 1000 * 60 * 10).toISOString();

  data.linkCodes.push({
    code,
    playerName,
    used: false,
    createdAt: new Date().toISOString(),
    expiresAt
  });

  saveData(data);

  res.json({ success: true, code, expiresAt });
});

app.post("/link/confirm", requireLogin, (req, res) => {
  const { code } = req.body;

  if (!code) return res.status(400).json({ error: "Código obrigatório" });

  const data = req.data;

  const link = data.linkCodes.find(c => c.code.toUpperCase() === code.toUpperCase());

  if (!link) return res.status(404).json({ error: "Código inválido" });
  if (link.used) return res.status(400).json({ error: "Código já utilizado" });
  if (new Date(link.expiresAt) < new Date()) return res.status(400).json({ error: "Código expirado" });

  const player = findPlayer(data, link.playerName);

  if (!player) return res.status(404).json({ error: "Jogador não encontrado" });

  const alreadyLinked = data.users.find(
    u => u.linkedPlayerName && u.linkedPlayerName.toLowerCase() === link.playerName.toLowerCase()
  );

  if (alreadyLinked && alreadyLinked.username !== req.user.username) {
    return res.status(403).json({ error: "Esse jogador já está vinculado a outra conta" });
  }

  req.user.linkedPlayerName = link.playerName;

  link.used = true;
  link.usedAt = new Date().toISOString();
  link.usedBy = req.user.username;

  saveData(data);

  res.json({
    success: true,
    message: "Conta vinculada com sucesso",
    linkedPlayerName: link.playerName
  });
});

// UNITY UPDATE

app.post("/update-player", (req, res) => {
  const player = req.body;

  if (!player.playerName) return res.status(400).json({ error: "playerName obrigatório" });

  const data = loadData();

  let existing = findPlayer(data, player.playerName);

  if (!existing) {
    existing = createEmptyPlayer(player.playerName);
    data.players.push(existing);
  }

  existing.playerName = player.playerName;
  existing.level = player.level || 1;
  existing.rank = player.rank || "Novato";
  existing.xp = player.xp || 0;
  existing.totalPlayTime = player.totalPlayTime || 0;
  existing.distanceDrivenKm = player.distanceDrivenKm || existing.distanceDrivenKm || 0;
  existing.racesWon = player.racesWon || 0;
  existing.racesPlayed = player.racesPlayed || 0;
  existing.achievements = player.achievements || existing.achievements || [];
  existing.badges = existing.badges || [];
  existing.matchHistory = player.matchHistory || [];

  evaluateEventsForPlayer(data, existing);

  saveData(data);

  res.json({ success: true, message: "Player atualizado" });
});

// EVENTOS PARA O JOGO

app.get("/events/progress/:playerName", (req, res) => {
  const data = loadData();
  const playerName = req.params.playerName;

  const player = findPlayer(data, playerName);

  if (!player) {
    return res.status(404).json({ error: "Jogador não encontrado" });
  }

  const result = data.events
    .filter(event => event.active)
    .filter(event => !isEventExpired(event))
    .filter(event => !hasCompletedEvent(player, event))
    .map(event => {
      const current = getEventCurrentValue(player, event.requirementType);

      return {
        eventId: event.eventId,
        title: event.title,
        description: event.description,
        requirementType: event.requirementType,
        currentValue: current,
        requirementValue: event.requirementValue,
        rewardBadge: event.rewardBadge,
        expiresAt: event.expiresAt || null,
        completed: false
      };
    });

  res.json(result);
});

// REWARDS

app.get("/rewards/available", requireLogin, (req, res) => {
  const data = req.data;

  if (!req.user.linkedPlayerName) {
    return res.status(400).json({ error: "Conta não vinculada ao jogo" });
  }

  const codes = data.redeemCodes.filter(c =>
    c.playerName.toLowerCase() === req.user.linkedPlayerName.toLowerCase() &&
    c.used === false
  );

  res.json(codes);
});

app.post("/rewards/redeem", requireLogin, (req, res) => {
  const { code } = req.body;
  const data = req.data;

  if (!code) return res.status(400).json({ error: "Código obrigatório" });

  if (!req.user.linkedPlayerName) {
    return res.status(400).json({ error: "Conta não vinculada ao jogo" });
  }

  const redeem = data.redeemCodes.find(c => c.code.toUpperCase() === code.toUpperCase());

  if (!redeem) return res.status(404).json({ error: "Código inválido" });
  if (redeem.used) return res.status(400).json({ error: "Código já utilizado" });

  if (redeem.playerName.toLowerCase() !== req.user.linkedPlayerName.toLowerCase()) {
    return res.status(403).json({ error: "Esse código não pertence à sua conta" });
  }

  const player = findPlayer(data, req.user.linkedPlayerName);

  if (!player) return res.status(404).json({ error: "Jogador não encontrado" });

  if (!player.badges) player.badges = [];

  if (!player.badges.includes(redeem.rewardBadge)) {
    player.badges.push(redeem.rewardBadge);
  }

  redeem.used = true;
  redeem.usedAt = new Date().toISOString();

  saveData(data);

  res.json({
    success: true,
    message: "Insígnia resgatada com sucesso",
    badge: redeem.rewardBadge
  });
});

// BADGES PUBLIC

app.get("/badges", (req, res) => {
  const data = loadData();
  res.json(data.badges);
});

// ADMIN

app.post("/admin/login", (req, res) => {
  const { username, password } = req.body;

  if (username === ADMIN_USER && password === ADMIN_PASS) {
    return res.json({ success: true, token: "ADMIN_TOKEN" });
  }

  res.status(401).json({ error: "Admin inválido" });
});

app.get("/admin/data", requireAdmin, (req, res) => {
  res.json({
    badges: req.data.badges,
    events: req.data.events
  });
});

app.post("/admin/badges", requireAdmin, (req, res) => {
  const { badgeId, name, icon, description } = req.body;
  const data = req.data;

  if (!badgeId || !name) {
    return res.status(400).json({ error: "badgeId e name são obrigatórios" });
  }

  const exists = data.badges.find(b => b.badgeId === badgeId);

  if (exists) return res.status(400).json({ error: "Essa insígnia já existe" });

  data.badges.push({
    badgeId,
    name,
    icon: icon || "�",
    description: description || ""
  });

  saveData(data);

  res.json({ success: true, message: "Insígnia criada" });
});

app.delete("/admin/badges/:badgeId", requireAdmin, (req, res) => {
  const data = req.data;
  const badgeId = req.params.badgeId;

  data.badges = data.badges.filter(b => b.badgeId !== badgeId);

  saveData(data);

  res.json({ success: true, message: "Insígnia excluída" });
});

app.post("/admin/events", requireAdmin, (req, res) => {
const {
  eventId,
  title,
  description,
  requirementType,
  requirementValue,
  rewardBadge,
  active,
  durationDays
} = req.body;

  const data = req.data;

  if (!eventId || !title || !requirementType || !requirementValue || !rewardBadge) {
    return res.status(400).json({ error: "Preencha todos os campos obrigatórios" });
  }

  const exists = data.events.find(e => e.eventId === eventId);

  if (exists) return res.status(400).json({ error: "Esse evento já existe" });

  const badgeExists = data.badges.find(b => b.badgeId === rewardBadge);

  if (!badgeExists) return res.status(400).json({ error: "A insígnia escolhida não existe" });

let expiresAt = null;

if (durationDays && Number(durationDays) > 0) {
  expiresAt = new Date(
    Date.now() + Number(durationDays) * 24 * 60 * 60 * 1000
  ).toISOString();
}

data.events.push({
  eventId,
  title,
  description: description || "",
  requirementType,
  requirementValue: Number(requirementValue),
  rewardBadge,
  active: active === true,
  durationDays: Number(durationDays) || 0,
  createdAt: new Date().toISOString(),
  expiresAt
});

  saveData(data);

  res.json({ success: true, message: "Evento criado" });
});

app.patch("/admin/events/:eventId/toggle", requireAdmin, (req, res) => {
  const data = req.data;
  const eventId = req.params.eventId;

  const event = data.events.find(e => e.eventId === eventId);

  if (!event) return res.status(404).json({ error: "Evento não encontrado" });

  event.active = !event.active;

  saveData(data);

  res.json({ success: true, message: "Status do evento alterado" });
});

app.delete("/admin/events/:eventId", requireAdmin, (req, res) => {
  const data = req.data;
  const eventId = req.params.eventId;

  data.events = data.events.filter(e => e.eventId !== eventId);

  saveData(data);

  res.json({ success: true, message: "Evento excluído" });
});

// DASHBOARDS

app.get("/dashboard/best-times", (req, res) => {
  const data = loadData();
  const best = {};

  data.players.forEach(player => {
    (player.matchHistory || []).forEach(entry => {
      if (!entry.trackName) return;

      if (!best[entry.trackName] || entry.raceTime < best[entry.trackName].raceTime) {
        best[entry.trackName] = {
          trackName: entry.trackName,
          playerName: player.playerName,
          raceTime: entry.raceTime,
          date: entry.date
        };
      }
    });
  });

  res.json(Object.values(best));
});

app.get("/dashboard/top-level", (req, res) => {
  const data = loadData();

  const ranking = data.players
    .sort((a, b) => b.level - a.level || b.xp - a.xp)
    .map(p => ({
      playerName: p.playerName,
      level: p.level,
      rank: p.rank,
      xp: p.xp
    }));

  res.json(ranking);
});

app.get("/dashboard/most-playtime", (req, res) => {
  const data = loadData();

  const ranking = data.players
    .sort((a, b) => b.totalPlayTime - a.totalPlayTime)
    .map(p => ({
      playerName: p.playerName,
      totalPlayTime: p.totalPlayTime
    }));

  res.json(ranking);
});

app.get("/dashboard/most-wins", (req, res) => {
  const data = loadData();

  const ranking = data.players
    .sort((a, b) => b.racesWon - a.racesWon)
    .map(p => ({
      playerName: p.playerName,
      racesWon: p.racesWon,
      racesPlayed: p.racesPlayed
    }));

  res.json(ranking);
});

app.listen(PORT, () => {
  console.log("Servidor online em http://localhost:" + PORT);
  console.log("Painel admin em http://localhost:" + PORT + "/admin");
});
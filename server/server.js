const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { Pool } = require("pg");

const app = express();

const PORT = process.env.PORT || 3000;
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || "admin123";
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";

if (!process.env.DATABASE_URL) {
  console.error("ERRO: DATABASE_URL não configurado.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

app.use(cors({
  origin: CORS_ORIGIN
}));

app.use(express.json({ limit: "2mb" }));

async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      linked_player_name TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id SERIAL PRIMARY KEY,
      username TEXT NOT NULL,
      token TEXT UNIQUE NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      expires_at TIMESTAMP NOT NULL
    );

    CREATE TABLE IF NOT EXISTS players (
      player_name TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      updated_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS link_codes (
      code TEXT PRIMARY KEY,
      player_name TEXT NOT NULL,
      used BOOLEAN DEFAULT FALSE,
      used_by TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      expires_at TIMESTAMP NOT NULL,
      used_at TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS badges (
      badge_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      icon TEXT DEFAULT '🏅',
      description TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS events (
      event_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      requirement_type TEXT NOT NULL,
      requirement_value FLOAT NOT NULL,
      reward_badge TEXT NOT NULL,
      active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT NOW(),
      expires_at TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS redeem_codes (
      code TEXT PRIMARY KEY,
      player_name TEXT NOT NULL,
      event_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      reward_badge TEXT NOT NULL,
      used BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT NOW(),
      used_at TIMESTAMP
    );
  `);

  await pool.query(`
    INSERT INTO badges (badge_id, name, icon, description)
    VALUES ('BADGE_WIN_10', '10 Vitórias', '🏆', 'Ganhou 10 corridas.')
    ON CONFLICT (badge_id) DO NOTHING;
  `);

  await pool.query(`
    INSERT INTO events (
      event_id,
      title,
      description,
      requirement_type,
      requirement_value,
      reward_badge,
      active
    )
    VALUES (
      'EVENT_WIN_10',
      'Desafio das 10 Vitórias',
      'Ganhe 10 corridas para desbloquear uma insígnia.',
      'RACES_WON',
      10,
      'BADGE_WIN_10',
      TRUE
    )
    ON CONFLICT (event_id) DO NOTHING;
  `);

  console.log("Banco iniciado com sucesso.");
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

function generateToken() {
  return crypto.randomBytes(32).toString("hex");
}

function generateLinkCode() {
  return "LINK-" + crypto.randomBytes(3).toString("hex").toUpperCase();
}

function generateRedeemCode() {
  return "EVT-" + crypto.randomBytes(3).toString("hex").toUpperCase();
}

async function getPlayer(playerName) {
  const result = await pool.query(
    "SELECT data FROM players WHERE LOWER(player_name) = LOWER($1)",
    [playerName]
  );

  if (result.rows.length === 0) return null;
  return result.rows[0].data;
}

async function savePlayer(player) {
  await pool.query(
    `
    INSERT INTO players (player_name, data, updated_at)
    VALUES ($1, $2, NOW())
    ON CONFLICT (player_name)
    DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()
    `,
    [player.playerName, player]
  );
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

function isExpired(expiresAt) {
  if (!expiresAt) return false;
  return new Date(expiresAt) < new Date();
}

async function evaluateEventsForPlayer(player) {
  const eventsResult = await pool.query(
    "SELECT * FROM events WHERE active = TRUE"
  );

  for (const event of eventsResult.rows) {
    if (isExpired(event.expires_at)) continue;

    const current = getEventCurrentValue(player, event.requirement_type);

    if (current < Number(event.requirement_value)) continue;

    if (!player.badges) player.badges = [];

    if (player.badges.includes(event.reward_badge)) continue;

    const existing = await pool.query(
      `
      SELECT code FROM redeem_codes
      WHERE LOWER(player_name) = LOWER($1)
      AND event_id = $2
      AND used = FALSE
      `,
      [player.playerName, event.event_id]
    );

    if (existing.rows.length > 0) continue;

    await pool.query(
      `
      INSERT INTO redeem_codes (
        code,
        player_name,
        event_id,
        title,
        description,
        reward_badge,
        used
      )
      VALUES ($1, $2, $3, $4, $5, $6, FALSE)
      `,
      [
        generateRedeemCode(),
        player.playerName,
        event.event_id,
        event.title,
        event.description,
        event.reward_badge
      ]
    );
  }
}

async function requireLogin(req, res, next) {
  try {
    const auth = req.headers.authorization;
    if (!auth) return res.status(401).json({ error: "Não autorizado" });

    const token = auth.replace("Bearer ", "");

    const result = await pool.query(
      `
      SELECT users.username, users.linked_player_name
      FROM sessions
      JOIN users ON users.username = sessions.username
      WHERE sessions.token = $1
      AND sessions.expires_at > NOW()
      `,
      [token]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: "Não autorizado" });
    }

    req.user = {
      username: result.rows[0].username,
      linkedPlayerName: result.rows[0].linked_player_name
    };

    req.token = token;

    next();
  } catch (err) {
    res.status(500).json({ error: "Erro interno" });
  }
}

function requireAdmin(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: "Admin não autorizado" });

  const token = auth.replace("Bearer ", "");

  if (token !== "ADMIN_TOKEN") {
    return res.status(401).json({ error: "Admin não autorizado" });
  }

  next();
}

app.get("/", (req, res) => {
  res.json({
    status: "API ONLINE",
    message: "Servidor do Racing Game Hub funcionando"
  });
});

// AUTH

app.post("/auth/register", async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: "Usuário e senha são obrigatórios" });
    }

    if (username.length < 3) {
      return res.status(400).json({ error: "Usuário precisa ter pelo menos 3 caracteres" });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: "Senha precisa ter pelo menos 6 caracteres" });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    await pool.query(
      `
      INSERT INTO users (username, password_hash)
      VALUES ($1, $2)
      `,
      [username, passwordHash]
    );

    res.json({
      success: true,
      message: "Conta criada com sucesso"
    });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(400).json({ error: "Esse usuário já existe" });
    }

    res.status(500).json({ error: "Erro ao criar conta" });
  }
});

app.post("/auth/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    const result = await pool.query(
      "SELECT * FROM users WHERE LOWER(username) = LOWER($1)",
      [username || ""]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: "Usuário ou senha inválidos" });
    }

    const user = result.rows[0];

    const validPassword = await bcrypt.compare(password || "", user.password_hash);

    if (!validPassword) {
      return res.status(401).json({ error: "Usuário ou senha inválidos" });
    }

    const token = generateToken();

    await pool.query(
      `
      INSERT INTO sessions (username, token, expires_at)
      VALUES ($1, $2, NOW() + INTERVAL '7 days')
      `,
      [user.username, token]
    );

    res.json({
      success: true,
      token,
      username: user.username,
      linkedPlayerName: user.linked_player_name
    });
  } catch (err) {
    res.status(500).json({ error: "Erro ao fazer login" });
  }
});

app.post("/auth/logout", requireLogin, async (req, res) => {
  await pool.query("DELETE FROM sessions WHERE token = $1", [req.token]);

  res.json({
    success: true,
    message: "Logout feito"
  });
});

app.get("/profile/me", requireLogin, async (req, res) => {
  if (!req.user.linkedPlayerName) {
    return res.json({
      username: req.user.username,
      linkedPlayerName: null,
      player: null
    });
  }

  const player = await getPlayer(req.user.linkedPlayerName);

  res.json({
    username: req.user.username,
    linkedPlayerName: req.user.linkedPlayerName,
    player
  });
});

// LINK CONTA

app.post("/link/create", async (req, res) => {
  try {
    const { playerName } = req.body;

    if (!playerName) {
      return res.status(400).json({ error: "playerName obrigatório" });
    }

    let player = await getPlayer(playerName);

    if (!player) {
      player = createEmptyPlayer(playerName);
      await savePlayer(player);
    }

    await pool.query(
      `
      DELETE FROM link_codes
      WHERE LOWER(player_name) = LOWER($1)
      AND used = FALSE
      `,
      [playerName]
    );

    const code = generateLinkCode();

    await pool.query(
      `
      INSERT INTO link_codes (code, player_name, expires_at)
      VALUES ($1, $2, NOW() + INTERVAL '10 minutes')
      `,
      [code, playerName]
    );

    res.json({
      success: true,
      code
    });
  } catch (err) {
    res.status(500).json({ error: "Erro ao gerar código" });
  }
});

app.post("/link/confirm", requireLogin, async (req, res) => {
  try {
    const { code } = req.body;

    if (!code) {
      return res.status(400).json({ error: "Código obrigatório" });
    }

    const result = await pool.query(
      `
      SELECT * FROM link_codes
      WHERE UPPER(code) = UPPER($1)
      `,
      [code]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Código inválido" });
    }

    const link = result.rows[0];

    if (link.used) {
      return res.status(400).json({ error: "Código já utilizado" });
    }

    if (new Date(link.expires_at) < new Date()) {
      return res.status(400).json({ error: "Código expirado" });
    }

    const already = await pool.query(
      `
      SELECT username FROM users
      WHERE LOWER(linked_player_name) = LOWER($1)
      AND username <> $2
      `,
      [link.player_name, req.user.username]
    );

    if (already.rows.length > 0) {
      return res.status(403).json({ error: "Esse jogador já está vinculado a outra conta" });
    }

    await pool.query(
      "UPDATE users SET linked_player_name = $1 WHERE username = $2",
      [link.player_name, req.user.username]
    );

    await pool.query(
      `
      UPDATE link_codes
      SET used = TRUE, used_by = $1, used_at = NOW()
      WHERE code = $2
      `,
      [req.user.username, link.code]
    );

    res.json({
      success: true,
      message: "Conta vinculada com sucesso",
      linkedPlayerName: link.player_name
    });
  } catch (err) {
    res.status(500).json({ error: "Erro ao vincular conta" });
  }
});

// UNITY UPDATE

app.post("/update-player", async (req, res) => {
  try {
    const player = req.body;

    if (!player.playerName) {
      return res.status(400).json({ error: "playerName obrigatório" });
    }

    let existing = await getPlayer(player.playerName);

    if (!existing) {
      existing = createEmptyPlayer(player.playerName);
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

    await savePlayer(existing);
    await evaluateEventsForPlayer(existing);

    res.json({
      success: true,
      message: "Player atualizado"
    });
  } catch (err) {
    res.status(500).json({ error: "Erro ao atualizar player" });
  }
});

// EVENTOS NO JOGO

app.get("/events/progress/:playerName", async (req, res) => {
  try {
    const player = await getPlayer(req.params.playerName);

    if (!player) {
      return res.status(404).json({ error: "Jogador não encontrado" });
    }

    const events = await pool.query(
      "SELECT * FROM events WHERE active = TRUE"
    );

    const result = [];

    for (const event of events.rows) {
      if (isExpired(event.expires_at)) continue;

      const currentValue = getEventCurrentValue(player, event.requirement_type);
      const completed = currentValue >= Number(event.requirement_value);

      if (completed) continue;

      result.push({
        eventId: event.event_id,
        title: event.title,
        description: event.description,
        requirementType: event.requirement_type,
        currentValue,
        requirementValue: Number(event.requirement_value),
        rewardBadge: event.reward_badge,
        expiresAt: event.expires_at,
        completed
      });
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: "Erro ao carregar eventos" });
  }
});

// REWARDS

app.get("/rewards/available", requireLogin, async (req, res) => {
  if (!req.user.linkedPlayerName) {
    return res.status(400).json({ error: "Conta não vinculada ao jogo" });
  }

  const result = await pool.query(
    `
    SELECT * FROM redeem_codes
    WHERE LOWER(player_name) = LOWER($1)
    AND used = FALSE
    `,
    [req.user.linkedPlayerName]
  );

  res.json(result.rows.map(r => ({
    code: r.code,
    playerName: r.player_name,
    eventId: r.event_id,
    title: r.title,
    description: r.description,
    rewardBadge: r.reward_badge,
    used: r.used,
    createdAt: r.created_at
  })));
});

app.post("/rewards/redeem", requireLogin, async (req, res) => {
  try {
    const { code } = req.body;

    if (!code) {
      return res.status(400).json({ error: "Código obrigatório" });
    }

    if (!req.user.linkedPlayerName) {
      return res.status(400).json({ error: "Conta não vinculada ao jogo" });
    }

    const result = await pool.query(
      "SELECT * FROM redeem_codes WHERE UPPER(code) = UPPER($1)",
      [code]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Código inválido" });
    }

    const redeem = result.rows[0];

    if (redeem.used) {
      return res.status(400).json({ error: "Código já utilizado" });
    }

    if (redeem.player_name.toLowerCase() !== req.user.linkedPlayerName.toLowerCase()) {
      return res.status(403).json({ error: "Esse código não pertence à sua conta" });
    }

    const player = await getPlayer(req.user.linkedPlayerName);

    if (!player.badges) player.badges = [];

    if (!player.badges.includes(redeem.reward_badge)) {
      player.badges.push(redeem.reward_badge);
    }

    await savePlayer(player);

    await pool.query(
      "UPDATE redeem_codes SET used = TRUE, used_at = NOW() WHERE code = $1",
      [redeem.code]
    );

    res.json({
      success: true,
      message: "Insígnia resgatada com sucesso",
      badge: redeem.reward_badge
    });
  } catch (err) {
    res.status(500).json({ error: "Erro ao resgatar código" });
  }
});

// BADGES

app.get("/badges", async (req, res) => {
  const result = await pool.query("SELECT * FROM badges ORDER BY name ASC");

  res.json(result.rows.map(b => ({
    badgeId: b.badge_id,
    name: b.name,
    icon: b.icon,
    description: b.description
  })));
});

// ADMIN

app.post("/admin/login", (req, res) => {
  const { username, password } = req.body;

  if (username === ADMIN_USER && password === ADMIN_PASS) {
    return res.json({
      success: true,
      token: "ADMIN_TOKEN"
    });
  }

  res.status(401).json({ error: "Admin inválido" });
});

app.get("/admin/data", requireAdmin, async (req, res) => {
  const badges = await pool.query("SELECT * FROM badges ORDER BY name ASC");
  const events = await pool.query("SELECT * FROM events ORDER BY created_at DESC");

  res.json({
    badges: badges.rows.map(b => ({
      badgeId: b.badge_id,
      name: b.name,
      icon: b.icon,
      description: b.description
    })),
    events: events.rows.map(e => ({
      eventId: e.event_id,
      title: e.title,
      description: e.description,
      requirementType: e.requirement_type,
      requirementValue: Number(e.requirement_value),
      rewardBadge: e.reward_badge,
      active: e.active,
      expiresAt: e.expires_at
    }))
  });
});

app.post("/admin/badges", requireAdmin, async (req, res) => {
  try {
    const { badgeId, name, icon, description } = req.body;

    if (!badgeId || !name) {
      return res.status(400).json({ error: "badgeId e name são obrigatórios" });
    }

    await pool.query(
      `
      INSERT INTO badges (badge_id, name, icon, description)
      VALUES ($1, $2, $3, $4)
      `,
      [badgeId, name, icon || "🏅", description || ""]
    );

    res.json({
      success: true,
      message: "Insígnia criada"
    });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(400).json({ error: "Essa insígnia já existe" });
    }

    res.status(500).json({ error: "Erro ao criar insígnia" });
  }
});

app.delete("/admin/badges/:badgeId", requireAdmin, async (req, res) => {
  await pool.query(
    "DELETE FROM badges WHERE badge_id = $1",
    [req.params.badgeId]
  );

  res.json({
    success: true,
    message: "Insígnia excluída"
  });
});

app.post("/admin/events", requireAdmin, async (req, res) => {
  try {
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

    if (!eventId || !title || !requirementType || !requirementValue || !rewardBadge) {
      return res.status(400).json({ error: "Preencha todos os campos obrigatórios" });
    }

    let expiresAt = null;

    if (durationDays && Number(durationDays) > 0) {
      expiresAt = new Date(Date.now() + Number(durationDays) * 24 * 60 * 60 * 1000);
    }

    await pool.query(
      `
      INSERT INTO events (
        event_id,
        title,
        description,
        requirement_type,
        requirement_value,
        reward_badge,
        active,
        expires_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
      [
        eventId,
        title,
        description || "",
        requirementType,
        Number(requirementValue),
        rewardBadge,
        active === true,
        expiresAt
      ]
    );

    res.json({
      success: true,
      message: "Evento criado"
    });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(400).json({ error: "Esse evento já existe" });
    }

    res.status(500).json({ error: "Erro ao criar evento" });
  }
});

app.patch("/admin/events/:eventId/toggle", requireAdmin, async (req, res) => {
  await pool.query(
    `
    UPDATE events
    SET active = NOT active
    WHERE event_id = $1
    `,
    [req.params.eventId]
  );

  res.json({
    success: true,
    message: "Status do evento alterado"
  });
});

app.delete("/admin/events/:eventId", requireAdmin, async (req, res) => {
  await pool.query(
    "DELETE FROM events WHERE event_id = $1",
    [req.params.eventId]
  );

  res.json({
    success: true,
    message: "Evento excluído"
  });
});

// DASHBOARDS

app.get("/dashboard/best-times", async (req, res) => {
  const players = await pool.query("SELECT data FROM players");

  const best = {};

  players.rows.forEach(row => {
    const player = row.data;

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

app.get("/dashboard/top-level", async (req, res) => {
  const players = await pool.query("SELECT data FROM players");

  const ranking = players.rows
    .map(r => r.data)
    .sort((a, b) => (b.level || 0) - (a.level || 0) || (b.xp || 0) - (a.xp || 0))
    .map(p => ({
      playerName: p.playerName,
      level: p.level,
      rank: p.rank,
      xp: p.xp
    }));

  res.json(ranking);
});

app.get("/dashboard/most-playtime", async (req, res) => {
  const players = await pool.query("SELECT data FROM players");

  const ranking = players.rows
    .map(r => r.data)
    .sort((a, b) => (b.totalPlayTime || 0) - (a.totalPlayTime || 0))
    .map(p => ({
      playerName: p.playerName,
      totalPlayTime: p.totalPlayTime
    }));

  res.json(ranking);
});

app.get("/dashboard/most-wins", async (req, res) => {
  const players = await pool.query("SELECT data FROM players");

  const ranking = players.rows
    .map(r => r.data)
    .sort((a, b) => (b.racesWon || 0) - (a.racesWon || 0))
    .map(p => ({
      playerName: p.playerName,
      racesWon: p.racesWon,
      racesPlayed: p.racesPlayed
    }));

  res.json(ranking);
});

app.post("/admin/reset-dashboards", requireAdmin, async (req, res) => {
  try {
    const players = await pool.query("SELECT player_name, data FROM players");

    for (const row of players.rows) {
      const player = row.data;

      player.level = 1;
      player.rank = "Novato";
      player.xp = 0;
      player.totalPlayTime = 0;
      player.distanceDrivenKm = 0;
      player.racesWon = 0;
      player.racesPlayed = 0;
      player.matchHistory = [];

      await pool.query(
        `
        UPDATE players
        SET data = $1, updated_at = NOW()
        WHERE player_name = $2
        `,
        [player, row.player_name]
      );
    }

    await pool.query("DELETE FROM redeem_codes");

    res.json({
      success: true,
      message: "Dashboards resetados com sucesso."
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: "Erro ao resetar dashboards."
    });
  }
});


initDatabase()
  .then(() => {
    app.listen(PORT, () => {
      console.log("Servidor online na porta " + PORT);
    });
  })
  .catch(err => {
    console.error("Erro ao iniciar banco:", err);
    process.exit(1);
  });
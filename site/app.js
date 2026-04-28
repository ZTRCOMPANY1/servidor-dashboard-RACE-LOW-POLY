const API = "https://servidor-dashboard-race-low-poly.onrender.com";

let token = localStorage.getItem("hubToken") || "";
let badgeList = [];

function authHeaders() {
  return {
    "Content-Type": "application/json",
    "Authorization": "Bearer " + token
  };
}

function formatRaceTime(time) {
  const minutes = Math.floor(time / 60);
  const seconds = Math.floor(time % 60);
  const milliseconds = Math.floor((time * 1000) % 1000);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(milliseconds).padStart(3, "0")}`;
}

function formatTotalTime(time) {
  const totalSeconds = Math.floor(time);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

async function loadBadgesPublic() {
  const res = await fetch(API + "/badges");
  badgeList = await res.json();
}

function badgeName(id) {
  const badge = badgeList.find(b => b.badgeId === id);
  if (!badge) return id;
  return `${badge.icon} ${badge.name}`;
}

async function register() {
  const username = document.getElementById("username").value.trim();
  const password = document.getElementById("password").value;

  const res = await fetch(API + "/auth/register", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({ username, password })
  });

  const data = await res.json();
  document.getElementById("authStatus").innerText = data.message || data.error;
}

async function login() {
  const username = document.getElementById("username").value.trim();
  const password = document.getElementById("password").value;

  const res = await fetch(API + "/auth/login", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({ username, password })
  });

  const data = await res.json();

  if (!res.ok) {
    document.getElementById("authStatus").innerText = data.error;
    return;
  }

  token = data.token;
  localStorage.setItem("hubToken", token);

  document.getElementById("authStatus").innerText = "Login feito.";
  loadMyProfile();
}

async function logout() {
  await fetch(API + "/auth/logout", {
    method: "POST",
    headers: authHeaders()
  });

  token = "";
  localStorage.removeItem("hubToken");

  document.getElementById("profileCard").style.display = "none";
  document.getElementById("authCard").style.display = "block";
}

async function loadMyProfile() {
  if (!token) return;

  const res = await fetch(API + "/profile/me", {
    headers: authHeaders()
  });

  if (!res.ok) {
    token = "";
    localStorage.removeItem("hubToken");
    return;
  }

  const data = await res.json();

  document.getElementById("authCard").style.display = "none";
  document.getElementById("profileCard").style.display = "block";

  document.getElementById("profileUser").innerText = "Conta: " + data.username;

  if (!data.player) {
    document.getElementById("profilePlayer").innerText = "Nenhum jogador vinculado ainda.";
    document.getElementById("profileStats").innerText = "";
    document.getElementById("linkArea").style.display = "block";
    document.getElementById("rewardArea").style.display = "none";
    return;
  }

  const p = data.player;

  document.getElementById("linkArea").style.display = "none";
  document.getElementById("rewardArea").style.display = "block";

  document.getElementById("profilePlayer").innerText = "Jogador vinculado: " + p.playerName;
  document.getElementById("profileStats").innerText =
    `Nível ${p.level} | ${p.rank} | XP ${p.xp} | ${p.racesWon} vitórias | ${formatTotalTime(p.totalPlayTime)} jogado`;

  renderBadges(p.badges || []);
  loadAvailableCodes();
}

async function confirmLink() {
  const code = document.getElementById("linkCodeInput").value.trim();

  if (!code) {
    document.getElementById("linkStatus").innerText = "Digite o código.";
    return;
  }

  const res = await fetch(API + "/link/confirm", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ code })
  });

  const data = await res.json();

  if (!res.ok) {
    document.getElementById("linkStatus").innerText = data.error;
    return;
  }

  document.getElementById("linkStatus").innerText = data.message;
  loadMyProfile();
}

async function loadAvailableCodes() {
  const res = await fetch(API + "/rewards/available", {
    headers: authHeaders()
  });

  const el = document.getElementById("availableCodes");
  el.innerHTML = "";

  if (!res.ok) {
    el.innerHTML = "Nenhum código disponível.";
    return;
  }

  const codes = await res.json();

  if (codes.length === 0) {
    el.innerHTML = "Nenhum código disponível.";
    return;
  }

  codes.forEach(c => {
    el.innerHTML += `
      <div class="item">
        <strong>${c.title}</strong><br>
        ${c.description || ""}<br>
        Código: <strong>${c.code}</strong><br>
        Recompensa: ${badgeName(c.rewardBadge)}<br>
        <button onclick="redeemReward('${c.code}')">Resgatar</button>
      </div>
    `;
  });
}

async function redeemReward(code) {
  const res = await fetch(API + "/rewards/redeem", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ code })
  });

  const data = await res.json();

  if (!res.ok) {
    alert(data.error);
    return;
  }

  alert(data.message);
  loadMyProfile();
}

function renderBadges(badges) {
  const el = document.getElementById("badges");
  el.innerHTML = "";

  if (!badges || badges.length === 0) {
    el.innerHTML = "Nenhuma insígnia ainda.";
    return;
  }

  badges.forEach(b => {
    el.innerHTML += `<div class="badge">${badgeName(b)}</div>`;
  });
}

async function loadBestTimes() {
  const res = await fetch(API + "/dashboard/best-times");
  const data = await res.json();
  const el = document.getElementById("bestTimes");
  el.innerHTML = "";

  if (data.length === 0) {
    el.innerHTML = "Nenhum tempo registrado.";
    return;
  }

  data.forEach(item => {
    el.innerHTML += `<div class="item"><strong>${item.trackName}</strong><br>${item.playerName} — ${formatRaceTime(item.raceTime)}</div>`;
  });
}

async function loadTopLevel() {
  const res = await fetch(API + "/dashboard/top-level");
  const data = await res.json();
  const el = document.getElementById("topLevel");
  el.innerHTML = "";

  if (data.length === 0) {
    el.innerHTML = "Nenhum jogador registrado.";
    return;
  }

  data.forEach((p, i) => {
    el.innerHTML += `<div class="item">#${i + 1} ${p.playerName} — Nível ${p.level} — ${p.rank} — XP ${p.xp}</div>`;
  });
}

async function loadPlaytime() {
  const res = await fetch(API + "/dashboard/most-playtime");
  const data = await res.json();
  const el = document.getElementById("playtime");
  el.innerHTML = "";

  data.forEach((p, i) => {
    el.innerHTML += `<div class="item">#${i + 1} ${p.playerName} — ${formatTotalTime(p.totalPlayTime)}</div>`;
  });
}

async function loadWins() {
  const res = await fetch(API + "/dashboard/most-wins");
  const data = await res.json();
  const el = document.getElementById("wins");
  el.innerHTML = "";

  data.forEach((p, i) => {
    el.innerHTML += `<div class="item">#${i + 1} ${p.playerName} — ${p.racesWon} vitórias / ${p.racesPlayed} corridas</div>`;
  });
}

async function init() {
  await loadBadgesPublic();
  loadMyProfile();
  loadBestTimes();
  loadTopLevel();
  loadPlaytime();
  loadWins();
}

init();
setInterval(() => {
  loadBestTimes();
  loadTopLevel();
  loadPlaytime();
  loadWins();
}, 5000);
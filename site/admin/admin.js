const API = "https://servidor-dashboard-race-low-poly.onrender.com";

let adminToken = localStorage.getItem("adminToken") || "";

function apiUrl(route) {
  return API + route;
}

function adminHeaders() {
  return {
    "Content-Type": "application/json",
    "Authorization": "Bearer " + adminToken
  };
}

async function adminLogin() {
  const username = document.getElementById("adminUser").value.trim();
  const password = document.getElementById("adminPass").value;

  const res = await fetch(apiUrl("/admin/login"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ username, password })
  });

  const data = await res.json();

  if (!res.ok) {
    document.getElementById("loginStatus").innerText = data.error || "Erro no login admin.";
    return;
  }

  adminToken = data.token;
  localStorage.setItem("adminToken", adminToken);

  document.getElementById("loginCard").style.display = "none";
  document.getElementById("adminPanel").style.display = "block";

  loadAdminData();
}

async function loadAdminData() {
  if (!adminToken) return;

  const res = await fetch(apiUrl("/admin/data"), {
    method: "GET",
    headers: adminHeaders()
  });

  const data = await res.json();

  if (!res.ok) {
    console.log(data);
    adminToken = "";
    localStorage.removeItem("adminToken");
    document.getElementById("loginCard").style.display = "block";
    document.getElementById("adminPanel").style.display = "none";
    document.getElementById("loginStatus").innerText = data.error || "Admin não autorizado.";
    return;
  }

  renderBadges(data.badges);
  renderEvents(data.events);
  fillBadgeSelect(data.badges);

  document.getElementById("loginCard").style.display = "none";
  document.getElementById("adminPanel").style.display = "block";
}

function fillBadgeSelect(badges) {
  const select = document.getElementById("rewardBadge");
  select.innerHTML = "";

  badges.forEach(b => {
    select.innerHTML += `<option value="${b.badgeId}">${b.icon} ${b.name} (${b.badgeId})</option>`;
  });
}

function renderBadges(badges) {
  const el = document.getElementById("badgeList");
  el.innerHTML = "";

  if (badges.length === 0) {
    el.innerHTML = "Nenhuma insígnia criada.";
    return;
  }

  badges.forEach(b => {
    el.innerHTML += `
      <div class="item">
        <strong>${b.icon} ${b.name}</strong><br>
        ID: ${b.badgeId}<br>
        ${b.description || ""}
        <br>
        <button class="danger" onclick="deleteBadge('${b.badgeId}')">Excluir</button>
      </div>
    `;
  });
}

function renderEvents(events) {
  const el = document.getElementById("eventList");
  el.innerHTML = "";

  if (events.length === 0) {
    el.innerHTML = "Nenhum evento criado.";
    return;
  }

  events.forEach(e => {
    el.innerHTML += `
      <div class="item">
        <strong>${e.title}</strong><br>
        ID: ${e.eventId}<br>
        Requisito: ${e.requirementType} >= ${e.requirementValue}<br>
        Recompensa: ${e.rewardBadge}<br>
        Status: ${e.active ? "Ativo" : "Desativado"}<br>
        Expira em: ${e.expiresAt ? new Date(e.expiresAt).toLocaleString() : "Sem validade"}<br>
        ${e.description || ""}
        <br>
        <button class="warning" onclick="toggleEvent('${e.eventId}')">Ativar/Desativar</button>
        <button class="danger" onclick="deleteEvent('${e.eventId}')">Excluir</button>
      </div>
    `;
  });
}

async function createBadge() {
  const badgeId = document.getElementById("badgeId").value.trim();
  const name = document.getElementById("badgeName").value.trim();
  const icon = document.getElementById("badgeIcon").value.trim();
  const description = document.getElementById("badgeDesc").value.trim();

  const res = await fetch(apiUrl("/admin/badges"), {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify({ badgeId, name, icon, description })
  });

  const data = await res.json();
  document.getElementById("badgeStatus").innerText = data.message || data.error;

  if (res.ok) {
    document.getElementById("badgeId").value = "";
    document.getElementById("badgeName").value = "";
    document.getElementById("badgeIcon").value = "";
    document.getElementById("badgeDesc").value = "";
    loadAdminData();
  }
}

async function createGameEvent() {
  const eventId = document.getElementById("eventId").value.trim();
  const durationDays = Number(document.getElementById("durationDays").value);
  const title = document.getElementById("eventTitle").value.trim();
  const description = document.getElementById("eventDesc").value.trim();
  const requirementType = document.getElementById("requirementType").value;
  const requirementValue = Number(document.getElementById("requirementValue").value);
  const rewardBadge = document.getElementById("rewardBadge").value;
  const active = document.getElementById("eventActive").checked;

  const res = await fetch(apiUrl("/admin/events"), {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify({
      eventId,
      title,
      description,
      requirementType,
      requirementValue,
      rewardBadge,
      active,
      durationDays
    })
  });

  const data = await res.json();
  document.getElementById("eventStatus").innerText = data.message || data.error;

  if (res.ok) {
    document.getElementById("eventId").value = "";
    document.getElementById("eventTitle").value = "";
    document.getElementById("eventDesc").value = "";
    document.getElementById("requirementValue").value = "";
    document.getElementById("durationDays").value = "";
    loadAdminData();
  }
}

async function toggleEvent(eventId) {
  await fetch(apiUrl("/admin/events/" + encodeURIComponent(eventId) + "/toggle"), {
    method: "PATCH",
    headers: adminHeaders()
  });

  loadAdminData();
}

async function deleteEvent(eventId) {
  if (!confirm("Excluir esse evento?")) return;

  await fetch(apiUrl("/admin/events/" + encodeURIComponent(eventId)), {
    method: "DELETE",
    headers: adminHeaders()
  });

  loadAdminData();
}

async function deleteBadge(badgeId) {
  if (!confirm("Excluir essa insígnia?")) return;

  await fetch(apiUrl("/admin/badges/" + encodeURIComponent(badgeId)), {
    method: "DELETE",
    headers: adminHeaders()
  });

  loadAdminData();
}

loadAdminData();
// Warung Agents UI: renders the live event stream from src/dev.ts.
const $ = (sel) => document.querySelector(sel);
const buyerFeed = $("#buyer-feed");
const warungFeed = $("#warung-feed");

// ---------- helpers ----------
const RP_PER_USDC = 1_000_000;
const usdc = (rp) => `${+(rp / RP_PER_USDC).toFixed(6)} USDC`;
const rupiah = (rp) => `Rp${Number(rp).toLocaleString("id-ID")}`;
const price = (rp) => `${usdc(rp)} (${rupiah(rp)})`;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// Just enough Markdown for agent replies: paragraphs, bullet lists, **bold**.
function renderMarkdown(text) {
  const inline = (s) =>
    escapeHtml(s)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*\s][^*]*?)\*(?!\*)/g, "$1<em>$2</em>");
  let html = "";
  let inList = false;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const bullet = line.match(/^[-*•]\s+(.*)/);
    if (bullet) {
      if (!inList) { html += "<ul>"; inList = true; }
      html += `<li>${inline(bullet[1])}</li>`;
      continue;
    }
    if (inList) { html += "</ul>"; inList = false; }
    if (line) html += `<p>${inline(line)}</p>`;
  }
  if (inList) html += "</ul>";
  return html;
}

function linkify(text) {
  return escapeHtml(text).replace(/https?:\/\/\S+/g, (url) => `<a href="${url}" target="_blank" rel="noopener">${url}</a>`);
}

function append(feed, node) {
  const nearBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 120;
  feed.querySelector(".empty")?.remove();
  feed.appendChild(node);
  if (nearBottom) feed.scrollTop = feed.scrollHeight;
  return node;
}

async function api(path, body) {
  const res = await fetch(path, body === undefined ? {} : {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// ---------- status + balances ----------
async function loadStatus() {
  try {
    const s = await api("/api/status");
    const mode = $("#buyer-mode");
    mode.textContent = s.mock ? "Mock · tanpa blockchain" : "x402 · Base Sepolia";
    mode.classList.toggle("chip--live", !s.mock);
    $("#buyer-sub").textContent =
      `Agent pembeli · ${s.model}${s.solution ? " · kode solution" : " · kode TODO kamu"}`;
    $("#warung-sub").textContent = `${s.warungName} · ${s.warungUrl.replace(/^https?:\/\//, "")}`;
    $("#greedy").checked = s.greedy;
    setBusy(s.busy);
  } catch {
    $("#buyer-mode").textContent = "Server tidak terhubung";
  }
}

async function loadBalance(who) {
  const chip = who === "warung" ? $("#warung-balance") : $("#buyer-balance");
  const label = who === "warung" ? "Kas" : "Saldo";
  try {
    const b = await api(`/api/balance/${who}`);
    chip.textContent = b.error ? `${label}: belum ada wallet` : `${label} ${+b.balanceUsdc.toFixed(4)} USDC`;
    chip.title = b.error || `${b.address} · klik untuk muat ulang`;
  } catch {
    chip.textContent = `${label}: gagal dibaca`;
  }
}
const refreshBalances = () => setTimeout(() => { loadBalance("buyer"); loadBalance("warung"); }, 2500);

// ---------- My Agent panel ----------
let trace = null;      // current list of agent steps
let bill = null;       // current payment decision card
let typing = null;

function setBusy(busy) {
  $("#buyer-send").disabled = busy;
  $("#buyer-input").disabled = busy;
  if (busy && !typing) typing = append(buyerFeed, el("div", "typing", "My Agent sedang bekerja"));
  if (!busy && typing) { typing.remove(); typing = null; }
  if (!busy) $("#buyer-input").focus({ preventScroll: true });
}

function keepTypingLast() {
  if (typing) buyerFeed.appendChild(typing);
}

const TOOL_LABELS = {
  getBalance: () => "Cek saldo wallet",
  getMenu: () => "Lihat menu warung",
  askWarung: (a) => `Tanya warung: “${a.question ?? ""}”`,
  placeOrder: (a) => {
    const items = (a.items ?? []).map((i) => `${i.quantity ?? 1}× ${i.id ?? i.itemId}`).join(", ");
    const budget = Number(a.budgetUsdc) > 0 ? `${a.budgetUsdc} USDC` : rupiah(a.budgetRp ?? 0);
    return `Pesan ${items} · budget ${budget}`;
  },
};

function addStep(text) {
  if (!trace) { trace = append(buyerFeed, el("div", "trace")); }
  const step = el("div", "step");
  const tool = text.match(/^🔧 Tool: (\w+) (.*)$/);
  if (tool) {
    let args = {};
    try { args = JSON.parse(tool[2]); } catch { /* keep raw */ }
    step.textContent = `🔧 ${(TOOL_LABELS[tool[1]] ?? (() => tool[1]))(args)}`;
  } else if (text.startsWith("💸")) {
    step.className = "step step--pay";
    step.textContent = text.replace("402 Payment Required:", "Warung menagih");
  } else if (text.startsWith("🧠")) {
    step.className = "step step--jev";
    // The numbers after "·" are already on the bill card.
    step.textContent = text.split(" · ")[0].replace("confidence", "yakin");
  } else if (text.startsWith("🛡")) {
    step.className = "step step--guard";
    step.textContent = text;
  } else if (text.startsWith("🔗")) {
    step.className = "step step--ok";
    step.innerHTML = linkify(text);
  } else if (text.startsWith("❌")) {
    step.className = "step step--fail";
    step.textContent = text;
  } else {
    step.textContent = text;
  }
  trace.appendChild(step);
  keepTypingLast();
}

const STAMPS = {
  approve: ["Disetujui", "Jev + guardrail"],
  reject: ["Ditolak", "harga tak sesuai menu"],
  ask_human: ["Tanya dulu", "melebihi budget"],
};

function addBill(e) {
  bill = el("article", "bill");
  bill.innerHTML = `
    <p class="bill__title">Tagihan dari warung</p>
    <p class="bill__order"></p>
    <dl>
      <dt>Harga menu</dt><dd>${price(e.menuPriceRp)}</dd>
      <dt>Ditagih</dt><dd class="${e.requestedPriceRp > e.menuPriceRp ? "over" : ""}">${price(e.requestedPriceRp)}</dd>
      <dt>Budget kamu</dt><dd class="${e.requestedPriceRp > e.budgetRp ? "over" : ""}">${price(e.budgetRp)}</dd>
    </dl>`;
  bill.querySelector(".bill__order").textContent = e.order;
  const [label, note] = STAMPS[e.decision] ?? [e.decision, ""];
  const stamp = el("div", `stamp stamp--${e.decision}`, label);
  stamp.appendChild(el("small", "", note));
  bill.appendChild(stamp);
  bill.dataset.requested = e.requestedPriceRp;
  append(buyerFeed, bill);
  trace = null; // later steps start a new block below the bill
  keepTypingLast();
}

function addConfirm(e) {
  const target = bill ?? append(buyerFeed, el("article", "bill"));
  const actions = el("div", "bill__actions");
  actions.dataset.confirmId = e.confirmId;
  const amount = target.dataset.requested ? usdc(Number(target.dataset.requested)) : "";
  const pay = el("button", "pay", `Bayar ${amount}`.trim());
  const decline = el("button", "decline", "Jangan bayar");
  pay.type = decline.type = "button";
  const answer = async (approve) => {
    pay.disabled = decline.disabled = true;
    try { await api("/api/confirm", { confirmId: e.confirmId, approve }); }
    catch (error) { actions.replaceWith(el("p", "bill__note", error.message)); }
  };
  pay.onclick = () => answer(true);
  decline.onclick = () => answer(false);
  actions.append(pay, decline);
  target.appendChild(actions);
  pay.focus({ preventScroll: true });
}

function addConfirmed(e) {
  const actions = buyerFeed.querySelector(`[data-confirm-id="${e.confirmId}"]`);
  const note = el("p", "bill__note", e.approve ? "Kamu memilih: bayar." : "Kamu memilih: jangan bayar. Tidak ada uang keluar.");
  if (actions) actions.replaceWith(note);
}

function addOrderResult(e) {
  const note = el("p", "bill__note");
  if (e.paid) {
    const real = e.tx && !String(e.tx).startsWith("0xmock");
    note.innerHTML = real
      ? `Lunas di blockchain · <a href="https://sepolia.basescan.org/tx/${escapeHtml(e.tx)}" target="_blank" rel="noopener">lihat transaksi</a>`
      : `Lunas (mock, tanpa blockchain) · <a>${escapeHtml(String(e.tx ?? ""))}</a>`;
    refreshBalances();
  } else {
    const REASONS = {
      "Rejected: the requested price does not match the menu": "Ditolak: harga yang ditagih tidak sesuai menu. Tidak ada uang keluar.",
      "Not paid: the user declined because it is over budget": "Tidak dibayar: melebihi budget dan kamu memilih tidak bayar.",
    };
    note.textContent = REASONS[e.reason] ?? e.reason ?? "Tidak dibayar.";
  }
  if (bill) bill.appendChild(note);
  else addStep(`❌ ${e.reason ?? "Order failed"}`);
}

function addMessage(kind, text) {
  const msg = el("div", `msg msg--${kind}`);
  if (kind === "agent") {
    msg.appendChild(el("span", "who", "My Agent"));
    msg.insertAdjacentHTML("beforeend", renderMarkdown(text));
  } else {
    msg.appendChild(el("p", "", text));
  }
  append(buyerFeed, msg);
  keepTypingLast();
}

function resetBuyer() {
  buyerFeed.innerHTML = "";
  buyerFeed.appendChild(emptyBuyer.cloneNode(true));
  wireSuggestions();
  trace = bill = null;
}

function onBuyerEvent(e) {
  switch (e.kind) {
    case "user": trace = bill = null; addMessage("user", e.text); break;
    case "trace": addStep(e.text); break;
    case "decision": addBill(e); break;
    case "confirm": addConfirm(e); break;
    case "confirmed": addConfirmed(e); break;
    case "order": addOrderResult(e); break;
    case "reply": addMessage("agent", e.text); trace = bill = null; break;
    case "error": append(buyerFeed, el("div", "msg msg--error", `Agent berhenti: ${e.text}`)); break;
    case "busy": setBusy(e.busy); break;
    case "reset": resetBuyer(); break;
  }
}

// ---------- Warung Agent panel ----------
let lastSys = null;
let lastSysText = "";
let sysCount = 0;
let pendingTx = null;
let lastPaid = null;

function sys(text) {
  if (text === lastSysText && lastSys) {
    sysCount += 1;
    lastSys.textContent = `${text} ×${sysCount}`;
    return;
  }
  lastSysText = text;
  sysCount = 1;
  lastSys = append(warungFeed, el("div", "sys", text));
}

function receipt({ head, items, total, status, statusClass, extra }) {
  lastSys = null;
  const r = el("article", "receipt");
  r.appendChild(el("p", "receipt__head", head));
  r.appendChild(el("p", "receipt__shop", $("#warung-sub").textContent.split(" · ")[0] || "Warung"));
  r.appendChild(document.createElement("hr"));
  for (const item of items.split(", ")) {
    const row = el("div", "receipt__row");
    row.append(el("span", "", item), el("span", "", ""));
    r.appendChild(row);
  }
  r.appendChild(document.createElement("hr"));
  const totalRow = el("div", "receipt__row receipt__total");
  totalRow.append(el("span", "", "TOTAL"), el("span", "", total));
  r.appendChild(totalRow);
  r.appendChild(el("p", `receipt__status ${statusClass}`, status));
  if (extra) r.appendChild(extra);
  return append(warungFeed, r);
}

function txLine(url) {
  const p = el("p", "receipt__shop");
  p.innerHTML = `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">lihat di basescan</a>`;
  return p;
}

function onWarungLine(text) {
  let m;
  if ((m = text.match(/^💬 (Buyer Agent|Customer) asks: (.*)$/))) {
    lastSys = null;
    const q = append(warungFeed, el("div", "qa qa--in"));
    q.append(el("span", "who", m[1] === "Customer" ? "Kamu bertanya" : "My Agent bertanya"), el("p", "", m[2]));
    q.querySelector("p").style.margin = "0";
  } else if ((m = text.match(/^💬 Warung answers: (.*)$/))) {
    lastSys = null;
    const a = append(warungFeed, el("div", "qa qa--out"));
    a.append(el("span", "who", "Warung Agent"), el("p", "", m[1]));
    a.querySelector("p").style.margin = "0";
  } else if ((m = text.match(/^🧾 New order (.*): asking for (.*) \(402\)$/))) {
    receipt({ head: "Tagihan", items: m[1], total: m[2].split(" (")[0], status: "402 · Menunggu bayar", statusClass: "receipt__status--due" });
  } else if ((m = text.match(/^✅ Payment received! Order #(\d+): (.*) \((\S+ USDC) \(Rp[\d.]+\)\)( \(mock\))?$/))) {
    lastPaid = receipt({
      head: `Nota #${m[1]}`,
      items: m[2],
      total: m[3],
      status: m[4] ? "Lunas (mock)" : "Lunas",
      statusClass: "receipt__status--paid",
      extra: pendingTx ? txLine(pendingTx) : undefined,
    });
    pendingTx = null;
    refreshBalances();
  } else if ((m = text.match(/^🔗 Settled onchain: (\S+)/))) {
    pendingTx = m[1];
  } else if ((m = text.match(/^💳 Payment arrived for (.*), checking it$/))) {
    lastSys = null;
    append(warungFeed, el("div", "alert alert--info", `💳 Pembayaran masuk untuk ${m[1]}, sedang diperiksa`));
  } else if (text.startsWith("❌")) {
    lastSys = null;
    const translated = text
      .replace("Payment rejected at verification:", "Pembayaran ditolak saat verifikasi:")
      .replace("Settlement failed:", "Gagal dicatat di blockchain:")
      .replace(/Payment failed \((\d+)\): (.*) was NOT ordered/, "Pembayaran gagal ($1): $2 tidak jadi dipesan");
    append(warungFeed, el("div", "alert alert--fail", translated));
  } else if (text.startsWith("⚠️") || /error|EADDRINUSE/i.test(text)) {
    lastSys = null;
    append(warungFeed, el("div", "alert alert--warn", text));
  } else if (text.startsWith("📋")) {
    sys("📋 Pembeli melihat menu");
  } else {
    sys(text);
  }
}

function onWarungEvent(e) {
  if (e.kind === "log") onWarungLine(e.text);
  if (e.kind === "restart") {
    lastSys = null;
    append(warungFeed, el("div", "divider", `Warung dinyalakan ulang · mode curang ${e.greedy ? "ON" : "OFF"}`));
    $("#greedy").checked = e.greedy;
  }
}

// ---------- live stream ----------
let lastId = 0;
function connect() {
  const stream = new EventSource("/api/events");
  stream.onmessage = (message) => {
    const e = JSON.parse(message.data);
    if (e.id <= lastId) return; // replayed after a reconnect
    lastId = e.id;
    (e.source === "warung" ? onWarungEvent : onBuyerEvent)(e);
  };
}

// ---------- forms + controls ----------
const emptyBuyer = $("#buyer-empty").cloneNode(true);

async function sendToAgent(text) {
  if (!text.trim()) return;
  $("#buyer-input").value = "";
  try { await api("/api/chat", { message: text }); }
  catch (error) { append(buyerFeed, el("div", "msg msg--error", error.message)); }
}

function wireSuggestions() {
  buyerFeed.querySelectorAll(".suggestion").forEach((b) => (b.onclick = () => sendToAgent(b.textContent)));
}

$("#buyer-form").addEventListener("submit", (event) => {
  event.preventDefault();
  sendToAgent($("#buyer-input").value);
});

$("#warung-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = $("#warung-input");
  const question = input.value.trim();
  if (!question) return;
  input.value = "";
  $("#warung-send").disabled = true;
  try { await api("/api/ask-warung", { question }); }
  catch (error) { append(warungFeed, el("div", "alert alert--fail", error.message)); }
  finally { $("#warung-send").disabled = false; input.focus(); }
});

$("#reset").onclick = async () => {
  try { await api("/api/reset", {}); }
  catch (error) { append(buyerFeed, el("div", "msg msg--error", error.message)); }
};

$("#greedy").addEventListener("change", async (event) => {
  const box = event.target;
  box.disabled = true;
  try { await api("/api/greedy", { on: box.checked }); }
  catch (error) { box.checked = !box.checked; append(warungFeed, el("div", "alert alert--fail", error.message)); }
  finally { box.disabled = false; }
});

$("#buyer-balance").onclick = () => loadBalance("buyer");
$("#warung-balance").onclick = () => loadBalance("warung");

document.querySelectorAll(".tab").forEach((tab) => {
  tab.onclick = () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("is-active", t === tab));
    document.querySelectorAll(".panel").forEach((p) => p.classList.toggle("is-active", p.id === `panel-${tab.dataset.panel}`));
  };
});

wireSuggestions();
loadStatus().then(connect);
loadBalance("buyer");
loadBalance("warung");

// OtakuPier - shared app logic (nav, search, auth, supabase setup)

const SUPABASE_READY = CONFIG.SUPABASE_URL.includes("YOUR-PROJECT-REF") ? false : true;

let currentUser = null;
let currentProfile = null;
let unreadDms = 0;
let activeDmPartner = null; // set by dms.html when a thread is open

// `supabase` global is provided by the Supabase CDN (UMD). We reuse that
// binding for the client instance so pages can call supabase.from(...).
var supabase;

// Try to load the Supabase client. If not configured yet, the community
// features (auth, reviews, rankings, chat) show a "coming soon" state.
function initSupabase() {
  if (!SUPABASE_READY) return;
  if (typeof window.supabase === "undefined") return;

  supabase = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
  supabase.auth.getSession().then(({ data }) => {
    currentUser = data.session?.user || null;
    return refreshCurrentProfile().finally(() => {
      renderNav();
      onAuthChange();
      if (currentUser) {
        claimDailyXp().then((bonus) => {
          if (bonus > 0) showToast(`Daily bonus: +${bonus} XP!`);
        });
        refreshUnreadDms();
        subscribeDmAlerts();
      }
    });
  });
  supabase.auth.onAuthStateChange((_event, session) => {
    currentUser = session?.user || null;
    refreshCurrentProfile().finally(() => {
      renderNav();
      onAuthChange();
      if (currentUser && _event === "SIGNED_IN") {
        claimDailyXp().then((bonus) => {
          if (bonus > 0) showToast(`Daily bonus: +${bonus} XP!`);
        });
        refreshUnreadDms();
        subscribeDmAlerts();
      }
    });
  });
}

// ---------- Unread DM indicator ----------
// Count messages where this user is the recipient and hasn't read them yet.
// The nav "Messages" link shows a badge; it clears when the thread is opened.
async function refreshUnreadDms() {
  unreadDms = 0;
  if (!supabase || !currentUser) return updateDmBadge();
  try {
    const { count } = await supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("recipient_id", currentUser.id)
      .is("read_at", null);
    unreadDms = count || 0;
  } catch (e) {}
  updateDmBadge();
}

function updateDmBadge() {
  const badge = document.getElementById("dmBadge");
  if (!badge) return;
  if (unreadDms > 0) {
    badge.textContent = unreadDms > 99 ? "99+" : String(unreadDms);
    badge.style.display = "";
  } else {
    badge.style.display = "none";
  }
}

let dmAlertChannel = null;
// Realtime alert for incoming DMs: bump the badge and toast when a new
// message arrives addressed to this user.
function subscribeDmAlerts() {
  if (!supabase || !currentUser || dmAlertChannel) return;
  dmAlertChannel = supabase
    .channel("dm-alerts")
    .on("postgres_changes", {
      event: "INSERT",
      schema: "public",
      table: "messages",
      filter: `recipient_id=eq.${currentUser.id}`,
    }, (payload) => {
      const m = payload.new;
      const isFromCurrent = m.sender_id === currentUser.id;
      const viewingThread = m.sender_id === activeDmPartner && m.recipient_id === currentUser.id;
      if (isFromCurrent) return;
      if (!viewingThread) {
        unreadDms += 1;
        showToast("📩 You have a new message");
      } else {
        markDmRead(m.sender_id);
      }
      updateDmBadge();
      renderNav();
    })
    .subscribe();
}

// Call from the DM page once a conversation is opened so the badge clears.
function markDmRead(partnerId) {
  if (!supabase || !currentUser) return;
  supabase.from("messages")
    .update({ read_at: new Date().toISOString() })
    .eq("recipient_id", currentUser.id)
    .eq("sender_id", partnerId)
    .is("read_at", null)
    .then(() => refreshUnreadDms());
}

// Load the signed-in user's DB profile (is_admin, bio, avatar, xp) into a
// cache so pages/nav can check admin status instantly.
async function refreshCurrentProfile() {
  currentProfile = null;
  if (!supabase || !currentUser) return;
  const { data } = await supabase
    .from("profiles")
    .select("id, name, avatar_url, bio, xp, is_admin, created_at")
    .eq("id", currentUser.id)
    .maybeSingle();
  if (data) currentProfile = data;
}

function isAdmin() {
  return !!(currentProfile && currentProfile.is_admin);
}

// Hook for pages that need to re-render after login/logout
function onAuthChange() {
  const handler = window.onAuthStateChanged;
  if (typeof handler === "function") handler(currentUser);
}

function isLoggedIn() {
  return !!currentUser;
}

function getProfile() {
  return {
    name: currentProfile?.name || currentUser?.user_metadata?.full_name || currentUser?.user_metadata?.username || currentUser?.email?.split("@")[0] || "User",
    email: currentUser?.email,
    avatar: currentProfile?.avatar_url || currentUser?.user_metadata?.avatar_url || currentUser?.user_metadata?.avatar || null,
  };
}

async function logout() {
  if (!supabase) return;
  await supabase.auth.signOut();
  showToast("Logged out");
}

// ---------- Navigation ----------
// Detect whether we're in the pages/ subfolder so links stay correct everywhere
function pathPrefix() {
  return window.location.pathname.includes("/pages/") ? "../" : "";
}

const NAV_LINKS = [
  { label: "Home", href: "index.html", file: "index.html", inPages: false },
  { label: "Catalog", href: "pages/catalog.html", file: "catalog.html", inPages: true },
  { label: "Forums", href: "pages/forums.html", file: "forums.html", inPages: true },
  { label: "Clubs", href: "pages/clubs.html", file: "clubs.html", inPages: true },
  { label: "Rankings", href: "pages/rankings.html", file: "rankings.html", inPages: true },
  { label: "Chat", href: "pages/chat.html", file: "chat.html", inPages: true },
];

function linkHref(l) {
  const p = pathPrefix();
  return l.inPages ? `${p}${l.href}` : `${p}${l.href.replace("pages/", "")}`;
}

function renderNav() {
  const nav = document.getElementById("navbar");
  if (!nav) return;

  const p = pathPrefix();
  const current = window.location.pathname.split("/").pop();

  const loggedLinks = isLoggedIn()
    ? NAV_LINKS.concat([
        { label: "My List", href: "pages/mylist.html", file: "mylist.html", inPages: true },
        { label: "Friends", href: "pages/friends.html", file: "friends.html", inPages: true },
        { label: "Messages", href: "pages/dms.html", file: "dms.html", inPages: true },
        { label: "Profile", href: "pages/profile.html", file: "profile.html", inPages: true },
      ].concat(isAdmin()
        ? [{ label: "⚙", title: "Admin panel", href: "pages/admin.html", file: "admin.html", inPages: true }]
        : []))
    : NAV_LINKS;

  const links = loggedLinks.map((l) => {
    const active = current === l.file ? " active" : "";
    const badge = l.label === "Messages" && unreadDms > 0
      ? `<span class="nav-badge" id="dmBadge">${unreadDms > 99 ? "99+" : unreadDms}</span>`
      : "";
    return `<li><a href="${linkHref(l)}" title="${l.title || l.label}" class="${active.trim()}">${l.label}${badge}</a></li>`;
  }).join("");

  const authArea = isLoggedIn()
    ? `<div class="user-menu">
         <a href="${p}pages/profile.html" class="user-avatar" title="${getProfile().name}">${getProfile().avatar
         ? `<img src="${getProfile().avatar}" alt="">`
         : getProfile().name.charAt(0).toUpperCase()}</a>
         <button class="btn btn-outline btn-small" onclick="logout()">Logout</button>
       </div>`
    : `<a href="${p}pages/login.html" class="btn btn-outline btn-small">Login</a>
       <a href="${p}pages/signup.html" class="btn btn-primary btn-small">Sign up</a>`;

  nav.innerHTML = `
    <div class="navbar-inner">
      <a href="${p}index.html" class="logo"><span>Otaku</span>Pier</a>
      <ul class="nav-links">${links}</ul>
      <div class="nav-auth">
        ${authArea}
      </div>
    </div>`;
}

// ---------- Shared UI ----------
function showToast(msg) {
  let toast = document.getElementById("toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "toast";
    toast.className = "toast";
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => toast.classList.remove("show"), 2600);
}

function renderFooter() {
  const foot = document.getElementById("siteFooter");
  if (!foot) return;
  const p = pathPrefix();
  foot.innerHTML = `
    <div class="footer-links">
      <a href="${p}index.html">Home</a>
      <a href="${p}pages/catalog.html">Catalog</a>
      <a href="${p}pages/forums.html">Forums</a>
      <a href="${p}pages/clubs.html">Clubs</a>
      <a href="${p}pages/rankings.html">Rankings</a>
      <a href="${p}pages/chat.html">Chat</a>
      ${isLoggedIn() ? `<a href="${p}pages/mylist.html">My List</a>
      <a href="${p}pages/friends.html">Friends</a>
      <a href="${p}pages/dms.html">Messages</a>
      <a href="${p}pages/profile.html">Profile</a>
      ${isAdmin() ? `<a href="${p}pages/admin.html">Admin</a>` : ""}
      <a href="${p}pages/dms.html?with=admin">Contact admin</a>` : ""}
    </div>
    <p>&copy; ${new Date().getFullYear()} <a href="${p}index.html">${CONFIG.SITE_NAME}</a> — fan-made catalog &amp; community. Anime data via Jikan/MyAnimeList.</p>`;
}

// ---------- Auth UI helpers (shared across login/signup) ----------
// Adds a show/hide toggle to any password input marked with data-toggle-pw
function setupPasswordToggle() {
  document.querySelectorAll("[data-toggle-pw]").forEach((input) => {
    if (input.dataset.togglePw === "done") return;
    input.dataset.togglePw = "done";
    const wrap = input.parentElement;
    wrap.classList.add("password-field");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "password-toggle";
    btn.title = "Show password";
    btn.textContent = "👁";
    btn.addEventListener("click", () => {
      const showing = input.type === "text";
      input.type = showing ? "password" : "text";
      btn.textContent = showing ? "👁" : "🙈";
      btn.title = showing ? "Show password" : "Hide password";
    });
    wrap.appendChild(btn);
  });
}

function setupAuthForm(formId, mode) {
  const form = document.getElementById(formId);
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const errBox = document.getElementById("formError");
    const btn = form.querySelector("button[type=submit]");
    if (errBox) errBox.style.display = "none";

    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;

    if (password.length < 6) {
      if (errBox) {
        errBox.textContent = "Password must be at least 6 characters.";
        errBox.style.display = "block";
      }
      return;
    }

    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = "Please wait...";

    try {
      let res;
      if (mode === "signup") {
        const name = document.getElementById("name").value.trim();
        res = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: name } },
        });
      } else {
        res = await supabase.auth.signInWithPassword({ email, password });
      }

      if (res.error) throw res.error;
      currentUser = res.data.user || currentUser;
      showToast(mode === "signup" ? "Account created! Check your email to confirm." : "Logged in!");
      setTimeout(() => (window.location.href = pathPrefix() + "index.html"), mode === "signup" ? 2500 : 700);
    } catch (err) {
      if (errBox) {
        errBox.textContent = err.message || "Something went wrong. Try again.";
        errBox.style.display = "block";
      }
      btn.disabled = false;
      btn.textContent = original;
    }
  });
}

// ---------- DB helpers (used by reviews, rankings, chat) ----------
async function dbInsert(table, data) {
  const { data: row, error } = await supabase.from(table).insert(data).select().single();
  if (error) throw error;
  return row;
}

async function dbSelect(table, match = {}, order = {}) {
  let q = supabase.from(table).select("*");
  Object.entries(match).forEach(([k, v]) => (q = q.eq(k, v)));
  if (order.by) q = q.order(order.by, { ascending: order.asc ?? false });
  if (order.limit) q = q.limit(order.limit);
  const { data, error } = await q;
  if (error) throw error;
  return data;
}

// ---------- Gamification: ranks, XP, badges ----------
const RANKS = [
  { name: "Newbie", icon: "🌱", min: 0 },
  { name: "Watcher", icon: "👀", min: 100 },
  { name: "Otaku", icon: "🎌", min: 300 },
  { name: "Weeb", icon: "🔥", min: 700 },
  { name: "Elite", icon: "⭐", min: 1500 },
  { name: "Legend", icon: "👑", min: 3000 },
];

function rankForXp(xp) {
  let cur = RANKS[0];
  RANKS.forEach((r) => { if ((xp || 0) >= r.min) cur = r; });
  return cur;
}

// How far (0..1) between the current rank and the next one
function xpProgress(xp) {
  xp = xp || 0;
  let cur = RANKS[0], next = RANKS[RANKS.length - 1];
  for (let i = 0; i < RANKS.length; i++) {
    if (xp >= RANKS[i].min) cur = RANKS[i];
    if (RANKS[i].min > xp) { next = RANKS[i]; break; }
  }
  if (cur === next) return { cur, next: null, pct: 1 };
  const span = next.min - cur.min;
  const pct = Math.min(1, (xp - cur.min) / span);
  return { cur, next, pct };
}

function rankIndex(xp) {
  let idx = 0;
  RANKS.forEach((r, i) => { if ((xp || 0) >= r.min) idx = i; });
  return idx;
}

// Does this XP qualify for highlighted chat messages / special styling?
function hasChatPrivilege(xp) {
  return rankIndex(xp) >= 3; // Weeb+
}

// Award XP (fire-and-forget; never breaks the main action)
async function awardXp(amount) {
  if (!supabase || !isLoggedIn()) return;
  try { await supabase.rpc("add_xp", { amount }); } catch (e) {}
}

// Render a translucent skeleton grid while anime cards load
// Returns bare cards so they drop directly into the existing .grid container
function skeletonGrid(n) {
  let cards = "";
  for (let i = 0; i < n; i++) {
    cards += `
      <div class="sk-card" aria-hidden="true">
        <div class="sk-poster"></div>
        <div class="sk-line"></div>
        <div class="sk-line short"></div>
      </div>`;
  }
  return cards;
}

// Claim daily login bonus (returns 0 if already claimed today)
async function claimDailyXp() {
  if (!supabase || !isLoggedIn()) return 0;
  try {
    const { data, error } = await supabase.rpc("claim_daily_xp");
    if (error) return 0;
    return data || 0;
  } catch (e) { return 0; }
}

// Badges based on profile + activity counts
function badgesFor(profile, counts) {
  const badges = [];
  const years = Math.floor((Date.now() - new Date(profile.created_at).getTime()) / (365.25 * 24 * 3600 * 1000));
  if (years >= 1) badges.push({ id: "senior", icon: "🏅", label: `Member ${years}y` });
  if ((counts.likes || 0) >= 50) badges.push({ id: "review-star", icon: "⭐", label: "Review Star" });
  if ((counts.chat || 0) >= 100) badges.push({ id: "chatter", icon: "💬", label: "Chatter" });
  if ((counts.saved || 0) >= 50) badges.push({ id: "collector", icon: "📚", label: "Collector" });
  if ((counts.reviews || 0) >= 10) badges.push({ id: "critic", icon: "✍️", label: "Critic" });
  if ((counts.votes || 0) >= 25) badges.push({ id: "rater", icon: "🗳️", label: "Rater" });
  return badges;
}

// Fetch profile row + activity counts for a user
async function userStats(userId) {
  if (!supabase) return { profile: null, counts: {} };
  try {
    const { data: profile } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
    if (!profile) return { profile: null, counts: {} };
    const [{ count: reviews }, { count: saved }, { count: chat }, { count: votes }, { count: likes }] = await Promise.all([
      supabase.from("reviews").select("id", { count: "exact", head: true }).eq("user_id", userId),
      supabase.from("saved_anime").select("id", { count: "exact", head: true }).eq("user_id", userId),
      supabase.from("chat_messages").select("id", { count: "exact", head: true }).eq("user_id", userId),
      supabase.from("rankings").select("id", { count: "exact", head: true }).eq("user_id", userId),
      supabase.from("review_likes").select("id", { count: "exact", head: true }).eq("user_id", userId),
    ]);
    return {
      profile,
      counts: {
        reviews: reviews || 0, saved: saved || 0, chat: chat || 0,
        votes: votes || 0, likes: likes || 0,
      },
    };
  } catch (e) {
    return { profile: null, counts: {} };
  }
}

// Format a username with their rank icon
function rankTag(userId, profile) {
  const p = profile || {};
  const r = rankForXp(p.xp);
  const admin = p.is_admin
    ? `<span class="admin-badge" title="Verified administrator">✓ Admin</span>`
    : "";
  return `<span class="rank-tag" title="Rank: ${r.name}">${r.icon} ${r.name}</span>${admin}`;
}

// Admin name: red + verified badge, used everywhere users are displayed
function adminNameHTML(profile) {
  const p = profile || {};
  const name = JIKAN.esc(p.name || "User");
  if (p.is_admin) {
    return `<span class="admin-name">${name} <span class="admin-badge" title="Verified administrator">✓ Admin</span></span>`;
  }
  return name;
}

// Fetch a single profile row (name, xp, is_admin, avatar_url, bio)
async function fetchProfileRow(id) {
  const { data, error } = await supabase.from("profiles")
    .select("id, name, avatar_url, bio, xp, is_admin, created_at")
    .eq("id", id).maybeSingle();
  return error ? null : data;
}

// Boot
document.addEventListener("DOMContentLoaded", () => {
  renderNav();
  renderFooter();
  initSupabase();
});

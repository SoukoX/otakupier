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
    .select("id, name, avatar_url, bio, xp, rp, rp_earned, is_admin, created_at")
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

// Reliable "back" navigation. history.length is unreliable across browsers,
// so we go back to the page the visitor actually came from (document.referrer)
// and fall back to the home page only when there's nowhere to return to.
function goBack() {
  const ref = document.referrer || "";
  if (ref && ref.startsWith(location.origin)) {
    location.href = ref;
    return;
  }
  // Came from an external site, a new tab, or a direct link — go home.
  location.href = pathPrefix() + "index.html";
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
  const isHome = current === "index.html" || current === "";

  const loggedLinks = isLoggedIn()
    ? NAV_LINKS.concat([
        { label: "My List", href: "pages/mylist.html", file: "mylist.html", inPages: true },
        { label: "Friends", href: "pages/friends.html", file: "friends.html", inPages: true },
        { label: "Messages", href: "pages/dms.html", file: "dms.html", inPages: true },
        { label: "Profile", href: "pages/profile.html", file: "profile.html", inPages: true },
      ])
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
         <span class="rp-badge" title="Reward Points — spend these in the Reward Shop">⛁ ${currentProfile?.rp || 0}</span>
         ${isAdmin()
           ? `<a href="${p}pages/admin.html" class="btn btn-outline btn-small admin-btn" title="Admin panel">⚙ Admin</a>`
           : ""}
         <a href="${p}pages/profile.html" class="user-avatar" title="${JIKAN.esc(getProfile().name)}">${getProfile().avatar
         ? `<img src="${JIKAN.safeImg(getProfile().avatar)}" alt="">`
         : JIKAN.esc(getProfile().name.charAt(0).toUpperCase())}</a>
         <button class="btn btn-outline btn-small" onclick="logout()">Logout</button>
       </div>`
    : `<a href="${p}pages/login.html" class="btn btn-outline btn-small">Login</a>
       <a href="${p}pages/signup.html" class="btn btn-primary btn-small">Sign up</a>`;

  if (isHome) {
    // Home page: immersive full-page hero — no navbar bar. A floating
    // logo + menu button that reveals the links on demand.
    nav.className = "navbar navbar-home";
    nav.innerHTML = `
      <a href="${p}index.html" class="logo logo-home"><span>Otaku</span>Pier</a>
      <button class="nav-toggle nav-toggle-home" id="navToggle" aria-label="Toggle menu" aria-expanded="false">☰</button>
      <div class="nav-panel nav-panel-home">
        <ul class="nav-links">${links}</ul>
        <div class="nav-auth">${authArea}</div>
      </div>`;
  } else {
    nav.className = "navbar";
    nav.innerHTML = `
      <div class="navbar-inner">
        <a href="${p}index.html" class="logo"><span>Otaku</span>Pier</a>
        <button class="nav-toggle" id="navToggle" aria-label="Toggle menu" aria-expanded="false">☰</button>
        <div class="nav-panel">
          <ul class="nav-links">${links}</ul>
          <div class="nav-auth">
            ${authArea}
          </div>
        </div>
      </div>`;
  }

  const toggle = document.getElementById("navToggle");
  if (toggle) {
    toggle.addEventListener("click", (e) => {
      e.stopPropagation();
      nav.classList.toggle("open");
      toggle.setAttribute("aria-expanded", nav.classList.contains("open") ? "true" : "false");
    });
    nav.querySelectorAll(".nav-panel a, .nav-panel .btn").forEach((a) => {
      a.addEventListener("click", () => {
        nav.classList.remove("open");
        toggle.setAttribute("aria-expanded", "false");
      });
    });
    document.removeEventListener("click", nav._outsideHandler);
    nav._outsideHandler = (e) => {
      if (nav.classList.contains("open") && !nav.contains(e.target)) {
        nav.classList.remove("open");
        toggle.setAttribute("aria-expanded", "false");
      }
    };
    document.addEventListener("click", nav._outsideHandler);
  }
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
    <p>&copy; ${new Date().getFullYear()} <a href="${p}index.html">${CONFIG.SITE_NAME}</a> — anime catalog &amp; community. Anime data via Jikan/MyAnimeList.</p>`;
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

// ---------- CAPTCHA (bot protection) ----------
// Turns a token into a captchaToken for Supabase auth calls. A valid site key
// looks like "0x..." (Turnstile) or a UUID (hCaptcha); the "key" users often
// paste from Supabase is the SECRET (dashboard-only) and can't be used here,
// so we only enable the widget when the key actually looks like a site key.
function captchaKeyValid() {
  const k = (CONFIG.CAPTCHA_SITE_KEY || "").trim();
  return /^0x[0-9a-fA-F]{8,}$/.test(k) || /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-/.test(k);
}

// Inject the CAPTCHA widget into a container. Returns true if a widget was
// rendered (caller should then send the token with the auth request).
function setupCaptcha(container) {
  if (!CONFIG.CAPTCHA_SITE_KEY || !captchaKeyValid()) return false;
  const provider = (CONFIG.CAPTCHA_PROVIDER || "turnstile").toLowerCase();

  if (provider === "hcaptcha") {
    const div = document.createElement("div");
    div.className = "h-captcha";
    div.dataset.sitekey = CONFIG.CAPTCHA_SITE_KEY;
    container.appendChild(div);
    if (!document.querySelector('script[src*="hcaptcha.com/1/api.js"]')) {
      const s = document.createElement("script");
      s.src = "https://hcaptcha.com/1/api.js?render=explicit";
      s.async = true;
      s.defer = true;
      s.onload = () => {
        if (window.hcaptcha) hcaptcha.render(div, { sitekey: CONFIG.CAPTCHA_SITE_KEY });
      };
      document.head.appendChild(s);
    }
    return true;
  }

  // Default: Cloudflare Turnstile
  const div = document.createElement("div");
  div.className = "cf-turnstile";
  div.dataset.sitekey = CONFIG.CAPTCHA_SITE_KEY;
  container.appendChild(div);
  if (!document.querySelector('script[src*="challenges.cloudflare.com/turnstile"]')) {
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true;
    s.defer = true;
    s.onload = () => {
      if (window.turnstile) turnstile.render(div, { sitekey: CONFIG.CAPTCHA_SITE_KEY });
    };
    document.head.appendChild(s);
  }
  return true;
}

// Read the current CAPTCHA token from whichever widget is present.
function getCaptchaToken() {
  try {
    if (window.turnstile && document.querySelector(".cf-turnstile")) {
      return window.turnstile.getResponse(document.querySelector(".cf-turnstile")) || null;
    }
    if (window.hcaptcha && document.querySelector(".h-captcha")) {
      return document.querySelector(".h-captcha textarea[name='h-captcha-response']")?.value || null;
    }
  } catch (e) {}
  return null;
}

// Block submit until the CAPTCHA is solved.
function waitForCaptcha(timeoutMs = 120000) {
  return new Promise((resolve) => {
    const started = Date.now();
    const timer = setInterval(() => {
      const token = getCaptchaToken();
      if (token) { clearInterval(timer); resolve(token); return; }
      if (Date.now() - started > timeoutMs) { clearInterval(timer); resolve(null); }
    }, 400);
  });
}

function setupAuthForm(formId, mode) {
  const form = document.getElementById(formId);
  if (!form) return;

  // Render the CAPTCHA widget (if a valid site key is configured)
  const captchaSlot = document.createElement("div");
  captchaSlot.id = "captchaSlot";
  captchaSlot.style.marginTop = "12px";
  const submitBtn = form.querySelector("button[type=submit]");
  if (submitBtn) form.insertBefore(captchaSlot, submitBtn);
  const captchaEnabled = setupCaptcha(captchaSlot);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const errBox = document.getElementById("formError");
    const btn = form.querySelector("button[type=submit]");
    if (errBox) errBox.style.display = "none";

    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;

    if (password.length < 8) {
      if (errBox) {
        errBox.textContent = "Password must be at least 8 characters.";
        errBox.style.display = "block";
      }
      return;
    }

    // If CAPTCHA is active, wait for the user to complete it
    let captchaToken = null;
    if (captchaEnabled) {
      btn.disabled = true;
      captchaToken = await waitForCaptcha();
      if (!captchaToken) {
        btn.disabled = false;
        if (errBox) {
          errBox.textContent = "Please complete the security check first.";
          errBox.style.display = "block";
        }
        return;
      }
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
          options: { data: { full_name: name }, captchaToken },
        });
      } else {
        res = await supabase.auth.signInWithPassword({ email, password, options: { captchaToken } });
      }

      if (res.error) throw res.error;

      // A signup that returns no new identity means the email is already
      // registered. Supabase obfuscates this to prevent email enumeration,
      // so no confirmation email is sent and NO second account is created.
      if (mode === "signup" && (!res.data?.user?.identities || res.data.user.identities.length === 0)) {
        btn.disabled = false;
        btn.textContent = original;
        showToast("An account with this email already exists. Try logging in instead.");
        setTimeout(() => (window.location.href = pathPrefix() + "login.html"), 2200);
        return;
      }

      currentUser = res.data.user || currentUser;
      if (mode === "signup") {
        // If Supabase returned a session, email confirmation is disabled and
        // the user is already signed in — don't tell them to check their mail.
        if (res.data?.session) {
          showToast("Account created — welcome!");
          setTimeout(() => (window.location.href = pathPrefix() + "index.html"), 700);
        } else {
          showToast("Account created! Check your email to confirm.");
          setTimeout(() => (window.location.href = pathPrefix() + "index.html"), 2500);
        }
      } else {
        showToast("Logged in!");
        setTimeout(() => (window.location.href = pathPrefix() + "index.html"), 700);
      }
    } catch (err) {
      const m = (err.message || "").toLowerCase();
      let msg = err.message || "Something went wrong. Try again.";
      if (m.includes("not authorized")) {
        msg = "The email service can't deliver to this address — an admin must configure a custom SMTP provider.";
      } else if (m.includes("rate limit") || m.includes("over_email_send_rate_limit")) {
        msg = "Too many verification emails were sent this hour. Please wait a while and try again.";
      } else if (m.includes("invalid login")) {
        msg = "Incorrect email or password.";
      } else if (m.includes("already registered") || m.includes("already exists")) {
        msg = "An account with this email already exists. Try logging in.";
      }
      if (errBox) {
        errBox.textContent = msg;
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

// ---------- Reward Points (RP) ----------
// Whitelisted (reason -> amount) pairs that map 1:1 to add_rp() server-side.
// Keep in sync with the SQL whitelist in supabase_schema.sql.
const RP_REWARDS = {
  review: 2,
  reply: 1,
  vote: 1,
  save: 1,
  thread: 3,
  forum_reply: 1,
  club: 5,
  club_join: 2,
  club_post: 1,
  friend: 2,
  chat: 1,
  link_approved: 10,
};

// Award RP to the current user for a known action (fire-and-forget).
async function awardRp(reason) {
  if (!supabase || !isLoggedIn()) return;
  const amount = RP_REWARDS[reason];
  if (!amount) return;
  try { await supabase.rpc("add_rp", { amount, reason }); } catch (e) {}
}

// Award RP to another user (e.g. their review got liked). No self-award.
async function awardRpTo(recipient, reason) {
  if (!supabase || !isLoggedIn() || !recipient) return;
  const amount = RP_REWARDS[reason];
  if (!amount) return;
  try { await supabase.rpc("award_rp_to", { recipient, amount, reason }); } catch (e) {}
}

// Buy a shop item. Returns { ok, message }.
async function buyRpItem(itemId, config) {
  if (!supabase || !isLoggedIn()) return { ok: false, message: "Login to use the Reward Shop" };
  try {
    const { data, error } = await supabase.rpc("spend_rp", { item_id: itemId, config: config || "" });
    if (error) throw error;
    return { ok: data === "ok", message: data };
  } catch (e) {
    return { ok: false, message: e.message || "Purchase failed" };
  }
}

// Change config of an owned item (name color / custom title).
async function setRpConfig(itemId, config) {
  if (!supabase || !isLoggedIn()) return { ok: false, message: "Login required" };
  try {
    const { data, error } = await supabase.rpc("set_rp_config", { item_id: itemId, config });
    if (error) throw error;
    return { ok: data === "ok", message: data };
  } catch (e) {
    return { ok: false, message: e.message || "Update failed" };
  }
}

// Fetch active (non-expired) spendings for a set of users -> { userId: {itemId: config} }
async function spendingsMap(userIds) {
  if (!supabase || !userIds.length) return {};
  try {
    const { data } = await supabase
      .from("spendings")
      .select("user_id, item_id, config, expires_at, active")
      .in("user_id", userIds);
    const map = {};
    (data || []).forEach((s) => {
      if (!s.active) return;
      if (s.expires_at && new Date(s.expires_at) <= new Date()) return;
      (map[s.user_id] = map[s.user_id] || {})[s.item_id] = s.config || true;
    });
    return map;
  } catch (e) { return {}; }
}

// RP badge: shows balance to the logged-in user next to their XP.
function rpBadge(profile) {
  const rp = profile?.rp || 0;
  return `<span class="rp-badge" title="Reward Points — spend these in the Reward Shop">⛁ ${rp}</span>`;
}

// Prestige perks from a spendings map for one user.
function perksOf(spendings, userId) {
  return (spendings && userId && spendings[userId]) || {};
}

// A display name that reflects earned prestige: name color, VIP badge,
// golden avatar ring (rendered by the caller on the avatar element).
function prestigeNameHTML(profile, perks, opts) {
  const p = profile || {};
  opts = opts || {};
  const name = JIKAN.esc(p.name || "User");
  const admin = p.is_admin
    ? `<span class="admin-badge" title="Verified administrator">✓ Admin</span>`
    : "";
  const vip = (perks && (perks.vip_badge || perks.vip)) ? `<span class="vip-badge" title="VIP — bought in the Reward Shop">VIP</span>` : "";
  const color = (perks && perks.name_color) ? ` style="color:${perks.name_color};"` : "";
  const openTag = opts.strong ? `<strong${color}>` : `<span${color}>`;
  const closeTag = opts.strong ? "</strong>" : "</span>";
  return `${openTag}${name}${closeTag} ${vip}${admin}`.trim();
}

// The shop catalog (single source of truth used by profile + admin).
const RP_SHOP = [
  { id: "name_color", name: "Name Color", icon: "🎨", price: 15000, duration: null, desc: "Pick a custom color for your name everywhere on the site." },
  { id: "custom_title", name: "Custom Title", icon: "🏷️", price: 25000, duration: null, desc: "A custom title shown under your name (max 24 chars)." },
  { id: "vip_badge", name: "VIP Badge", icon: "💎", price: 500000, duration: null, desc: "The ultimate status — a shining VIP badge next to your name site-wide." },
  { id: "avatar_ring", name: "Glowing Avatar", icon: "🌟", price: 40000, duration: null, desc: "Your avatar glows with a purple-teal aura on chat, DMs & reviews." },
  { id: "chat_glow", name: "Chat Glow", icon: "✨", price: 8000, duration: "30 days", desc: "Your chat messages always glow with VIP styling." },
  { id: "vote_power", name: "Voting Power 2x", icon: "🗳️", price: 10000, duration: "30 days", desc: "Your community votes count 2x in the OtakuPier rating." },
  { id: "profile_banner", name: "Profile Banner", icon: "🖼️", price: 50000, duration: null, desc: "A special banner at the top of your profile page." },
];

function rpShopItem(id) {
  return RP_SHOP.find((i) => i.id === id) || null;
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

// Clean URLs: hide the ".html" extension from the address bar so the live
// site reads like a real app — "/" for home, "/pages/anime?id=5" instead of
// "/pages/anime.html?id=5". Reloads of the clean path are remapped by the
// custom 404 page, which forwards to the real file.
function cleanUrl() {
  try {
    let path = window.location.pathname;
    if (path.endsWith("index.html")) {
      path = path.slice(0, -"index.html".length);
      if (!path || path === "/") path = "/";
    } else if (path.endsWith(".html")) {
      path = path.slice(0, -5);
    } else {
      return;
    }
    history.replaceState(null, "", path + window.location.search + window.location.hash);
  } catch (e) {}
}

// Boot
document.addEventListener("DOMContentLoaded", () => {
  cleanUrl();
  renderNav();
  renderFooter();
  initSupabase();
});

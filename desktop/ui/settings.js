"use strict";
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const show = (s) => (s === "" ? "∅" : esc(s).replace(/ /g, "␣"));
const KINDS = new Set(["typo", "recheck", "context", "resolved", "translate", "grammar", "complete", "revert", "tone"]);
function render(st) {
  if (!st) return;
  const s = st.settings;
  $("sys").className = "sys " + (s.enabled ? "" : "off");
  $("sys").querySelector("span").textContent = s.enabled ? "System ON" : "System OFF";
  $("aggr").value = s.aggressiveness;
  $("aggrv").textContent = Math.round(s.aggressiveness * 100);
  $("lang").value = s.lang;
  $("tone").value = s.tone || "as-written";
  $("overlay").value = s.overlay ? "1" : "0";
  $("corner").value = s.overlayCorner;
  const live = st.changes.filter((c) => !c.reverted).length;
  $("count").textContent = live ? `(${live})` : "";
  $("empty").style.display = st.changes.length ? "none" : "";
  $("changes").innerHTML = st.changes
    .map((c) => {
      const kind = KINDS.has(c.kind) ? c.kind : "typo";
      return `<li class="${c.reverted ? "reverted" : ""}"><div class="chg"><span class="diff"><s>${show(c.old)}</s> <span class="arrow">→</span> <b>${show(c.to)}</b></span><span class="kind ${kind}">${kind}</span></div>${c.reverted ? '<span class="muted">reverted</span>' : `<button class="revert" data-id="${esc(c.id)}">Revert</button>`}</li>`;
    })
    .join("");
  $("s1").textContent = `${st.stats.applied} / ${st.stats.reverted}`;
  $("s2").textContent = st.hook ? "running" : "not running";
  $("s6").textContent = `${st.keyEvents || 0} / ${st.layout || "?"}`;
  $("s3").textContent = String(st.api).replace(/^https?:\/\//, "");
  $("s4").textContent = st.version || "";
  $("s5").textContent = st.library ? `${st.library.count} (v${st.library.version})` : "–";
  const p = st.permissions;
  let w = "";
  st.startedAt = st.startedAt || 0;
  if (st.platform === "darwin") {
    if (!p.accessibility) w += `<b>Accessibility permission needed</b> so corrections can be typed into other apps. System Settings → Privacy &amp; Security → Accessibility → enable Inline Autocorrect.<br><button data-perm="acc">Open Accessibility settings</button>`;
    if (!st.hook || (st.keyEvents === 0 && Date.now() - st.startedAt > 20000)) w += `<b>Input Monitoring permission needed</b> so the app can see what you type. System Settings → Privacy &amp; Security → Input Monitoring → enable Inline Autocorrect, then click Retry.<br><button data-perm="input">Open Input Monitoring settings</button><button id="retry">Retry</button>`;
  } else if (!st.hook) w += `<b>The keyboard listener is not running.</b> <button id="retry">Retry</button>`;
  $("perm").innerHTML = w;
  $("perm").style.display = w ? "" : "none";
}
$("sys").onclick = async () => {
  const st = await ica.state();
  await ica.set("enabled", !st.settings.enabled);
};
$("aggr").oninput = (e) => {
  $("aggrv").textContent = Math.round(e.target.value * 100);
  ica.set("aggressiveness", Number(e.target.value));
};
$("lang").onchange = (e) => ica.set("lang", e.target.value);
$("tone").onchange = (e) => ica.set("tone", e.target.value);
$("overlay").onchange = (e) => ica.set("overlay", e.target.value === "1");
$("corner").onchange = (e) => ica.set("overlayCorner", e.target.value);
$("web").onclick = () => ica.openWeb();
$("frs").onclick = async () => {
  const t = $("fr").value.trim();
  if (t.length < 3) {
    $("frm").textContent = "Write a little more first.";
    return;
  }
  $("frs").disabled = true;
  const ok = await ica.feedback(t, $("frc").value.trim());
  $("frs").disabled = false;
  $("frm").textContent = ok ? "Sent. Thank you! It lands in the improvement inbox." : "Could not send right now. Try again later.";
  if (ok) $("fr").value = "";
};
document.body.addEventListener("click", async (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  if (b.dataset.id) await ica.revert(b.dataset.id);
  else if (b.dataset.perm) ica.openPermissions(b.dataset.perm === "input" ? "input" : "acc");
  else if (b.id === "retry") render(await ica.retryHook());
});
ica.onState(render);
ica.state().then(render);
setInterval(() => ica.state().then(render), 3000);

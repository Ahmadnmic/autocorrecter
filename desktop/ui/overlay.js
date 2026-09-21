"use strict";
const box = document.getElementById("chips");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const show = (s) => (s === "" ? "∅" : esc(s).replace(/ /g, "␣"));
const KINDS = new Set(["typo", "recheck", "context", "resolved", "translate", "grammar", "complete", "revert", "tone"]);
window.ica.onChip((c) => {
  const kind = KINDS.has(c.kind) ? c.kind : "typo";
  const el = document.createElement("div");
  el.className = "chip";
  el.innerHTML = `<span class="kind ${kind}">${kind}</span><span class="diff"><s>${show(c.old)}</s> <span class="arrow">→</span> <b class="hl ${kind}">${show(c.to)}</b></span>`;
  box.appendChild(el);
  while (box.children.length > 4) box.removeChild(box.firstChild);
  setTimeout(() => {
    el.classList.add("out");
    setTimeout(() => el.remove(), 400);
  }, 5000);
});

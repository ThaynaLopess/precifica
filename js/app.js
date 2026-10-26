(() => {
  "use strict";
  // Se algum elemento não existir (arquivos de versões diferentes misturados), o app não trava
  const NIL = new Proxy(function () {}, { get: (t, k) => k === Symbol.toPrimitive ? () => "" : NIL, set: () => true, apply: () => NIL });
  const $ = s => document.querySelector(s) || NIL, $$ = s => [...document.querySelectorAll(s)];
  const KEY = "precifica:v1", CFG = "precifica:loja";
  const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
  const money = n => brl.format(n);
  const pct = n => n.toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + "%";
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  // Aceita "12,50", "1.234,56" e "12.5"
  const num = v => {
    let s = String(v == null ? "" : v).replace(/\s/g, "");
    if (!s) return 0;
    if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
    const n = parseFloat(s);
    return isFinite(n) && n > 0 ? n : 0;
  };
  const read = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch { return d; } };
  let tt;
  const toast = m => { const t = $("#toast"); t.textContent = m; t.classList.add("on"); clearTimeout(tt); tt = setTimeout(() => t.classList.remove("on"), 2600); };
  const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { toast("Sem espaço para salvar. Tente uma logo menor."); return false; } };

  /* ---------- Estado ---------- */
  const clone = o => JSON.parse(JSON.stringify(o));
  const PAN = "precifica:despensa";
  const EX = () => ({
    mode: "price", nome: "", rende: "1", margem: "30", preco: "", arredondar: false,
    ings: [
      { nome: "Farinha de trigo", q: "300", u: "g", p: "5,50" }, { nome: "Ovos", q: "3", u: "un", p: "0,90" },
      { nome: "Açúcar", q: "200", u: "g", p: "4,80" }, { nome: "Leite", q: "200", u: "ml", p: "5" }
    ],
    extras: [{ nome: "Embalagem", v: "1,20", t: "un" }]
  });
  // Converte o formato antigo (custo único + taxas fixas) para ingredientes e custos extras
  function migrate(f) {
    if (Array.isArray(f.ings)) return { ...EX(), ...f, extras: f.extras || [] };
    const extras = [], add = (nome, v, t) => { if (num(v)) extras.push({ nome, v: String(v), t }); };
    add("Embalagem", f.embalagem, "un"); add("Frete ou entrega", f.frete, "un");
    add("Impostos", f.imposto, "pct"); add("Taxa do cartão", f.cartao, "pct");
    add("Comissão ou plataforma", f.comissao, "pct"); add("Custos fixos", f.fixos, "pct");
    return { ...EX(), nome: f.nome || "", mode: f.mode || "price", margem: f.margem == null ? "30" : f.margem, preco: f.preco || "", arredondar: !!f.arredondar,
      ings: num(f.produto) ? [{ nome: "Insumos", q: "1", u: "un", p: String(f.produto) }] : [], extras };
  }
  const saved = read(KEY, {});
  let state = saved.form ? migrate(saved.form) : EX();
  let items = Array.isArray(saved.items) ? saved.items : [];
  let example = saved.form ? !!saved.example : true;
  const B = window.PRECIFICA_BRAND || {};
  let cfg = { nome: B.nome || "", logo: B.logo || "", cor: B.cor || "#2D3CF5", tema: "auto", ...read(CFG, {}) };
  // Marca travada: nome, logo e cor vêm sempre do config.js, mesmo com dados antigos ou backup importado
  const lockCfg = () => { if (B.travado) Object.assign(cfg, { nome: B.nome || "", logo: B.logo || "", cor: B.cor || cfg.cor }); };
  lockCfg();
  const pantry = read(PAN, {});
  const sel = new Set();
  let last = null, view = "calc", heroSeen = true;
  const persist = () => write(KEY, { form: state, items, example });
  const touch = () => { example = false; $("#exemplo").hidden = true; persist(); render(); };

  /* ---------- Cálculo ---------- */
  const FAM = { g: 1e-3, kg: 1, ml: 1e-3, l: 1, un: 1 }; // converte para kg, litro ou unidade
  const ingCost = g => num(g.q) * (FAM[g.u] || 1) * num(g.p);
  function calc(s) {
    const n = Math.max(1, num(s.rende) || 1);
    const ing = s.ings.reduce((a, g) => a + ingCost(g), 0) / n;
    let un = 0, rec = 0, pc = 0;
    s.extras.forEach(x => { const v = num(x.v); if (x.t === "pct") pc += v; else if (x.t === "rec") rec += v / n; else un += v; });
    const other = un + rec, C = ing + other;
    let P = 0;
    
if (s.mode === "price") {
  const lucro = num(s.margem) / 100;
  const d = 1 - pc / 100;

  if (d <= 0.0001) {
    return { err: "As taxas e os impostos devem ser inferiores a 100%." };
  }

  P = C > 0 ? (C * (1 + lucro)) / d : 0;

  if (s.arredondar && P > 0) {
    let t = Math.floor(P) + 0.9;
    if (t < P - 1e-9) t += 1;
    P = Math.round(t * 100) / 100;
  }
} else {
  P = num(s.preco);
}
    
    const taxas = P * pc / 100, profit = P - C - taxas;
    return { n, ing, other, C, P, taxas, profit, margin: P > 0 ? profit / P * 100 : 0, markup: C > 0 ? P / C : 0 };
  }
  const status = (m, P) => P <= 0 ? null : m < 0 ? ["bad", "Prejuízo"] : m < 10 ? ["bad", "Margem baixa"] : m < 20 ? ["warn", "Margem apertada"] : ["good", "Margem saudável"];

  function render() {
    const r = last = calc(state);
    $("#ing-total").textContent = money(state.ings.reduce((a, g) => a + ingCost(g), 0));
    $("#h-title").textContent = state.nome.trim() || "Preço de venda";
    const pills = $("#out-pills"), msg = $("#out-msg");
    pills.innerHTML = ""; $("#out-bar").innerHTML = ""; $("#out-rows").innerHTML = "";
    if (r.err) {
      $("#out-price").textContent = "—"; $("#chip-v").textContent = "—";
      msg.textContent = r.err; msg.className = "msg err";
      $("#out-profit").textContent = "—"; $("#out-cost").textContent = "—";
      return;
    }
    msg.className = "msg";
    msg.textContent = r.C <= 0 && state.mode === "price" ? "Adicione os ingredientes para ver o preço."
      : state.mode === "check" && r.P <= 0 ? "Digite o preço que você cobra hoje." : "";
    $("#out-price").textContent = money(r.P); $("#chip-v").textContent = money(r.P);
    $("#out-profit").textContent = money(r.profit); $("#out-cost").textContent = money(r.C);
    const st = status(r.margin, r.P);
    if (st) pills.innerHTML += `<span class="pill ${st[0]}">${st[1]} ${pct(r.margin)}</span>`;
    if (r.n > 1) pills.innerHTML += `<span class="pill ghost">Receita rende ${r.n.toLocaleString("pt-BR")} un</span>`;
    const parts = [["Ingredientes", r.ing, "--s-cost"], ["Embalagem e outros", r.other, "--s-fix"], ["Taxas e impostos", r.taxas, "--s-tax"], ["Lucro", r.profit, "--s-profit"]];
    $("#out-bar").innerHTML = parts.filter(p => r.P > 0 && p[1] > 0).map(p => `<i style="width:${p[1] / r.P * 100}%;background:var(${p[2]})"></i>`).join("");
    $("#out-rows").innerHTML = parts.map(p => `<li><span class="dot" style="background:var(${p[2]})"></span><span>${p[0]}</span><span class="v"${p[0] === "Lucro" && p[1] < 0 ? ' style="color:var(--bad)"' : ""}>${money(p[1])}</span><span class="p">${r.P > 0 ? pct(p[1] / r.P * 100) : "–"}</span></li>`).join("")
      + `<li><span></span><span>Preço de venda</span><span class="v">${money(r.P)}</span><span class="p">${r.P > 0 ? "100%" : "–"}</span></li>`;
  }

  /* ---------- Ingredientes e outros custos ---------- */
  const UNITS = [["g", "g"], ["kg", "kg"], ["ml", "ml"], ["l", "L"], ["un", "un"]];
  const TYPES = [["un", "R$ por un."], ["rec", "R$ na receita"], ["pct", "% da venda"]];
  const PRESETS = [["Embalagem", "un"], ["Frete ou entrega", "un"], ["Gás e luz", "rec"], ["Taxa do cartão", "pct"], ["Imposto", "pct"], ["Comissão do app", "pct"], ["Outro custo", "un"]];
  const pLabel = u => u === "g" || u === "kg" ? "Preço do kg" : u === "ml" || u === "l" ? "Preço do litro" : "Preço da un.";
  const opts = (list, cur) => list.map(([v, l]) => `<option value="${v}"${v === cur ? " selected" : ""}>${l}</option>`).join("");
  const renderPantry = () => { $("#pantry").innerHTML = Object.values(pantry).map(x => `<option value="${esc(x.nome)}">`).join(""); };

  function renderIngs() {
    $("#ings").innerHTML = state.ings.map((g, i) => `<li class="ing" data-r="${i}">
      <label class="field nm"><span>Ingrediente</span><span class="input"><input data-f="nome" list="pantry" autocomplete="off" value="${esc(g.nome)}" placeholder="Ex.: Farinha de trigo"></span></label>
      <label class="field"><span>Quantidade</span><span class="input"><input data-f="q" inputmode="decimal" autocomplete="off" value="${esc(g.q)}" placeholder="0"><select data-f="u" aria-label="Unidade">${opts(UNITS, g.u)}</select></span></label>
      <label class="field"><span class="pl">${pLabel(g.u)}</span><span class="input"><b>R$</b><input data-f="p" inputmode="decimal" autocomplete="off" value="${esc(g.p)}" placeholder="0,00"></span></label>
      <div class="sub"><small>Custo</small><b>${money(ingCost(g))}</b></div>
      <button type="button" class="x" data-del aria-label="Remover ${esc(g.nome || "ingrediente")}">✕</button></li>`).join("");
  }
  function renderExtras() {
    $("#extras").innerHTML = state.extras.map((x, i) => `<li class="ext" data-r="${i}">
      <label class="field nm"><span>Nome</span><span class="input"><input data-f="nome" autocomplete="off" value="${esc(x.nome)}" placeholder="Ex.: Taxa do cartão"></span></label>
      <label class="field"><span>Valor</span><span class="input"><input data-f="v" inputmode="decimal" autocomplete="off" value="${esc(x.v)}" placeholder="0"><select data-f="t" aria-label="Tipo de custo">${opts(TYPES, x.t)}</select></span></label>
      <button type="button" class="x" data-del aria-label="Remover ${esc(x.nome || "custo")}">✕</button></li>`).join("");
  }
  // Liga digitação, troca de unidade e remoção de linhas sem redesenhar a lista (o foco não se perde)
  function bindList(id, key, onChange) {
    const el = $(id);
    el.addEventListener("input", e => {
      const li = e.target.closest("[data-r]"), f = e.target.dataset.f; if (!li || !f) return;
      const row = state[key][+li.dataset.r]; row[f] = e.target.value;
      if (key === "ings") li.querySelector(".sub b").textContent = money(ingCost(row));
      touch();
    });
    el.addEventListener("change", e => {
      const li = e.target.closest("[data-r]"), f = e.target.dataset.f; if (!li || !f) return;
      if (onChange) onChange(state[key][+li.dataset.r], f, li);
      touch();
    });
    el.addEventListener("click", e => {
      const b = e.target.closest("[data-del]"); if (!b) return;
      state[key].splice(+b.closest("[data-r]").dataset.r, 1);
      key === "ings" ? renderIngs() : renderExtras(); touch();
    });
  }
  // Despensa: o preço de cada ingrediente fica salvo e preenche sozinho na próxima receita
  bindList("#ings", "ings", (row, f, li) => {
    const k = row.nome.trim().toLowerCase();
    li.querySelector(".pl").textContent = pLabel(row.u);
    if (f === "nome" && k && pantry[k] && !num(row.p)) {
      row.p = pantry[k].p; row.u = pantry[k].u;
      li.querySelector('[data-f="p"]').value = row.p; li.querySelector('[data-f="u"]').value = row.u;
      li.querySelector(".pl").textContent = pLabel(row.u); li.querySelector(".sub b").textContent = money(ingCost(row));
    }
    if (k && num(row.p)) { pantry[k] = { nome: row.nome.trim(), p: row.p, u: row.u }; write(PAN, pantry); renderPantry(); }
  });
  bindList("#extras", "extras");
  $("#add-ing").addEventListener("click", () => {
    state.ings.push({ nome: "", q: "", u: "g", p: "" }); renderIngs(); touch();
    const n = $$("#ings [data-f=nome]"); n[n.length - 1].focus();
  });
  $("#chips").innerHTML = PRESETS.map((p, i) => `<button type="button" class="add" data-p="${i}">+ ${p[0]}</button>`).join("");
  $("#chips").addEventListener("click", e => {
    const b = e.target.closest("[data-p]"); if (!b) return;
    const [n, t] = PRESETS[+b.dataset.p];
    state.extras.push({ nome: n === "Outro custo" ? "" : n, v: "", t }); renderExtras(); touch();
    const v = $$("#extras [data-f=v]"); v[v.length - 1].focus();
  });

  /* ---------- Campos gerais ---------- */
  const FIELDS = ["nome", "rende", "margem", "preco"];
  function writeInputs() {
    FIELDS.forEach(k => { $("#f-" + k).value = state[k]; });
    $("#f-arredondar").checked = !!state.arredondar;
    $("#exemplo").hidden = !example;
    const p = state.mode === "price";
    $("#mode-price").setAttribute("aria-pressed", p); $("#mode-check").setAttribute("aria-pressed", !p);
    $("#box-price").hidden = !p; $("#box-check").hidden = p;
    renderIngs(); renderExtras();
  }
  FIELDS.forEach(k => $("#f-" + k).addEventListener("input", e => { state[k] = e.target.value; touch(); }));
  $("#f-arredondar").addEventListener("change", e => { state.arredondar = e.target.checked; persist(); render(); });
  ["price", "check"].forEach(m => $("#mode-" + m).addEventListener("click", () => { state.mode = m; writeInputs(); persist(); render(); }));

  
/* ---------- Produtos salvos (selecionáveis) ---------- */
  function renderList() {
    const q = $("#q").value.trim().toLowerCase();
    const rows = items.map((it, i) => [it, i]).filter(([it]) => it.nome.toLowerCase().includes(q));
    $("#n").textContent = items.length;
    $("#list").innerHTML = rows.map(([it, i]) => `<li class="item${sel.has(i) ? " on" : ""}"><input type="checkbox" data-i="${i}" aria-label="Selecionar ${esc(it.nome)}"${sel.has(i) ? " checked" : ""}><button type="button" class="body" data-open="${i}"><b>${esc(it.nome)}</b><span class="stats"><span><small>Preço</small>${money(it.price)}</span><span><small>Lucro</small><i class="${it.profit < 0 ? "neg" : ""}">${money(it.profit)}</i></span><span><small>Margem</small>${pct(it.margin)}</span></span></button></li>`).join("");
    $("#empty").textContent = !items.length ? "Nenhum produto salvo ainda. Calcule um preço, dê um nome e toque em Salvar produto." : !rows.length ? "Nenhum produto com esse nome." : "";
    $("#del").hidden = !sel.size; $("#del").textContent = `Excluir (${sel.size})`;
    $("#all").textContent = rows.length && rows.every(([, i]) => sel.has(i)) ? "Limpar seleção" : "Selecionar tudo";
  }
  $("#q").addEventListener("input", renderList);
  $("#list").addEventListener("change", e => { const i = +e.target.dataset.i; e.target.checked ? sel.add(i) : sel.delete(i); renderList(); });
  $("#list").addEventListener("click", e => {
    const b = e.target.closest("[data-open]"); if (!b) return;
    const it = items[+b.dataset.open];
    state = migrate(clone(it.form)); state.nome = it.nome; example = false;
    writeInputs(); persist(); render(); go("calc");
  });
  $("#all").addEventListener("click", () => {
    const q = $("#q").value.trim().toLowerCase();
    const idx = items.map((it, i) => i).filter(i => items[i].nome.toLowerCase().includes(q));
    const all = idx.length && idx.every(i => sel.has(i));
    idx.forEach(i => all ? sel.delete(i) : sel.add(i)); renderList();
  });
  $("#del").addEventListener("click", () => {
    if (!confirm(`Excluir ${sel.size} produto(s)? Isso não pode ser desfeito.`)) return;
    items = items.filter((_, i) => !sel.has(i)); sel.clear(); persist(); renderList(); toast("Produtos excluídos");
  });
  $("#save").addEventListener("click", () => {
    const nome = state.nome.trim();
    if (!nome) { $("#f-nome").focus(); toast("Dê um nome ao produto para salvar."); return; }
    if (!last || last.err || last.P <= 0) { toast("Preencha os custos para ter um preço."); return; }
    const e = { nome, price: last.P, profit: last.profit, margin: last.margin, form: clone(state) };
    const i = items.findIndex(x => x.nome.toLowerCase() === nome.toLowerCase());
    if (i >= 0) items[i] = e; else items.unshift(e);
    sel.clear(); example = false; persist(); renderList(); toast(i >= 0 ? "Produto atualizado" : "Produto salvo");
  });

  /* ---------- Navegação ---------- */
  function go(v) {
    view = v;
    $$(".view").forEach(s => s.hidden = s.id !== "v-" + v);
    $$(".nav button").forEach(b => b.setAttribute("aria-current", b.dataset.v === v ? "page" : "false"));
    chip(); window.scrollTo({ top: 0 });
  }
  const chip = () => { $("#chip").hidden = view !== "calc" || heroSeen; };
  $$(".nav button").forEach(b => b.addEventListener("click", () => go(b.dataset.v)));
  $(".paint").addEventListener("click", () => { go("loja"); $("#swatches").scrollIntoView({ block: "center" }); });
  if ("IntersectionObserver" in window && document.querySelector("#hero")) new IntersectionObserver(([e]) => { heroSeen = e.isIntersecting; chip(); }).observe($("#hero"));

  /* ---------- Loja: nome, logo, cor, tema ---------- */
  const lum = h => { const n = parseInt(h.slice(1), 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; };
  function icon(size) {
    return new Promise(ok => {
      if (!cfg.logo) return ok(null);
      const im = new Image();
      im.onload = () => {
        const c = document.createElement("canvas"); c.width = c.height = size;
        const x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, size, size);
        const a = size * 0.68, r = Math.min(a / im.width, a / im.height), w = im.width * r, h = im.height * r;
        x.drawImage(im, (size - w) / 2, (size - h) / 2, w, h); ok(c.toDataURL("image/png"));
      };
      im.onerror = () => ok(null); im.src = cfg.logo;
    });
  }
  async function brand() {
    const n = cfg.nome.trim() || "Precifica", root = document.documentElement;
    document.title = n; $("#brand").textContent = n;
    $$(".logo").forEach(l => { l.innerHTML = cfg.logo ? `<img src="${cfg.logo}" alt="">` : esc(n[0].toUpperCase()); });
    root.style.setProperty("--accent", cfg.cor);
    root.style.setProperty("--on-accent", lum(cfg.cor) > 0.65 ? "#111" : "#fff");
    cfg.tema === "auto" ? root.removeAttribute("data-theme") : root.setAttribute("data-theme", cfg.tema);
    $("meta[name=theme-color]").content = cfg.cor;
    $$("#swatches button").forEach(b => b.classList.toggle("on", b.dataset.cor.toLowerCase() === cfg.cor.toLowerCase()));
    $$("#tema button").forEach(b => b.setAttribute("aria-pressed", b.dataset.t === cfg.tema));
    if (B.travado) return; // ícone e manifesto fixos (arquivos estáticos)
    // Manifesto gerado na hora: nome e ícone da loja
    const base = new URL("./", location.href).href;
    const [i192, i512, i180] = await Promise.all([icon(192), icon(512), icon(180)]);
    const m = { name: n, short_name: n.slice(0, 12), start_url: base, scope: base, display: "standalone", orientation: "portrait", lang: "pt-BR", background_color: "#F1F3F9", theme_color: cfg.cor,
      icons: [{ src: i192 || base + "icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any maskable" }, { src: i512 || base + "icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" }] };
    const link = $("#manifest"), old = link.href;
    link.href = URL.createObjectURL(new Blob([JSON.stringify(m)], { type: "application/manifest+json" }));
    if (old.startsWith("blob:")) URL.revokeObjectURL(old);
    $("#touch").href = i180 || base + "icons/apple-touch-icon.png";
    $("#fav").href = i192 || base + "icons/icon-192.png";
  }
  const saveCfg = () => { write(CFG, cfg); return brand(); };
  let bt; $("#c-nome").addEventListener("input", e => { cfg.nome = e.target.value; clearTimeout(bt); bt = setTimeout(saveCfg, 400); });
  $("#c-logo").addEventListener("change", e => {
    const f = e.target.files[0]; if (!f) return;
    const u = URL.createObjectURL(f), im = new Image();
    im.onload = () => {
      const r = Math.min(1, 512 / Math.max(im.width, im.height)), c = document.createElement("canvas");
      c.width = Math.round(im.width * r); c.height = Math.round(im.height * r);
      c.getContext("2d").drawImage(im, 0, 0, c.width, c.height); URL.revokeObjectURL(u);
      cfg.logo = c.toDataURL("image/png"); saveCfg(); toast("Logo salva");
    };
    im.onerror = () => toast("Não consegui ler essa imagem."); im.src = u; e.target.value = "";
  });
  $("#c-logo-rm").addEventListener("click", () => { cfg.logo = ""; saveCfg(); });
  $("#swatches").addEventListener("click", e => { const c = e.target.dataset.cor; if (c) { cfg.cor = c; $("#c-cor").value = c; saveCfg(); } });
  $("#c-cor").addEventListener("input", e => { cfg.cor = e.target.value; saveCfg(); });
  $("#tema").addEventListener("click", e => { const t = e.target.dataset.t; if (t) { cfg.tema = t; saveCfg(); } });

  /* ---------- Backup ---------- */
  $("#exp").addEventListener("click", () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify({ v: 2, cfg, items }, null, 1)], { type: "application/json" }));
    a.download = "precifica-backup.json"; a.click();
  });
  $("#csv").addEventListener("click", () => {
    if (!items.length) { toast("Salve algum produto antes."); return; }
    const f = n => n.toFixed(2).replace(".", ",");
    const rows = [["Produto", "Preço de venda", "Lucro por unidade", "Margem (%)"], ...items.map(it => [it.nome, f(it.price), f(it.profit), f(it.margin)])];
    const csv = "\ufeff" + rows.map(r => r.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(";")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })); a.download = "produtos.csv"; a.click();
  });
  $("#imp").addEventListener("change", async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const d = JSON.parse(await f.text());
      (d.items || []).forEach(it => { if (it && it.nome && it.form) { const i = items.findIndex(x => x.nome.toLowerCase() === it.nome.toLowerCase()); if (i >= 0) items[i] = it; else items.push(it); } });
      if (d.cfg) { cfg = { ...cfg, ...d.cfg }; lockCfg(); }
      persist(); write(CFG, cfg); renderList(); fillLoja(); brand(); toast("Backup importado");
    } catch { toast("Esse arquivo não é um backup válido."); }
    e.target.value = "";
  });

  /* ---------- Instalar (PWA) ---------- */
  let dip;
  addEventListener("beforeinstallprompt", e => { e.preventDefault(); dip = e; $("#install").hidden = false; });
  $("#install").addEventListener("click", async () => { if (!dip) return; dip.prompt(); await dip.userChoice; dip = null; $("#install").hidden = true; });
  addEventListener("appinstalled", () => toast("App instalado!"));
  if (matchMedia("(display-mode: standalone)").matches || navigator.standalone) $("#inst-card").hidden = true;
  if ("serviceWorker" in navigator) addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));

  /* ---------- Início ---------- */
  function fillLoja() { $("#c-nome").value = cfg.nome; $("#c-cor").value = cfg.cor; }
  if (B.travado) {
    $(".paint").hidden = true; $('.nav [data-v="loja"]').hidden = true;
    $("#v-list").append($("#inst-card")); // sem aba Loja, o botão de instalar vai para Produtos
    $("#inst-note").textContent = "Instale o app para abrir direto da tela inicial, como um aplicativo normal.";
  }
  renderPantry(); writeInputs(); render(); renderList(); fillLoja(); brand(); go("calc");
})();

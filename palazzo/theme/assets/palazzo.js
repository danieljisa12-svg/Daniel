/* Palazzo · interacción mínima sin dependencias. Si el JS falla, los formularios siguen funcionando sin él. */
(() => {
  const P = window.Palazzo || { routes: {} };
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  const money = (cents) => {
    const fmt = P.money || "{{amount_with_comma_separator}} €";
    const v = (cents / 100).toFixed(2);
    const [i, d] = v.split(".");
    const withDots = i.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    const withCommas = i.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return fmt.replace(/\{\{\s*(\w+)\s*\}\}/, (_, k) => ({
      amount: `${withCommas}.${d}`,
      amount_no_decimals: withCommas,
      amount_with_comma_separator: `${withDots},${d}`,
      amount_no_decimals_with_comma_separator: withDots,
    }[k] ?? `${withDots},${d}`));
  };

  /* ---------- Menú móvil ---------- */
  const mnav = $("[data-mnav]");
  const openBtn = $("[data-menu-open]");
  openBtn?.addEventListener("click", () => { mnav.classList.add("is-open"); openBtn.setAttribute("aria-expanded", "true"); document.body.style.overflow = "hidden"; $("[data-menu-close]", mnav)?.focus(); });
  $("[data-menu-close]")?.addEventListener("click", () => { mnav.classList.remove("is-open"); openBtn?.setAttribute("aria-expanded", "false"); document.body.style.overflow = ""; openBtn?.focus(); });

  /* ---------- Cesta lateral ---------- */
  const drawer = $("[data-drawer]");
  const scrim = $("[data-drawer-scrim]");
  let lastFocus = null;
  const openDrawer = () => { if (!drawer) return; lastFocus = document.activeElement; drawer.classList.add("is-open"); scrim.classList.add("is-open"); document.body.style.overflow = "hidden"; drawer.focus(); };
  const closeDrawer = () => { drawer?.classList.remove("is-open"); scrim?.classList.remove("is-open"); document.body.style.overflow = ""; lastFocus?.focus?.(); };
  $$("[data-cart-open]").forEach((a) => a.addEventListener("click", (e) => { if (!drawer || document.body.classList.contains("t-cart")) return; e.preventDefault(); openDrawer(); }));
  $("[data-drawer-close]")?.addEventListener("click", closeDrawer);
  scrim?.addEventListener("click", closeDrawer);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { closeDrawer(); if (mnav?.classList.contains("is-open")) $("[data-menu-close]").click(); } });

  async function refreshCart() {
    const [cart, html] = await Promise.all([
      fetch(`${P.routes.cart}.js`, { headers: { Accept: "application/json" } }).then((r) => r.json()),
      fetch(`${P.routes.root}?sections=cart-lines-ajax`).then((r) => r.json()).catch(() => null),
    ]);
    $$("[data-cart-count]").forEach((el) => { el.textContent = cart.item_count; el.hidden = cart.item_count === 0; });
    const sub = $("[data-cart-subtotal]"); if (sub) sub.textContent = money(cart.total_price);
    const chk = $("[data-drawer-checkout]"); if (chk) chk.disabled = cart.item_count === 0;
    if (html && html["cart-lines-ajax"]) {
      const tmp = document.createElement("div"); tmp.innerHTML = html["cart-lines-ajax"];
      const inner = tmp.querySelector(".shopify-section") || tmp;
      $("[data-drawer-items]").innerHTML = inner.innerHTML;
    }
    return cart;
  }

  document.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-qty-change]");
    if (!b) return;
    b.disabled = true;
    await fetch(`${P.routes.change}.js`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ id: b.dataset.qtyChange, quantity: Number(b.dataset.qty) }) });
    await refreshCart();
  });

  /* ---------- Ficha de producto ---------- */
  $$("[data-product]").forEach((root) => {
    const form = $("[data-product-form]", root);
    if (!form) return;
    const variants = JSON.parse($("[data-variants]", root)?.textContent || "[]");
    const idInput = $("[data-variant-id]", form);
    const addBtn = $("[data-add]", form);
    const addLabel = $("[data-add-label]", form);
    const err = $("[data-form-error]", form);
    const i18n = JSON.parse($("[data-i18n]", root)?.textContent || "{}");
    const stickyAdd = $("[data-sticky-add]", root);
    const stickyPrice = $("[data-sticky-price]", root);

    const selected = () => $$("[data-opt]:checked", form).map((i) => i.value);
    const setState = (v) => {
      const ok = !!v && v.available;
      addBtn.disabled = !ok; if (stickyAdd) stickyAdd.disabled = !ok;
      addLabel.textContent = !v ? (i18n.unavailable || "No disponible") : ok ? (i18n.add || "Añadir a la cesta") : (i18n.sold_out || "Agotado");
      if (!v) return;
      idInput.value = v.id;
      const wrap = $("[data-price-wrap]", root);
      if (wrap) {
        const sale = v.compare_at_price && v.compare_at_price > v.price;
        wrap.innerHTML = `<div class="price${sale ? " price--sale" : ""}"><span class="price__now">${money(v.price)}</span>${sale ? `<s><span class="visually-hidden">Precio anterior:</span> ${money(v.compare_at_price)}</s>` : ""}</div>`;
      }
      if (stickyPrice) stickyPrice.textContent = money(v.price);
      const url = new URL(location.href); url.searchParams.set("variant", v.id); history.replaceState(null, "", url);
      if (v.featured_media) {
        const fig = $(`[data-media-id="${v.featured_media.id}"]`, root);
        fig?.parentElement?.prepend(fig);
      }
    };
    form.addEventListener("change", (e) => {
      if (!e.target.matches("[data-opt]")) return;
      const sel = selected();
      $$("[data-opt-label]", form).forEach((l, i) => (l.textContent = sel[i]));
      setState(variants.find((v) => v.options.every((o, i) => o === sel[i])));
    });

    $$("[data-qty-step]", form).forEach((b) => b.addEventListener("click", () => {
      const q = $("input[name=quantity]", form);
      q.value = Math.max(1, Number(q.value || 1) + Number(b.dataset.qtyStep));
    }));

    form.addEventListener("submit", async (e) => {
      if (!drawer) return; // sin cesta lateral: envío normal del formulario
      e.preventDefault();
      err.hidden = true; addBtn.classList.add("is-loading");
      try {
        const res = await fetch(`${P.routes.add}.js`, { method: "POST", headers: { Accept: "application/json" }, body: new FormData(form) });
        const data = await res.json();
        if (!res.ok) throw new Error(data.description || data.message || "No se ha podido añadir");
        await refreshCart();
        openDrawer();
      } catch (ex) {
        err.textContent = ex.message; err.hidden = false;
      } finally { addBtn.classList.remove("is-loading"); }
    });

    // Barra de compra fija en móvil cuando el botón principal sale de pantalla.
    const bar = $("[data-sticky-buy]", root);
    if (bar && "IntersectionObserver" in window) {
      new IntersectionObserver(([en]) => {
        const show = !en.isIntersecting && en.boundingClientRect.top < 0;
        bar.classList.toggle("is-visible", show); bar.setAttribute("aria-hidden", String(!show));
        stickyAdd.tabIndex = show ? 0 : -1;
      }).observe(addBtn);
      stickyAdd?.addEventListener("click", () => form.requestSubmit ? form.requestSubmit() : addBtn.click());
    }
  });

  /* ---------- Productos relacionados (recomendaciones de Shopify) ---------- */
  $$("[data-related]").forEach(async (el) => {
    if (el.children.length) return;
    try {
      const html = await fetch(el.dataset.url).then((r) => r.text());
      const tmp = document.createElement("div"); tmp.innerHTML = html;
      const got = tmp.querySelector("[data-related]");
      if (got && got.innerHTML.trim()) el.innerHTML = got.innerHTML;
    } catch { /* sin recomendaciones: la sección queda vacía */ }
  });

  /* ---------- Ordenar colección ---------- */
  $("[data-sort]")?.addEventListener("change", (e) => e.target.form.submit());
})();

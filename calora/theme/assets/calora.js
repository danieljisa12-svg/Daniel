(function () {
  "use strict";
  var brand = window.__BRAND__ || {};
  var root = brand.root || "/";
  var $ = function (s, c) { return (c || document).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); };
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- Cuenta atrás con fecha real (no se reinicia) ---------- */
  var promo = $("[data-promo]");
  var deadline = promo ? new Date(promo.dataset.deadline).getTime() : 0;
  var clock = $("[data-clock]");
  var boxes = $("[data-clock-boxes]");
  var inline = $("[data-promo-inline]");
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function tickClock() {
    if (!deadline || isNaN(deadline)) return;
    var left = Math.max(0, Math.floor((deadline - Date.now()) / 1000));
    if (left <= 0) {
      if (promo) promo.classList.add("is-over");
      if (inline) inline.classList.add("is-over");
      return;
    }
    var d = Math.floor(left / 86400), h = Math.floor(left % 86400 / 3600), m = Math.floor(left % 3600 / 60), s = left % 60;
    if (clock) clock.textContent = (d ? d + "d " : "") + pad(h) + ":" + pad(m) + ":" + pad(s);
    if (boxes) {
      $("[data-d]", boxes).textContent = pad(d);
      $("[data-h]", boxes).textContent = pad(h);
      $("[data-m]", boxes).textContent = pad(m);
      $("[data-s]", boxes).textContent = pad(s);
    }
    setTimeout(tickClock, 1000);
  }
  tickClock();

  /* ---------- Scroll: barra de progreso, historia fijada, barra de compra ---------- */
  var bar = $("[data-progress]");
  var story = $("[data-story]");
  var storyImgs = story ? $$(".story-img", story) : [];
  var storySteps = story ? $$(".story-step", story) : [];
  var storyBar = $("[data-story-bar]");
  var sticky = $("[data-sticky-buy]");
  var hero = $(".hero");
  var buy = $("#comprar");
  var lastStep = 0, ticking = false;

  function onScroll() {
    ticking = false;
    var y = window.scrollY, vh = window.innerHeight;
    var max = document.documentElement.scrollHeight - vh;
    if (bar) bar.style.transform = "scaleX(" + (max > 0 ? y / max : 0) + ")";

    if (story && storySteps.length) {
      var r = story.getBoundingClientRect();
      var total = r.height - vh;
      var p = Math.min(1, Math.max(0, -r.top / (total || 1)));
      var step = Math.min(storySteps.length - 1, Math.floor(p * storySteps.length));
      if (storyBar) storyBar.style.transform = "scaleX(" + p + ")";
      if (step !== lastStep) {
        storySteps[lastStep].classList.remove("is-on");
        storyImgs[lastStep] && storyImgs[lastStep].classList.remove("is-on");
        storySteps[step].classList.add("is-on");
        storyImgs[step] && storyImgs[step].classList.add("is-on");
        lastStep = step;
      }
    }

    if (sticky && hero) {
      var past = hero.getBoundingClientRect().bottom < 0;
      var inBuy = false;
      if (buy) { var b = buy.getBoundingClientRect(); inBuy = b.top < vh * .6 && b.bottom > vh * .3; }
      var on = past && !inBuy;
      sticky.classList.toggle("is-on", on);
      sticky.setAttribute("aria-hidden", String(!on));
      var sb = $("[data-sticky-add]", sticky); if (sb) sb.tabIndex = on ? 0 : -1;
    }
  }
  window.addEventListener("scroll", function () { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } }, { passive: true });
  window.addEventListener("resize", onScroll);
  onScroll();

  /* ---------- Aparición al hacer scroll ---------- */
  var reveals = $$(".reveal");
  if ("IntersectionObserver" in window && !reduce) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add("is-in"); io.unobserve(e.target); } });
    }, { rootMargin: "0px 0px -10% 0px" });
    reveals.forEach(function (el, i) { el.style.transitionDelay = (i % 3) * 80 + "ms"; io.observe(el); });
  } else reveals.forEach(function (el) { el.classList.add("is-in"); });

  /* ---------- Fila horizontal: arrastrar con el ratón ---------- */
  $$("[data-drag]").forEach(function (row) {
    var down = false, sx = 0, sl = 0, moved = false;
    row.addEventListener("pointerdown", function (e) { if (e.pointerType !== "mouse") return; down = true; moved = false; sx = e.clientX; sl = row.scrollLeft; row.classList.add("is-drag"); });
    window.addEventListener("pointermove", function (e) { if (!down) return; var dx = e.clientX - sx; if (Math.abs(dx) > 3) moved = true; row.scrollLeft = sl - dx; });
    window.addEventListener("pointerup", function () { if (!down) return; down = false; row.classList.remove("is-drag"); });
    row.addEventListener("click", function (e) { if (moved) { e.preventDefault(); e.stopPropagation(); } }, true);
  });

  /* ---------- Galería ---------- */
  var mainImg = $("[data-main-img]");
  document.addEventListener("click", function (e) {
    var t = e.target.closest("[data-thumb]");
    if (!t || !mainImg) return;
    $$("[data-thumb]").forEach(function (b) { b.classList.toggle("is-on", b === t); });
    mainImg.style.opacity = 0;
    setTimeout(function () { mainImg.src = t.dataset.thumb; mainImg.style.opacity = 1; }, 150);
  });

  /* ---------- Packs: el precio sigue a la opción elegida ---------- */
  document.addEventListener("change", function (e) {
    var input = e.target.closest(".pack input");
    if (!input) return;
    $$(".pack").forEach(function (l) { l.classList.toggle("is-on", l.contains(input)); });
    $$("[data-price]").forEach(function (el) { if (el.tagName !== "INPUT") el.textContent = input.dataset.price; });
    $$("[data-compare]").forEach(function (el) { if (el.tagName !== "INPUT") { el.textContent = input.dataset.compare; el.hidden = !input.dataset.compare; } });
    $$("[data-save]").forEach(function (el) { if (el.tagName !== "INPUT") { el.textContent = input.dataset.save; el.hidden = !input.dataset.save; } });
  });

  /* ---------- Cesta ---------- */
  var panel = $("[data-cart]"), scrim = $("[data-cart-scrim]"), list = $("[data-cart-items]");
  var empty = $("[data-cart-empty]"), total = $("[data-cart-total]"), count = $("[data-cart-count]"), checkout = $("[data-cart-checkout]");
  var lastFocus = null;

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function money(cents) {
    var format = String(brand.moneyFormat || "{{amount_with_comma_separator}} €").replace(/<[^>]*>/g, "");
    var value = (Number(cents) || 0) / 100;
    function sep(dec, th, dp) { var p = value.toFixed(dec).split("."); p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, th); return p.join(dp); }
    return format.replace(/\{\{\s*(\w+)\s*\}\}/, function (_, k) {
      switch (k) {
        case "amount": return sep(2, ",", ".");
        case "amount_no_decimals": return sep(0, ",", ".");
        case "amount_no_decimals_with_comma_separator": return sep(0, ".", ",");
        case "amount_with_apostrophe_separator": return sep(2, "'", ".");
        case "amount_with_space_separator": return sep(2, " ", ",");
        default: return sep(2, ".", ",");
      }
    });
  }
  function render(cart) {
    if (!cart || !cart.items) return;
    if (list) list.innerHTML = cart.items.map(function (it) {
      var name = it.product_title + (it.variant_title && it.variant_title !== "Default Title" ? " · " + it.variant_title : "");
      var img = it.image ? '<img src="' + esc(it.image) + (it.image.indexOf("?") > -1 ? "&" : "?") + 'width=120" alt="" width="56" height="56">' : "<span></span>";
      return '<li class="cart-item" data-key="' + esc(it.key) + '" data-quantity="' + it.quantity + '">' + img +
        '<span class="cart-item-name">' + esc(name) + '</span><span class="cart-item-price">' + esc(money(it.final_line_price)) + "</span>" +
        '<span class="cart-qty"><button type="button" data-qty="-1" aria-label="Quitar una unidad">−</button><span>' + it.quantity +
        '</span><button type="button" data-qty="1" aria-label="Añadir una unidad">+</button></span>' +
        '<button class="cart-remove" type="button" data-remove>Quitar</button></li>';
    }).join("");
    if (empty) empty.hidden = cart.item_count > 0;
    if (total) total.textContent = money(cart.total_price);
    if (count) count.textContent = String(cart.item_count);
    if (checkout) checkout.setAttribute("aria-disabled", String(cart.item_count === 0));
  }
  function request(path, body) {
    return fetch(root + path, {
      method: body ? "POST" : "GET", credentials: "same-origin",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) { if (!r.ok) throw new Error("cart " + r.status); return r.json(); });
  }
  function refresh() { return request("cart.js").then(render); }
  function open() {
    if (!panel) return;
    lastFocus = document.activeElement;
    panel.classList.add("is-open"); panel.setAttribute("aria-hidden", "false");
    if (scrim) { scrim.hidden = false; requestAnimationFrame(function () { scrim.classList.add("is-open"); }); }
    panel.focus({ preventScroll: true });
  }
  function close() {
    if (!panel) return;
    panel.classList.remove("is-open"); panel.setAttribute("aria-hidden", "true");
    if (scrim) { scrim.classList.remove("is-open"); setTimeout(function () { scrim.hidden = true; }, 400); }
    if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
  }
  function selectedVariant(scope) {
    var form = scope || $("[data-buy-form]") || $('form[data-type="add-to-cart-form"]');
    if (!form) return null;
    var checked = $('input[name="id"]:checked', form) || form.elements.id;
    return checked && checked.value;
  }
  function add(variantId, btn, thenCheckout) {
    if (!variantId) return;
    if (btn) btn.disabled = true;
    return request("cart/add.js", { items: [{ id: Number(variantId), quantity: 1 }] })
      .then(function () {
        if (thenCheckout) { window.location.href = root + "checkout"; return; }
        return refresh().then(function () {
          if (count) { count.classList.add("is-bump"); setTimeout(function () { count.classList.remove("is-bump"); }, 600); }
          open();
        });
      })
      .catch(function () { alert("No se ha podido añadir. Inténtalo de nuevo."); })
      .then(function () { if (btn) btn.disabled = false; });
  }

  document.addEventListener("submit", function (e) {
    var form = e.target.closest('form[data-type="add-to-cart-form"]');
    if (!form) return;
    e.preventDefault();
    add(selectedVariant(form), $("[data-add]", form), false);
  });
  document.addEventListener("click", function (e) {
    var bn = e.target.closest("[data-buy-now]");
    if (bn) { e.preventDefault(); add(selectedVariant(bn.form || bn.closest("form")), bn, true); return; }
    var sa = e.target.closest("[data-sticky-add]");
    if (sa) { add(selectedVariant(), sa, false); return; }
    if (e.target.closest("[data-cart-open]")) { refresh().catch(function () {}); return open(); }
    if (e.target.closest("[data-cart-close]") || e.target === scrim) return close();
    var row = e.target.closest(".cart-item");
    if (!row) return;
    var q = e.target.closest("[data-qty]");
    var nq = q ? Number(row.dataset.quantity) + Number(q.dataset.qty) : (e.target.closest("[data-remove]") ? 0 : null);
    if (nq !== null) request("cart/change.js", { id: row.dataset.key, quantity: Math.max(0, nq) }).then(render).catch(refresh);
  });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && panel && panel.classList.contains("is-open")) close(); });

  // Botón principal con pulso para llamar la atención
  $$("[data-buy-form] [data-add]").forEach(function (b) { if (!reduce) b.classList.add("btn-pulse"); });

  refresh().catch(function () {});
})();

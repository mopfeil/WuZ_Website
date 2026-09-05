/* Wissenschaft und Zauberkunst – kleine Helfer, kein Tracking. */
(function () {
  "use strict";

  // Jahr im Footer
  document.querySelectorAll("[data-year]").forEach(function (el) {
    el.textContent = String(new Date().getFullYear());
  });

  // Mobiles Menü schließen, sobald ein Link geklickt wurde
  var toggle = document.getElementById("nav-toggle");
  if (toggle) {
    document.querySelectorAll(".site-nav a").forEach(function (a) {
      a.addEventListener("click", function () { toggle.checked = false; });
    });
  }

  // Sanftes Einblenden beim Scrollen
  var items = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window && items.length) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
      });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
    items.forEach(function (el) { io.observe(el); });
  } else {
    items.forEach(function (el) { el.classList.add("in"); });
  }
})();

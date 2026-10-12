/* Apply a saved device preference before the application paints. No login required. */
(function () {
  var theme = "light";
  try {
    var saved = JSON.parse(localStorage.getItem("hvm:appearance:v1") || "null");
    if (saved && (saved.theme === "light" || saved.theme === "dark")) theme = saved.theme;
    else {
      var match = document.cookie.match(/(?:^|;\s*)hvm_theme=(light|dark)(?:;|$)/);
      if (match) theme = match[1];
    }
  } catch (_) {
    try {
      var fallback = document.cookie.match(/(?:^|;\s*)hvm_theme=(light|dark)(?:;|$)/);
      if (fallback) theme = fallback[1];
    } catch (_) {}
  }
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme === "dark" ? "#11241a" : "#1B4D2E");
})();

// Run before startup-theme.js and before Zustand creates any persisted stores.
// Keep legacy entries for rollback; an existing Krosna value always wins.
(function () {
  try {
    var keys = [];
    for (var index = 0; index < localStorage.length; index += 1) {
      var key = localStorage.key(index);
      if (key && key.indexOf("termflow") === 0) keys.push(key);
    }
    keys.forEach(function (key) {
      var target = "krosna" + key.slice("termflow".length);
      if (localStorage.getItem(target) === null) {
        var value = localStorage.getItem(key);
        if (value !== null) localStorage.setItem(target, value);
      }
    });
  } catch (_error) {
    // A restricted browser storage must not prevent the app from starting.
  }
})();

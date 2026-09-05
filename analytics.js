(() => {
  window.va = window.va || function () {
    (window.vaq = window.vaq || []).push(arguments);
  };

  const clean = value => String(value ?? '').slice(0, 120);
  const number = value => Number.isFinite(Number(value)) ? Number(value) : undefined;

  function track(name, properties = {}) {
    const payload = {};
    Object.entries(properties).forEach(([key, value]) => {
      if (value === undefined || value === null || value === '') return;
      payload[key] = typeof value === 'number' ? value : clean(value);
    });
    window.va('event', { name: clean(name), data: payload });
  }

  window.MitiToysAnalytics = { track, number };

  document.addEventListener('click', event => {
    const link = event.target.closest('a[href*="wa.me"]');
    if (link) track('whatsapp_click', { page: location.pathname });
  });
})();

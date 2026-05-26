(function () {
  var connection = null;
  var startPromise = null;
  var started = false;
  var handlers = {};

  function canUse() {
    return typeof window !== 'undefined'
      && window.signalR
      && window.LifeDropApi
      && typeof window.LifeDropApi.getAccessToken === 'function';
  }

  function buildHubUrl() {
    var base = (window.LifeDropApi && window.LifeDropApi.baseUrl) || '';
    if (!base) return '';
    return base.replace(/\/api\/?$/i, '') + '/hubs/donations';
  }

  function dispatchRealtimeEvent(eventName, payload) {
    try {
      window.dispatchEvent(new CustomEvent('lifedrop:realtime:' + eventName, { detail: payload }));
    } catch (_) {}
  }

  function bindEvent(eventName) {
    if (!connection || handlers[eventName]) return;
    var set = new Set();
    handlers[eventName] = set;
    connection.on(eventName, function (payload) {
      set.forEach(function (fn) {
        try { fn(payload); } catch (e) { console.warn('Realtime handler error for', eventName, e); }
      });
      dispatchRealtimeEvent(eventName, payload);
    });
  }

  function ensureConnection() {
    if (!canUse()) return null;
    if (connection) return connection;
    var hubUrl = buildHubUrl();
    if (!hubUrl) return null;
    connection = new window.signalR.HubConnectionBuilder()
      .withUrl(hubUrl, {
        accessTokenFactory: function () {
          return (window.LifeDropApi && window.LifeDropApi.getAccessToken && window.LifeDropApi.getAccessToken()) || '';
        }
      })
      .withAutomaticReconnect()
      .build();

    connection.onreconnecting(function () {
      if (window.LifeDropUi && window.LifeDropUi.showToast) {
        window.LifeDropUi.showToast('Realtime reconnecting...', 'error');
      } else {
        console.warn('Realtime reconnecting...');
      }
    });
    connection.onreconnected(function () {
      if (window.LifeDropUi && window.LifeDropUi.showToast) {
        window.LifeDropUi.showToast('Realtime connected.', 'success');
      }
    });
    connection.onclose(function (err) {
      if (err) console.warn('Realtime connection closed', err);
      started = false;
      startPromise = null;
    });
    return connection;
  }

  async function start() {
    var token = window.LifeDropApi && window.LifeDropApi.getAccessToken && window.LifeDropApi.getAccessToken();
    if (!token) return false;
    var conn = ensureConnection();
    if (!conn) return false;
    if (started) return true;
    if (startPromise) return startPromise;
    startPromise = conn.start().then(function () {
      started = true;
      return true;
    }).catch(function (err) {
      console.warn('Realtime start failed', err);
      startPromise = null;
      return false;
    });
    return startPromise;
  }

  function on(eventName, handler) {
    if (!eventName || typeof handler !== 'function') return function () {};
    ensureConnection();
    bindEvent(eventName);
    if (!handlers[eventName]) handlers[eventName] = new Set();
    handlers[eventName].add(handler);
    return function () {
      var set = handlers[eventName];
      if (set) set.delete(handler);
    };
  }

  function stop() {
    if (!connection) return Promise.resolve();
    var conn = connection;
    connection = null;
    started = false;
    startPromise = null;
    handlers = {};
    return conn.stop().catch(function () {});
  }

  window.LifeDropRealtime = {
    start: start,
    on: on,
    stop: stop
  };
})();


(async function () {
  const statusEl = document.getElementById('status');
  const logEl = document.getElementById('log');
  const destEl = document.getElementById('dest');
  const btnConnect = document.getElementById('btn-connect');
  const btnDisconnect = document.getElementById('btn-disconnect');
  const btnCall = document.getElementById('btn-call');
  const btnHangup = document.getElementById('btn-hangup');
  const remoteAudio = document.getElementById('remoteAudio');
  const ringback = document.getElementById('ringback');

  const log = (...args) => {
    const line = args.map(x => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ');
    logEl.textContent += line + '\n';
    logEl.scrollTop = logEl.scrollHeight;
    console.log('[webphone]', ...args);
  };
  const setStatus = (s) => statusEl.textContent = 'Status: ' + s;

  // Fetch server-side public config
  const cfgRes = await fetch('/config');
  const cfg = await cfgRes.json();

  // Build JsSIP UA (we don’t expose password here)
  // We’ll prompt for mic permission up front
  try {
    await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    setStatus('microphone permission denied');
    return;
  }

  setStatus('ready — click Connect');
  btnConnect.disabled = false;

  let ua = null;
  let session = null;

  function buildUA() {
    // Important: we keep password on the client only because this sample
    // avoids a backend auth flow. For production, consider token-based auth.
    const password = prompt('Enter your SIP password (for ' + cfg.sipUri + '):', '');
    if (!password) {
      alert('Password required.');
      return null;
    }

    const socket = new JsSIP.WebSocketInterface(cfg.sipWssUrl);
    const uaConfig = {
      sockets: [socket],
      uri: cfg.sipUri,
      password,
      display_name: cfg.displayName,
      register: true,
      session_timers: false,
      hack_via_ws: true,
      connection_recovery_min_interval: 2,
      connection_recovery_max_interval: 30,
      pcConfig: {
        iceServers: cfg.iceServers && cfg.iceServers.length ? cfg.iceServers : [{ urls: 'stun:stun.l.google.com:19302' }]
      }
    };

    const _ua = new JsSIP.UA(uaConfig);

    _ua.on('registered', () => { setStatus('registered'); btnCall.disabled = false; btnDisconnect.disabled = false; log('registered'); });
    _ua.on('unregistered', () => { setStatus('unregistered'); btnCall.disabled = true; log('unregistered'); });
    _ua.on('registrationFailed', (e) => { setStatus('registration failed'); log('registrationFailed', e.cause || e); });

    // Incoming calls (optional)
    _ua.on('newRTCSession', (data) => {
      if (data.originator === 'remote') {
        log('incoming call');
        session = data.session;
        handleSession(session, /*outgoing*/false);
      }
    });

    _ua.start();
    return _ua;
  }

  function handleSession(s, outgoing) {
    // Attach remote audio
    s.on('peerconnection', () => {
      const pc = s.connection;
      if (!pc) return;
      pc.addEventListener('track', (e) => {
        if (e.streams && e.streams[0]) {
          remoteAudio.srcObject = e.streams[0];
        } else {
          // Fallback: build stream from tracks
          const inbound = new MediaStream();
          inbound.addTrack(e.track);
          remoteAudio.srcObject = inbound;
        }
      });
    });

    s.on('progress', () => { setStatus('ringing…'); ringback.play().catch(()=>{}); });
    s.on('accepted', () => { setStatus('in call'); ringback.pause(); ringback.currentTime = 0; btnHangup.disabled = false; });
    s.on('confirmed', () => { log('call confirmed'); });
    s.on('ended', () => { setStatus('idle'); cleanupSession(); });
    s.on('failed', (e) => { setStatus('call failed'); log('failed', e.cause || e); cleanupSession(); });

    // DTMF via keypad
    document.querySelectorAll('.dial').forEach(btn => {
      btn.onclick = () => {
        const tone = btn.getAttribute('data-d');
        if (session && session.isEstablished()) {
          try { session.sendDTMF(tone); } catch(_) {}
        } else {
          destEl.value += tone;
        }
      };
    });
  }

  function cleanupSession() {
    ringback.pause(); ringback.currentTime = 0;
    btnHangup.disabled = true;
    session = null;
  }

  btnConnect.onclick = () => {
    if (ua) return;
    ua = buildUA();
    if (!ua) return;
    btnConnect.disabled = true;
  };

  btnDisconnect.onclick = () => {
    if (session) { try { session.terminate(); } catch(_) {} }
    if (ua) { try { ua.stop(); } catch(_) {} }
    ua = null;
    btnConnect.disabled = false;
    btnDisconnect.disabled = true;
    btnCall.disabled = true;
    setStatus('disconnected');
  };

  btnCall.onclick = () => {
    if (!ua) return alert('Connect first.');
    const dest = (destEl.value || '').trim();
    if (!dest) return alert('Enter destination.');

    // If user typed plain number, turn into SIP URI using your domain
    let target = dest;
    if (!/sip:/i.test(target)) {
      // derive domain from configured SIP URI
      const host = cfg.sipUri.split('@')[1];
      target = `sip:${dest}@${host}`;
    }

    const options = {
      mediaConstraints: { audio: true, video: false },
      rtcOfferConstraints: { offerToReceiveAudio: 1, offerToReceiveVideo: 0 }
    };

    session = ua.call(target, options);
    handleSession(session, /*outgoing*/true);
    btnHangup.disabled = false;
    setStatus('calling…');
  };

  btnHangup.onclick = () => {
    if (session) {
      try { session.terminate(); } catch (_) {}
    }
  };
})();

(() => {
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const state = { socket: null, bridgeReady: false, tvConnected: false, address: localStorage.getItem('tvRemoteAddress') || 'ws://127.0.0.1:8765/bridge', image: null, imageName: '', drawing: false, drawingNow: false, lastPrompt: '' };
  const picker = $('#image-picker');
  let toastTimer;

  function toast(message) {
    const element = $('#toast');
    element.textContent = message;
    element.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => element.classList.remove('show'), 2800);
  }

  function connected() { return state.bridgeReady && state.tvConnected; }
  function connectionCopy(message) {
    $('#connection-label').textContent = message;
    $$('.remote-connection-label').forEach((node) => node.textContent = message);
    $('#connection-pill').classList.toggle('connected', connected());
    $('#device-tag-label').textContent = connected() ? 'Connected to your TV' : (state.bridgeReady ? 'Bridge ready · TV not connected' : 'Waiting for your TV');
    $('#connection-detail').textContent = connected() ? `Connected · ${state.address}` : (state.bridgeReady ? 'Bridge ready · pair/connect the TV' : 'Start the local bridge on this computer');
    $('#keyboard-status').textContent = connected() ? 'Connected to your TV' : 'No TV connected';
    $('#remote-hint').textContent = connected() ? 'Connected. Remote commands will be sent to your TV.' : (state.bridgeReady ? 'Bridge is ready. Pair and connect your TV over Wi-Fi.' : 'Start the local bridge on this computer to send commands.');
  }

  function send(payload) {
    if (!state.bridgeReady) { toast('Start the local bridge from tv-remote/start-bridge.ps1 first.'); return false; }
    if (!state.tvConnected) { toast('Pair and connect the TV in Wireless debugging first.'); return false; }
    try { state.socket.send(JSON.stringify(payload)); return true; }
    catch { toast('Could not send to the TV receiver.'); return false; }
  }

  function connect(address = $('#tv-address').value.trim()) {
    if (!address) address = 'ws://127.0.0.1:8765/bridge';
    if (!/^wss?:\/\//i.test(address)) { toast('Use the local bridge address, like ws://127.0.0.1:8765/bridge'); return; }
    if (state.socket) state.socket.close();
    state.address = address;
    localStorage.setItem('tvRemoteAddress', address);
    $('#tv-address').value = address;
    connectionCopy('Connecting…');
    try { state.socket = new WebSocket(address); }
    catch { connectionCopy('TV not connected'); toast('That receiver address could not be opened.'); return; }
    state.socket.addEventListener('open', () => {
      state.bridgeReady = true;
      connectionCopy('Checking TV…');
      state.socket.send(JSON.stringify({ type: 'status' }));
    });
    state.socket.addEventListener('close', () => { state.bridgeReady = false; state.tvConnected = false; connectionCopy('TV not connected'); });
    state.socket.addEventListener('error', () => { state.bridgeReady = false; state.tvConnected = false; connectionCopy('TV not connected'); toast('Could not reach the local bridge. Start it on this computer.'); });
    state.socket.addEventListener('message', (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'status') {
          state.tvConnected = Boolean(message.connected);
          connectionCopy(state.tvConnected ? 'TV connected' : 'Bridge ready · TV not connected');
          if (message.name) $('#device-tag-label').textContent = message.name;
        }
        if (message.type === 'error') toast(message.message || 'The TV could not complete that action.');
      } catch { /* Ignore receiver messages that are not JSON. */ }
    });
  }

  function showView(name) {
    $('#home-view').hidden = name !== 'home';
    $('#remote-view').hidden = name !== 'remote';
    $('#gallery-view').hidden = name !== 'gallery';
    $$('.rail-btn[data-view]').forEach((button) => button.classList.toggle('active', button.dataset.view === name));
    if (name === 'remote' && connected()) $('#remote-hint').textContent = 'Connected. Remote commands will be sent to your TV.';
  }

  function showAssistant() {
    $('#assistant-card').classList.remove('assistant-hidden');
    $('#assistant-card').classList.add('assistant-open');
    $('#assistant-text').focus();
    if (window.innerWidth <= 900) {
      toast('Nova is available in the full desktop layout.');
    }
  }

  function openImageViewer() {
    if (!state.image) { picker.click(); return; }
    $('#viewer-image').src = state.image;
    $('#viewer-name').textContent = state.imageName || 'Photo';
    $('#image-viewer').hidden = false;
    document.body.style.overflow = 'hidden';
    $('#image-viewer').requestFullscreen?.().catch(() => {});
    resizeCanvas();
    $('#viewer-hint').textContent = state.drawing ? 'Drawing enabled · Use your finger or mouse · Esc to exit' : 'Preview on this screen · Press Esc to exit';
  }

  function closeViewer() {
    if (!$('#image-viewer').hidden) $('#image-viewer').hidden = true;
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    document.body.style.overflow = '';
    state.drawing = false;
    $('#image-viewer').classList.remove('drawing');
    $('#draw-toggle').classList.remove('active');
  }

  function resizeCanvas() {
    const canvas = $('#draw-canvas');
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    const context = canvas.getContext('2d');
    context.scale(dpr, dpr);
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.lineWidth = 5;
    context.strokeStyle = '#c3a5ff';
  }

  function getPoint(event) {
    const rect = $('#draw-canvas').getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function closePopover() { $('#add-popover').hidden = true; }

  function handleAction(action) {
    closePopover();
    if (action === 'upload') { picker.click(); return; }
    if (action === 'remote') { showView('remote'); return; }
    if (action === 'gallery' || action === 'apps') { showView('gallery'); return; }
    if (action === 'settings') { $('#settings-modal').hidden = false; return; }
    if (action === 'keyboard') { $('#keyboard-modal').hidden = false; $('#keyboard-input').focus(); return; }
    if (action === 'draw') {
      if (!state.image) { toast('Choose a photo first, then you can draw over it.'); picker.click(); return; }
      state.drawing = true;
      openImageViewer();
      toggleDrawing(true);
      return;
    }
    if (action === 'assistant') { showAssistant(); $('#assistant-text').focus(); return; }
  }

  function toggleDrawing(force) {
    state.drawing = force ?? !state.drawing;
    $('#image-viewer').classList.toggle('drawing', state.drawing);
    $('#draw-toggle').classList.toggle('active', state.drawing);
    $('#viewer-hint').textContent = state.drawing ? 'Drawing enabled · Use your finger or mouse · Esc to exit' : 'Preview on this screen · Press Esc to exit';
  }

  function openSettings() { $('#settings-modal').hidden = false; }

  function addPhoto(file) {
    if (!file || !file.type.startsWith('image/')) { toast('Choose an image file to add.'); return; }
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      state.image = reader.result;
      state.imageName = file.name;
      $('#viewer-image').src = state.image;
      $('#viewer-name').textContent = file.name;
      $('#gallery-empty').hidden = true;
      const thumb = document.createElement('button');
      thumb.className = 'thumb';
      thumb.innerHTML = `<img alt=""><span></span>`;
      thumb.querySelector('img').src = state.image;
      thumb.querySelector('span').textContent = file.name;
      thumb.addEventListener('click', openImageViewer);
      $('#gallery-thumbs').prepend(thumb);
      showView('gallery');
      openImageViewer();
    });
    reader.readAsDataURL(file);
  }

  function sendImage() {
    if (!state.image) { toast('Choose an image first.'); return; }
    const canvas = $('#draw-canvas');
    const hasDrawing = state.drawing || canvas.toDataURL() !== blankCanvasData(canvas);
    send({ type: 'show_image', name: state.imageName, data: state.image, drawing: hasDrawing ? canvas.toDataURL('image/png') : null });
    if (connected()) toast('Image sent to your TV.');
  }

  function blankCanvasData(canvas) {
    const blank = document.createElement('canvas');
    blank.width = canvas.width;
    blank.height = canvas.height;
    return blank.toDataURL();
  }

  function submitPrompt(prompt) {
    const normalized = prompt.toLowerCase();
    state.lastPrompt = prompt;
    let answer = 'I can help with the remote, your photos, and quick settings. What would you like to do?';
    if (/volume up|louder/.test(normalized)) { send({ type: 'command', command: 'volume_up' }); answer = 'Turning the volume up. (Your TV needs a connected receiver.)'; }
    else if (/volume down|quieter/.test(normalized)) { send({ type: 'command', command: 'volume_down' }); answer = 'Turning the volume down. (Your TV needs a connected receiver.)'; }
    else if (/mute/.test(normalized)) { send({ type: 'command', command: 'mute' }); answer = 'Toggling mute. (Your TV needs a connected receiver.)'; }
    else if (/show|open|photo|picture|image/.test(normalized)) { answer = state.image ? `Opening ${state.imageName} in the fullscreen viewer.` : 'Choose an image from Photos and I’ll open it fullscreen.'; if (state.image) openImageViewer(); else showView('gallery'); }
    else if (/home/.test(normalized)) { send({ type: 'command', command: 'home' }); answer = 'Going to the TV home screen. (Your TV needs a connected receiver.)'; }
    else if (/back/.test(normalized)) { send({ type: 'command', command: 'back' }); answer = 'Going back on the TV. (Your TV needs a connected receiver.)'; }
    else if (/play|pause/.test(normalized)) { send({ type: 'command', command: 'play_pause' }); answer = 'Toggling play and pause. (Your TV needs a connected receiver.)'; }
    else if (/connect/.test(normalized)) { openSettings(); answer = 'Open Quick settings and enter the receiver address to connect your TV.'; }
    else if (/what can|help/.test(normalized)) { answer = 'I can send basic remote commands, open your photos, or help you connect a TV receiver.'; }
    $('#assistant-hint').textContent = answer;
    $('#assistant-text').value = '';
    if ('speechSynthesis' in window && !$('#assistant-card').classList.contains('assistant-hidden')) {
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(new SpeechSynthesisUtterance(answer));
    }
  }

  function startListening() {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) { toast('Voice input is not supported in this browser. Try Chrome or Edge.'); return; }
    const recognition = new Recognition();
    recognition.lang = navigator.language || 'en-US';
    recognition.interimResults = false;
    $('#assistant-card').classList.add('listening');
    $('#assistant-hint').textContent = 'Listening… go ahead.';
    recognition.onresult = (event) => submitPrompt(event.results[0][0].transcript);
    recognition.onerror = () => { $('#assistant-card').classList.remove('listening'); $('#assistant-hint').textContent = 'I didn’t catch that. Try again or type your request.'; };
    recognition.onend = () => $('#assistant-card').classList.remove('listening');
    recognition.start();
  }

  $$('.rail-btn[data-view], [data-view="home"], [data-view="remote"]').forEach((button) => button.addEventListener('click', () => showView(button.dataset.view)));
  $('#add-button').addEventListener('click', (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const popover = $('#add-popover');
    popover.hidden = !popover.hidden;
    if (!popover.hidden) { popover.style.left = `${Math.max(14, Math.min(rect.left - 220, innerWidth - 292))}px`; popover.style.top = `${rect.bottom + 10}px`; }
  });
  $('#quick-settings-btn').addEventListener('click', openSettings);
  $('#top-settings').addEventListener('click', openSettings);
  $('#remote-settings').addEventListener('click', openSettings);
  $('#connect-btn').addEventListener('click', openSettings);
  $('#save-connect').addEventListener('click', () => connect());
  $('#tv-address').addEventListener('keydown', (event) => { if (event.key === 'Enter') connect(); });
  $('#disconnect-btn').addEventListener('click', () => { state.socket?.close(); state.socket = null; state.address = ''; localStorage.removeItem('tvRemoteAddress'); connectionCopy('TV not connected'); toast('Disconnected from the TV.'); });
  $('#tv-address').value = state.address;
  $('#open-remote-btn').addEventListener('click', () => showView('remote'));
  $$('.launcher-card,.menu-item,.tool-card').forEach((button) => button.addEventListener('click', () => {
    if (button.dataset.action === 'assistant') showAssistant();
    handleAction(button.dataset.action);
  }));
  $$('[data-close]').forEach((button) => button.addEventListener('click', () => { $(`#${button.dataset.close}`).hidden = true; }));
  $$('.modal-backdrop').forEach((backdrop) => backdrop.addEventListener('click', (event) => { if (event.target === backdrop) backdrop.hidden = true; }));
  document.addEventListener('click', (event) => { if (!event.target.closest('#add-popover') && !event.target.closest('#add-button')) closePopover(); });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { closeViewer(); $$('.modal-backdrop').forEach((modal) => modal.hidden = true); closePopover(); }
    const active = document.activeElement;
    if (event.key === ' ' && active.tagName !== 'INPUT' && active.tagName !== 'TEXTAREA' && !$('#image-viewer').hidden) { event.preventDefault(); send({ type: 'command', command: 'play_pause' }); }
    if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Enter'].includes(event.key) && !$('#remote-view').hidden && active.tagName !== 'INPUT' && active.tagName !== 'TEXTAREA') {
      event.preventDefault(); const command = { ArrowUp:'up',ArrowDown:'down',ArrowLeft:'left',ArrowRight:'right',Enter:'enter' }[event.key]; send({ type:'command',command });
    }
  });

  picker.addEventListener('change', (event) => { const file = event.target.files?.[0]; if (file) addPhoto(file); event.target.value = ''; });
  $('#upload-gallery').addEventListener('click', () => picker.click());
  $('#empty-upload').addEventListener('click', () => picker.click());
  $('#send-gallery').addEventListener('click', sendImage);
  $('#close-viewer').addEventListener('click', closeViewer);
  $('#draw-toggle').addEventListener('click', () => toggleDrawing());
  $('#clear-drawing').addEventListener('click', () => { const canvas = $('#draw-canvas'); canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height); toast('Drawing cleared.'); });
  $('#send-image').addEventListener('click', sendImage);
  $('#draw-canvas').addEventListener('pointerdown', (event) => { if (!state.drawing) return; state.drawingNow = true; event.currentTarget.setPointerCapture(event.pointerId); const p = getPoint(event); const ctx = event.currentTarget.getContext('2d'); ctx.beginPath(); ctx.moveTo(p.x,p.y); });
  $('#draw-canvas').addEventListener('pointermove', (event) => { if (!state.drawingNow) return; const p = getPoint(event); const ctx = event.currentTarget.getContext('2d'); ctx.lineTo(p.x,p.y); ctx.stroke(); });
  $('#draw-canvas').addEventListener('pointerup', () => state.drawingNow = false);
  $('#draw-canvas').addEventListener('pointercancel', () => state.drawingNow = false);
  window.addEventListener('resize', () => { if (!$('#image-viewer').hidden) resizeCanvas(); });
  $$('[data-command]').forEach((button) => button.addEventListener('click', () => send({ type: 'command', command: button.dataset.command })));
  $('#open-keyboard').addEventListener('click', () => { $('#settings-modal').hidden = true; $('#keyboard-modal').hidden = false; $('#keyboard-input').focus(); });
  $('#send-text').addEventListener('click', () => { const text = $('#keyboard-input').value; if (!text.trim()) { toast('Type something first.'); return; } if (send({ type: 'text', text })) toast('Text sent to the TV.'); });
  $('#edit-port').addEventListener('click', () => { const current = $('#port-label').textContent; const port = prompt('TV receiver WebSocket port', current); if (!port) return; const number = Number(port); if (!Number.isInteger(number) || number < 1 || number > 65535) { toast('Enter a valid port from 1 to 65535.'); return; } $('#port-label').textContent = String(number); const input = $('#tv-address'); try { const url = new URL(input.value); url.port = String(number); input.value = url.toString(); } catch {} });
  $('#open-wifi-settings').addEventListener('click', () => {
    if (send({ type: 'command', command: 'open_wifi_settings' })) toast('Opening Wi-Fi settings on your TV.');
  });

  $('#orb-button').addEventListener('click', startListening);
  $('#assistant-form').addEventListener('submit', (event) => { event.preventDefault(); const prompt = $('#assistant-text').value.trim(); if (prompt) submitPrompt(prompt); });
  $$('.suggestion-list button').forEach((button) => button.addEventListener('click', () => submitPrompt(button.dataset.prompt)));
  $('#close-assistant').addEventListener('click', () => { $('#assistant-card').classList.add('assistant-hidden'); $('#assistant-card').classList.remove('assistant-open'); });
  $('#assistant-card').classList.remove('assistant-hidden');
  connectionCopy('TV not connected');
})();

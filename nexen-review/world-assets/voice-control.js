// Local push-to-talk for NEXEN's DOM. This never controls the Windows pointer.
export const VOICE_ROUTES = new Set(['/', '/voice', '/next', '/money', '/game', '/lookbook', '/plans', '/connections', '/tasks', '/day', '/photos', '/problems', '/lab', '/guide', '/diagnostics','/desktop','/storage','/memory-pools','/automatic-mode','/check-in','/problem-cases']);
const WORKSPACES = new Set(['memory', 'store', 'requests', 'music', 'control', 'digest', 'skills', 'ai', 'map', 'guide']);
const SAFE_BUTTONS = new Set(['world', 'memory', 'store', 'requests', 'music', 'control', 'digest', 'skills', 'ai', 'map', 'master', 'prompts', 'guide', 'brief', 'close']);
const MAX_SECONDS = 20;
export const PENDING_QUESTION_KEY = 'nexen.voice.pending_question';

export function createMicrophoneGate(devices, timeoutMs = 30000) {
  let flight = null;
  return { request(constraints) {
    if (flight) return Promise.reject(Object.assign(Error('A browser microphone permission request is still waiting. Resolve that prompt before trying again.'), {name:'MicrophonePermissionPending'}));
    if (!devices?.getUserMedia) return Promise.reject(Error('This browser does not expose microphone capture.'));
    const raw = Promise.resolve().then(() => devices.getUserMedia(constraints)); flight = raw;
    return new Promise((resolve,reject) => {
      let timedOut = false;
      const timer = setTimeout(() => {timedOut=true;reject(Object.assign(Error('Microphone permission was not answered. Use the browser microphone prompt, then press Record again. No audio was recorded.'),{name:'MicrophonePermissionTimeout'}));},timeoutMs);
      raw.then(stream => {
        flight=null;clearTimeout(timer);
        if(timedOut)stream.getTracks().forEach(track=>track.stop());else resolve(stream);
      },error=>{flight=null;clearTimeout(timer);if(!timedOut)reject(error);});
    });
  }};
}

export function recognizedIntent(mode, text, command) {
  return mode === 'ask' ? { kind: 'ask', text: typeof text === 'string' ? text.trim().slice(0, 3000) : '' } : { kind: 'command', command };
}

export function safeNavigation(value, origin) {
  if (typeof value !== 'string' || value.length > 160 || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return null;
  try {
    const url = new URL(value, origin);
    if (url.origin !== origin || url.username || url.password || url.search || !VOICE_ROUTES.has(url.pathname)) return null;
    if (url.hash && !(url.pathname === '/' && WORKSPACES.has(url.hash.slice(1)))) return null;
    return url.pathname + url.hash;
  } catch { return null; }
}

export function safeTargetAction(target, origin) {
  if (!target || !target.visible || target.inForm || target.disabled) return null;
  if (target.tag === 'A') { const path = safeNavigation(target.href, origin); return path ? { kind: 'navigate', path } : null; }
  if (target.tag === 'BUTTON' && target.type !== 'submit' && SAFE_BUTTONS.has(target.action)) return { kind: 'workspace', action: target.action };
  return null;
}

export function pcm16(chunks, sampleRate, maxSeconds = MAX_SECONDS) {
  if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 192000) throw Error('Unsupported microphone sample rate.');
  const capSeconds = Math.min(MAX_SECONDS, Math.max(0, Number(maxSeconds) || 0));
  const sourceLength = Math.min(chunks.reduce((n, block) => n + block.length, 0), Math.floor(sampleRate * capSeconds));
  const samples = new Float32Array(sourceLength);
  let cursor = 0;
  for (const block of chunks) { const size = Math.min(block.length, sourceLength - cursor); if (size <= 0) break; samples.set(block.subarray(0, size), cursor); cursor += size; }
  const count = Math.floor(sourceLength * 16000 / sampleRate);
  const buffer = new ArrayBuffer(count * 2), view = new DataView(buffer), ratio = sampleRate / 16000;
  for (let i = 0; i < count; i++) {
    const begin = i * ratio, end = Math.min(sourceLength, (i + 1) * ratio);
    let sum = 0, weight = 0;
    for (let j = Math.floor(begin); j < Math.ceil(end); j++) {
      const overlap = Math.min(end, j + 1) - Math.max(begin, j);
      const value = Number.isFinite(samples[j]) ? samples[j] : 0;
      sum += value * overlap; weight += overlap;
    }
    const value = Math.max(-1, Math.min(1, weight ? sum / weight : 0));
    view.setInt16(i * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
  }
  return buffer;
}

export function mountNexenVoice(owner = window) {
  let host = owner;
  try { if (owner.parent !== owner && owner.parent.location.origin === owner.location.origin) host = owner.parent; } catch { /* Standalone or differently hosted iframe. */ }
  if (host.NexenVoice) { owner.NexenVoice = host.NexenVoice; return host.NexenVoice; }
  const doc = host.document;
  const microphoneGate = createMicrophoneGate(host.navigator.mediaDevices);
  const create = (tag, className, text) => { const e = doc.createElement(tag); if (className) e.className = className; if (text !== undefined) e.textContent = text; return e; };
  if (!doc.querySelector('link[data-nexen-voice-style]')) { const css = create('link'); css.rel = 'stylesheet'; css.href = '/world-assets/voice-control.css'; css.dataset.nexenVoiceStyle = 'true'; doc.head.append(css); }
  const container = doc.querySelector('[data-nexen-voice]');
  const panel = create('section', 'nv-panel' + (container ? ' nv-inline' : ' nv-floating'));
  panel.dataset.nexenVoiceRoot = 'true'; panel.setAttribute('aria-label', 'NEXEN app voice controls');
  const heading = create('div', 'nv-heading'), title = create('strong', '', 'NEXEN voice'), scope = create('span', 'nv-scope', 'In-app controls');
  const collapse = create('button', 'nv-collapse', '−'); collapse.type = 'button'; collapse.setAttribute('aria-label', 'Minimize voice controls'); collapse.setAttribute('aria-expanded', 'true');
  heading.append(title, scope, collapse);
  const body = create('div', 'nv-body');
  const modeLabel = create('label', 'nv-mode', 'Mode');
  const modeSelect = create('select'); modeSelect.setAttribute('aria-label', 'Choose command or Ask JARVIS voice mode');
  for (const [value, label] of [['command', 'Command'], ['ask', 'Ask JARVIS']]) { const option = create('option', '', label); option.value = value; modeSelect.append(option); }
  let mode = host.location.pathname === '/problems' ? 'ask' : 'command'; modeSelect.value = mode; modeLabel.append(modeSelect);
  const inputLabel = create('label','nv-mode','Microphone input'), inputSelect=create('select');
  inputSelect.setAttribute('aria-label','Microphone input');
  const defaultInput=create('option','','Windows default input');defaultInput.value='';inputSelect.append(defaultInput);inputLabel.append(inputSelect);
  const audioInfo=create('p','nv-engine','Input is not tested yet. Select the input you use in ChatGPT, then check the level meter while speaking.');
  const inputRefresh=create('button','','Refresh input devices');inputRefresh.type='button';
  let selectedInput='';try{selectedInput=host.localStorage.getItem('nexen.voice.input')||'';}catch{}
  const stateLine = create('div', 'nv-state', 'Checking local voice engine…'); stateLine.setAttribute('role', 'status'); stateLine.setAttribute('aria-live', 'polite');
  const engineLine = create('p', 'nv-engine', 'Microphone off. No Windows mouse control.');
  const meter = create('meter', 'nv-meter'); meter.min = 0; meter.max = 1; meter.value = 0; meter.setAttribute('aria-label', 'Microphone input level');
  const buttons = create('div', 'nv-buttons');
  const record = create('button', 'nv-record', 'Record command'), stop = create('button', 'nv-stop', 'Stop / discard');
  record.type = stop.type = 'button'; record.disabled = true;
  buttons.append(record, stop);
  const transcript = create('p', 'nv-transcript', 'Your recognized command appears here.'); transcript.setAttribute('aria-live', 'polite');
  const feedback = create('p', 'nv-feedback', 'Push to talk. Maximum 20 seconds per command.'); feedback.setAttribute('role', 'status');
  const links = create('div', 'nv-links'); const guide = create('a', '', 'Command guide'); guide.href = '/voice'; const numbersButton = create('button', '', 'Show safe targets'); numbersButton.type = 'button'; links.append(guide, numbersButton);
  body.append(modeLabel, inputLabel, inputRefresh, stateLine, engineLine, audioInfo, meter, buttons, transcript, feedback, links); panel.append(heading, body); (container || doc.body).append(panel);
  const pointer = create('div', 'nv-pointer'); pointer.setAttribute('aria-hidden', 'true'); pointer.hidden = true; doc.body.append(pointer);
  const numberLayer = create('div', 'nv-number-layer'); numberLayer.setAttribute('aria-hidden', 'true'); doc.body.append(numberLayer);
  let state = 'checking', ready = false, epoch = 0, stream = null, context = null, processor = null, source = null, mute = null;
  let jarvisBusy = Boolean(host.NexenProblems?.getState?.().busy);
  let chunks = [], captured = 0, peakSignal=0, timer = null, elapsedTimer = null, requestAbort = null, targets = [], lastPointer = null, minimized = false;

  async function refreshInputs() {
    if(!host.navigator.mediaDevices?.enumerateDevices)return;
    inputRefresh.disabled=true;
    try{
      const devices=(await host.navigator.mediaDevices.enumerateDevices()).filter(x=>x.kind==='audioinput');
      inputSelect.replaceChildren();const option=create('option','','Windows default input');option.value='';inputSelect.append(option);
      for(const [i,device] of devices.entries()){
        if(!device.deviceId || device.deviceId==='default')continue;
        const choice=create('option','',device.label||`Input ${i+1} · name available after permission`);choice.value=device.deviceId;inputSelect.append(choice);
      }
      if(selectedInput && !devices.some(x=>x.deviceId===selectedInput)){
        const saved=create('option','','Previously selected input · confirm it is connected');saved.value=selectedInput;inputSelect.append(saved);
      }
      inputSelect.value=selectedInput;
    }catch{audioInfo.textContent='Input list unavailable. Windows default can still be tested through Record.';}
    finally{inputRefresh.disabled=false;}
  }

  function setState(next, message) {
    state = next; panel.dataset.state = next; stateLine.textContent = message;
    record.textContent = next === 'recording' ? 'Finish & transcribe' : mode === 'ask' ? 'Record question' : 'Record command';
    record.disabled = !ready || (mode === 'ask' && jarvisBusy) || ['checking', 'requesting', 'transcribing', 'interpreting'].includes(next);
    inputSelect.disabled=['requesting','recording','transcribing'].includes(next);
    if (next !== 'recording') meter.value = 0;
  }
  function clearTargets() { targets = []; numberLayer.replaceChildren(); pointer.hidden = true; lastPointer = null; }
  function releaseAudio() {
    host.clearTimeout(timer); host.clearInterval(elapsedTimer); timer = elapsedTimer = null;
    if (processor) { processor.onaudioprocess = null; try { processor.disconnect(); } catch {} }
    for (const n of [source, mute]) try { n?.disconnect(); } catch {}
    stream?.getTracks().forEach(track => track.stop());
    const oldContext = context; context = stream = processor = source = mute = null;
    if (oldContext && oldContext.state !== 'closed') oldContext.close().catch(() => {});
  }
  function cancel(message = 'Stopped. Microphone off.', preserveTargets = false) {
    epoch++; requestAbort?.abort(); requestAbort = null; releaseAudio(); chunks = []; captured = 0; if (!preserveTargets) clearTargets();
    host.dispatchEvent(new host.CustomEvent('nexen:voice-stop'));
    if ((mode === 'ask' || host.location.pathname === '/problems') && 'speechSynthesis' in host) host.speechSynthesis.cancel();
    setState(ready ? 'idle' : 'unavailable', message); feedback.textContent = 'No new command will run. Use Record command or the typed field to continue.';
  }
  async function api(path, body, binary = false) {
    const abort = new AbortController(); requestAbort = abort;
    const timeout = host.setTimeout(() => abort.abort(), body === undefined ? 10000 : binary ? 65000 : 15000);
    try {
      const response = await host.fetch(path, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', signal: abort.signal,
        ...(body === undefined ? {} : { headers: { 'Content-Type': binary ? 'application/octet-stream' : 'application/json', 'X-Nexen-Action': 'launch' }, body: binary ? body : JSON.stringify(body) }) });
      if (response.status === 401 || new URL(response.url).pathname === '/login') throw Error('NEXEN is locked. Sign in again before using voice.');
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw Error(typeof data.detail === 'string' ? data.detail : `Local voice request failed (${response.status}).`);
      return data;
    } finally { host.clearTimeout(timeout); if (requestAbort === abort) requestAbort = null; }
  }
  function visible(element) {
    if (!element?.isConnected || element.closest('[data-nexen-voice-root], [hidden], [inert], [aria-hidden="true"]')) return false;
    const style = host.getComputedStyle(element), rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0 && rect.width > 3 && rect.height > 3 && rect.bottom > 0 && rect.right > 0 && rect.top < host.innerHeight && rect.left < host.innerWidth;
  }
  function classify(element) {
    return safeTargetAction({ tag: element.tagName, href: element.getAttribute('href'), type: element.getAttribute('type'),
      action: element.dataset.action, visible: visible(element), inForm: Boolean(element.closest('form')),
      disabled: Boolean(element.disabled) || element.getAttribute('aria-disabled') === 'true' }, host.location.origin);
  }
  function placeLayers() {
    for (const target of targets) {
      const rect = target.element.getBoundingClientRect(); target.badge.hidden = !visible(target.element);
      target.badge.style.left = `${Math.max(2, Math.min(host.innerWidth - 28, rect.left - 9))}px`;
      target.badge.style.top = `${Math.max(2, Math.min(host.innerHeight - 28, rect.top - 9))}px`;
    }
    if (lastPointer && visible(lastPointer)) { const r = lastPointer.getBoundingClientRect(); pointer.hidden = false; pointer.style.left = `${r.left + r.width / 2}px`; pointer.style.top = `${r.top + r.height / 2}px`; } else pointer.hidden = true;
  }
  function showNumbers() {
    clearTargets(); const dialogs = [...doc.querySelectorAll('dialog[open]')]; const scope = dialogs.at(-1) || doc.body;
    for (const element of scope.querySelectorAll('a[href], button[data-action]')) {
      const action = classify(element); if (!action) continue;
      const number = targets.length + 1, badge = create('span', 'nv-number', String(number)); numberLayer.append(badge);
      targets.push({ number, element, badge, action }); if (number >= 100) break;
    }
    placeLayers(); feedback.textContent = targets.length ? `${targets.length} safe targets numbered. Say “focus 3” or “click 3”.` : 'No safe local navigation targets are visible. Open a workspace by name instead.';
    return targets.length;
  }
  function navigate(path) {
    const safe = safeNavigation(path, host.location.origin);
    if (!safe) { feedback.textContent = 'That route is outside the allowed NEXEN pages.'; return false; }
    cancel('Opening NEXEN page…'); host.location.assign(safe); return true;
  }
  function askJarvis(text) {
    const question = typeof text === 'string' ? text.trim().slice(0, 3000) : '';
    if (!question) { feedback.textContent = 'No question was recognized. Try again or type it.'; return false; }
    if (jarvisBusy) { feedback.textContent = 'JARVIS is still preparing the current response. Your new question remains in the transcript; try it again when the current response is ready.'; return false; }
    if (host.location.pathname === '/problems') {
      feedback.textContent = 'Question sent to the local problem page using its selected photo and model. Watch that page for the draft and read-aloud result.';
      host.dispatchEvent(new host.CustomEvent('nexen:voice-intent', { detail: Object.freeze({ type: 'ask_jarvis', text: question }) }));
      return true;
    }
    try {
      host.sessionStorage.setItem(PENDING_QUESTION_KEY, JSON.stringify({ version: 1, text: question, createdAt: Date.now() }));
      // /problems restores the question without auto-submitting; the user can add a photo first.
      return navigate('/problems');
    } catch {
      feedback.replaceChildren(doc.createTextNode('Your question remains in the transcript. Open the problem page and paste it: '));
      const link = create('a', '', 'Open JARVIS'); link.href = '/problems'; link.target = '_blank'; link.rel = 'noopener'; feedback.append(link);
      return false;
    }
  }
  function execute(command) {
    if (!command || typeof command !== 'object') { feedback.textContent = 'The interpreter returned no usable command.'; return false; }
    if (command.type === 'stop') { cancel(); return true; }
    if (command.type === 'navigate') return navigate(command.path);
    if (command.type === 'automatic_mode' && typeof command.enabled === 'boolean') {
      feedback.textContent = 'Updating Automatic Mode…';
      api('/api/automatic-mode',{enabled:command.enabled}).then(result=>{
        feedback.textContent=result.label+'. '+result.stop_detail;
        if(command.enabled)navigate('/automatic-mode');
      }).catch(error=>{feedback.textContent=error.message;});
      return true;
    }
    if (['complete_current', 'do_current', 'read_current'].includes(command.type)) {
      if (host.location.pathname !== '/next') { feedback.textContent = 'Select a task in Next step first. Say “open next step” or open /next.'; return false; }
      // Selection, confirmation and execution belong to the /next controller.
      // Never infer a task ID from a transcript or from other visible records.
      const intent = Object.freeze({ type: command.type });
      host.dispatchEvent(new host.CustomEvent('nexen:voice-intent', { detail: intent }));
      feedback.textContent = 'Task intent sent to Next step. Its selected-task controls determine what happens; completion is not confirmed here.';
      return true;
    }
    if (command.type === 'show_numbers') { showNumbers(); return true; }
    if (command.type === 'scroll' && ['up', 'down'].includes(command.direction)) {
      const dialogs = [...doc.querySelectorAll('dialog[open]')]; const scrollArea = dialogs.at(-1)?.querySelector('.dialogbody') || dialogs.at(-1) || host;
      scrollArea.scrollBy({ top: (command.direction === 'down' ? 1 : -1) * Math.max(250, host.innerHeight * 0.65), behavior: host.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      feedback.textContent = `Scrolled ${command.direction} inside NEXEN.`; return true;
    }
    if (['focus_target', 'click_target'].includes(command.type)) {
      if (!Number.isInteger(command.number) || command.number < 1 || command.number > 100) { feedback.textContent = 'Choose a visible target number from 1 to 100.'; return false; }
      const target = targets.find(t => t.number === command.number), current = target && classify(target.element);
      if (!target || !current || JSON.stringify(current) !== JSON.stringify(target.action)) { feedback.textContent = 'That numbered target changed or is not visible. Show numbers again.'; return false; }
      lastPointer = target.element; target.element.focus({ preventScroll: true }); placeLayers();
      if (command.type === 'focus_target') { feedback.textContent = `Focused target ${command.number}. This is the NEXEN pointer, not the Windows mouse.`; return true; }
      if (current.kind === 'navigate') return navigate(current.path);
      target.element.click(); feedback.textContent = `Requested safe workspace control ${command.number}.`; clearTargets(); return true;
    }
    feedback.textContent = typeof command.message === 'string' ? command.message.slice(0, 500) : 'That command is not supported. Try “open money”, “scroll down”, or “show numbers”.'; return false;
  }
  async function interpret(text) {
    const clean = typeof text === 'string' ? text.trim().slice(0, 1000) : '';
    if (!clean) { feedback.textContent = 'Enter a short NEXEN command first.'; return false; }
    cancel('Interpreting typed command…', true); const run = ++epoch; setState('interpreting', 'Interpreting typed command locally…'); transcript.textContent = `Typed: ${clean}`;
    if (mode === 'ask') { setState(ready ? 'idle' : 'unavailable', ready ? 'Ready. Microphone off.' : 'Typed questions available. Microphone engine unavailable.'); return askJarvis(clean); }
    try { const data = await api('/api/voice/interpret', { text: clean }); if (run !== epoch) return false; setState(ready ? 'idle' : 'unavailable', ready ? 'Ready. Microphone off.' : 'Typed control ready; microphone engine unavailable.'); return execute(data.command); }
    catch (error) { if (run === epoch) { setState('error', error.name === 'AbortError' ? 'Request stopped or timed out.' : 'Typed command failed.'); feedback.textContent = error.message; } return false; }
  }
  async function finish() {
    if (state !== 'recording') return;
    const run = epoch, rate = context.sampleRate, capturedChunks = chunks; chunks = []; releaseAudio();
    setState('transcribing', 'Transcribing locally. Microphone off.'); feedback.textContent = 'Audio is held in memory for this request; the browser does not save an audio file.';
    try {
      if(peakSignal <= 0.00001)throw Error('No input signal reached NEXEN. Choose another microphone input and check that its level moves while you speak.');
      const pcm = pcm16(capturedChunks, rate); capturedChunks.length = 0;
      if (pcm.byteLength < 3200) throw Error('The recording was too short. Hold a command for a moment, then finish.');
      const data = await api('/api/voice/transcribe', pcm, true);
      if (run !== epoch) return;
      const text = typeof data.text === 'string' ? data.text : '';
      const confidence = Number.isFinite(data.confidence) && data.confidence >= 0 && data.confidence <= 1 ? ` (${Math.round(data.confidence * 100)}% confidence)` : '';
      transcript.textContent = text ? `Heard: ${text}${confidence}` : 'No speech was recognized.';
      setState('idle', 'Ready. Microphone off.');
      if (!text.trim()) { feedback.textContent = 'Try again in a quieter moment, or type the command.'; return; }
      // Display recognition first; only the explicit safe command interpreter can act.
      await new Promise(resolve => host.setTimeout(resolve, 150));
      if (run !== epoch) return;
      const intent = recognizedIntent(mode, text, data.command);
      if (intent.kind === 'ask') askJarvis(intent.text); else execute(intent.command);
    } catch (error) { capturedChunks.length = 0; if (run === epoch) { setState('error', error.name === 'AbortError' ? 'Transcription stopped or timed out.' : 'Could not transcribe this command.'); feedback.textContent = error.message; } }
  }
  async function start() {
    if (!ready || ['requesting', 'transcribing', 'interpreting'].includes(state)) return;
    if (mode === 'ask' && jarvisBusy) { feedback.textContent = 'Wait for the current local response before recording another question.'; return; }
    if (!host.navigator.mediaDevices?.getUserMedia) { setState('error', 'Microphone capture is unavailable in this browser.'); feedback.textContent = 'Use the local app or its private HTTPS address, or type a command.'; return; }
    const run = ++epoch; let ownedStream = null, ownedContext = null; setState('requesting', 'Waiting for microphone permission…');
    try {
      if (mode === 'ask' && 'speechSynthesis' in host) host.speechSynthesis.cancel();
      const obtained = await microphoneGate.request({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl:true, ...(selectedInput?{deviceId:{exact:selectedInput}}:{}) }, video: false }); ownedStream = obtained;
      if (run !== epoch || doc.hidden) { obtained.getTracks().forEach(t => t.stop()); return; }
      const track=obtained.getAudioTracks()[0],settings=track?.getSettings?.()||{};
      audioInfo.textContent=`Input: ${track?.label||'Windows default'} · ${settings.sampleRate||'device-selected'} Hz · echo cancellation ${settings.echoCancellation===undefined?'device-selected':settings.echoCancellation?'on':'off'}.`;
      refreshInputs();
      stream = obtained; const Audio = host.AudioContext || host.webkitAudioContext;
      if (!Audio) throw Error('Local audio processing is unavailable. Use a typed command.');
      context = new Audio(); ownedContext = context; await ownedContext.resume();
      if (run !== epoch || !context) { ownedStream.getTracks().forEach(t => t.stop()); if (ownedContext.state !== 'closed') ownedContext.close().catch(() => {}); return; }
      if (typeof context.createScriptProcessor !== 'function') throw Error('This browser does not support the current local audio capture path. Use a typed command.');
      source = context.createMediaStreamSource(stream); processor = context.createScriptProcessor(2048, 1, 1); mute = context.createGain(); mute.gain.value = 0;
      chunks = []; captured = 0; peakSignal=0; const maxSamples = context.sampleRate * MAX_SECONDS;
      processor.onaudioprocess = event => {
        if (state !== 'recording') return;
        const input = event.inputBuffer.getChannelData(0), remaining = maxSamples - captured;
        if (remaining <= 0) return;
        const copy = input.slice(0, Math.min(input.length, remaining)); chunks.push(copy); captured += copy.length;
        let power = 0; for (let i = 0; i < copy.length; i++){power += copy[i] * copy[i];peakSignal=Math.max(peakSignal,Math.abs(copy[i]));} meter.value = Math.min(1, Math.sqrt(power / Math.max(1, copy.length)) * 5);
      };
      source.connect(processor); processor.connect(mute); mute.connect(context.destination);
      const started = Date.now(); setState('recording', 'Listening · 0 / 20 seconds'); feedback.textContent = 'Speak one command. Finish sends it once; Stop / discard sends nothing.';
      elapsedTimer = host.setInterval(() => { stateLine.textContent = `Listening · ${Math.min(20, Math.floor((Date.now() - started) / 1000))} / 20 seconds`; }, 250);
      timer = host.setTimeout(finish, MAX_SECONDS * 1000);
    } catch (error) {
      if (run === epoch) { releaseAudio(); chunks = []; setState('error', error.name === 'NotAllowedError' ? 'Microphone permission denied.' : 'Microphone could not start.'); feedback.textContent = error.name === 'NotAllowedError' ? 'Allow microphone access when you choose to record, or use the typed-command field.' : error.message; }
      else { ownedStream?.getTracks().forEach(t => t.stop()); if (ownedContext && ownedContext.state !== 'closed') ownedContext.close().catch(() => {}); }
    }
  }
  async function refresh() {
    const run = epoch;
    try { const data = await api('/api/voice/status'); if (run !== epoch || ['recording', 'requesting', 'transcribing', 'interpreting'].includes(state)) return; ready = data.ready === true; engineLine.textContent = `${typeof data.engine === 'string' ? data.engine : 'Local engine'} · In-app pointer only. Windows mouse control is not attached.`; setState(ready ? 'idle' : 'unavailable', ready ? 'Ready. Microphone off.' : 'Local transcription is not ready.'); feedback.textContent = typeof data.detail === 'string' ? data.detail.slice(0, 400) : 'Use a typed command while the local engine is being checked.'; }
    catch (error) { if (run === epoch) { ready = false; setState('unavailable', 'Voice engine status unavailable.'); feedback.textContent = error.message; } }
  }
  record.addEventListener('click', () => state === 'recording' ? finish() : start()); stop.addEventListener('click', () => cancel()); numbersButton.addEventListener('click', showNumbers);
  inputRefresh.addEventListener('click',refreshInputs);
  inputSelect.addEventListener('change',()=>{cancel('Stopped while changing input.');selectedInput=inputSelect.value;try{host.localStorage.setItem('nexen.voice.input',selectedInput);}catch{}audioInfo.textContent='Selected input is not tested yet. Press Record and check the level meter.';});
  modeSelect.addEventListener('change', () => { cancel('Stopped while changing mode.'); mode = modeSelect.value === 'ask' ? 'ask' : 'command'; setState(ready ? 'idle' : 'unavailable', ready ? 'Ready. Microphone off.' : 'Local transcription is not ready.'); feedback.textContent = mode === 'ask' ? 'Questions go to JARVIS with the selected photo/model on the problem page. They are never treated as navigation commands.' : 'Commands use only safe NEXEN navigation, scrolling and numbered targets.'; });
  collapse.addEventListener('click', () => { minimized = !minimized; body.hidden = minimized; collapse.textContent = minimized ? '+' : '−'; collapse.setAttribute('aria-expanded', String(!minimized)); collapse.setAttribute('aria-label', minimized ? 'Expand voice controls' : 'Minimize voice controls'); if (minimized) cancel('Stopped while minimized.'); });
  doc.addEventListener('visibilitychange', () => { if (doc.hidden) cancel('Stopped because the page is hidden.'); });
  host.addEventListener('pagehide', () => cancel('Stopped because the page is leaving.'));
  host.addEventListener('blur', () => { if (state === 'recording') cancel('Stopped because NEXEN lost focus.'); });
  host.addEventListener('scroll', placeLayers, { passive: true, capture: true }); host.addEventListener('resize', placeLayers, { passive: true });
  host.addEventListener('nexen:jarvis-state', event => {
    jarvisBusy = event.detail?.busy === true;
    if (mode === 'ask') { setState(state, stateLine.textContent); if (typeof event.detail?.message === 'string') feedback.textContent = event.detail.message; }
  });
  const apiController = Object.freeze({ element: panel, refresh, interpret, execute, showNumbers, stop: cancel,
    open: () => { minimized = false; body.hidden = false; collapse.textContent = '−'; collapse.setAttribute('aria-expanded', 'true'); panel.scrollIntoView({ block: 'nearest' }); },
    getState: () => ({ state, mode, ready, microphoneActive: Boolean(stream?.active), targetCount: targets.length, desktopControl: false }) });
  host.NexenVoice = apiController; owner.NexenVoice = apiController;
  const typed = doc.querySelector('[data-nexen-voice-form]');
  typed?.addEventListener('submit', async event => { event.preventDefault(); const input = typed.querySelector('input,textarea'), submit = typed.querySelector('[type="submit"]'); if (submit) submit.disabled = true; await interpret(input?.value || ''); if (submit) submit.disabled = false; });
  doc.querySelector('[data-nexen-voice-refresh]')?.addEventListener('click', refresh);
  refresh(); refreshInputs(); return apiController;
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => mountNexenVoice(), { once: true }); else mountNexenVoice();
}

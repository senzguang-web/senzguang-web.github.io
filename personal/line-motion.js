(() => {
  const root = document.querySelector('[data-line-art]');
  const image = root?.querySelector('img[data-line-image]');
  const cosmos = document.querySelector('[data-cosmos]');
  const cosmosImage = cosmos?.querySelector('img[data-cosmos-image]');
  const meteors = document.querySelector('[data-meteors]');
  const button = document.querySelector('[data-motion-toggle]');
  if (!image && !cosmosImage) return;

  const mode = document.body.dataset.ambientMode || 'reading';
  const dynamic = mode === 'home' || mode === 'ambient';
  const heroDynamic = mode === 'home';
  const settings = Object.freeze({
    waveLimit: 6, waveLife: 1.8, waveInterval: 0.14, waveDistance: 24,
    waveSpeed: 85, waveWidth: 16, waveAmplitude: 1.2, flowSpeed: 2 * Math.PI / 16, dprLimit: 1.5,
    cosmosPeriod: 32, cosmosTurnSpeed: 0.012
  });
  const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
  const storageKey = 'guangsen-line-motion-paused-v1';
  let paused = false;
  try { paused = localStorage.getItem(storageKey) === 'true'; } catch { /* Storage is optional. */ }
  let ready = false;
  let failed = false;
  let heroLoaded = false;
  let visible = false;
  let stillHeroFrame = true;
  let cosmosReady = false;
  let cosmosFailed = false;
  let cosmosTime = 0;
  let cosmosValue = '1';
  let cosmosTurn = '0deg';
  let cosmosScale = '1.025';
  let pageHidden = false;
  let printing = false;
  let frame = 0;
  let lastTime = null;
  let elapsed = 0;
  const waves = [];
  const waveData = new Float32Array(settings.waveLimit * 4);
  let lastWaveTime = -Infinity;
  let lastWavePosition = null;
  let waveEmissions = 0;
  let size = [1, 1];
  let canvas, gl, program, texture, buffer, uniforms, resizeObserver, intersectionObserver;
  const meteorStorageKey = 'guangsen-meteor-minute-v1';
  let meteorClockTimer = 0;
  let meteorCleanupTimer = 0;
  let lastMeteorMinute = '';
  let meteorBursts = 0;
  try { lastMeteorMinute = sessionStorage.getItem(meteorStorageKey) || ''; } catch { /* In-memory deduplication still works. */ }
  if (meteors) { meteors.dataset.meteorCount = '0'; meteors.dataset.meteorBursts = '0'; }
  cosmos?.style.setProperty('--cosmos-breath', '1');
  cosmos?.style.setProperty('--cosmos-turn', '0deg');
  cosmos?.style.setProperty('--cosmos-scale', cosmosScale);
  if (root) { root.dataset.rippleCount = '0'; root.dataset.rippleEmissions = '0'; }

  function stop() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    lastTime = null;
    stopMeteors();
  }

  function updateControl() {
    const reduced = preference.matches;
    const state = !dynamic ? 'static' : reduced ? 'reduced' : paused ? 'paused' : 'running';
    if (root) {
      root.dataset.motionReady = String(ready && !failed);
      root.dataset.motionState = failed ? 'fallback' : heroDynamic ? state : 'static';
    }
    if (cosmos) {
      cosmos.dataset.motionReady = String(cosmosReady && !cosmosFailed);
      cosmos.dataset.motionState = cosmosFailed ? 'fallback' : state;
    }
    if (!button) return;
    button.hidden = !hasMotion();
    button.disabled = reduced || !dynamic;
    button.setAttribute('aria-pressed', String(paused || reduced));
    button.textContent = reduced ? '已减少动态' : paused ? '继续动态' : '暂停动态';
  }

  function fail() {
    if (failed) return;
    failed = true;
    canvas?.remove();
    resizeObserver?.disconnect();
    intersectionObserver?.disconnect();
    if (gl) {
      if (buffer) gl.deleteBuffer(buffer);
      if (texture) gl.deleteTexture(texture);
      if (program) gl.deleteProgram(program);
    }
    synchronize();
  }

  function hasMotion() {
    return dynamic && ((cosmosReady && !cosmosFailed) || (heroDynamic && !failed && (ready || (heroLoaded && preference.matches))));
  }

  function allowed() {
    return dynamic && !paused && !preference.matches && !pageHidden && !printing && document.visibilityState !== 'hidden';
  }

  function canRun() {
    return allowed() && ((cosmosReady && !cosmosFailed) || (ready && !failed && visible));
  }

  function clearMeteorTrails() {
    if (meteorCleanupTimer) window.clearTimeout(meteorCleanupTimer);
    meteorCleanupTimer = 0;
    meteors?.replaceChildren();
    if (meteors) meteors.dataset.meteorCount = '0';
  }

  function stopMeteors() {
    if (meteorClockTimer) window.clearTimeout(meteorClockTimer);
    meteorClockTimer = 0;
    clearMeteorTrails();
  }

  function meteorsAllowed() {
    return !!meteors && allowed() && cosmosReady && !cosmosFailed;
  }

  function releaseMeteors() {
    clearMeteorTrails();
    const mobile = window.innerWidth <= 760;
    const count = mobile ? 1 : 1 + Math.floor(Math.random() * 3);
    for (let index = 0; index < count; index++) {
      const trail = document.createElement('i');
      trail.className = 'meteor';
      const right = index % 2 === 0;
      const distance = mobile ? 75 : 125 + Math.random() * 55;
      trail.style.setProperty('--meteor-x', `${right ? 80 + Math.random() * 9 : 12 + Math.random() * 6}vw`);
      trail.style.setProperty('--meteor-y', `${14 + index * 13 + Math.random() * 9}vh`);
      trail.style.setProperty('--meteor-distance', `${distance}px`);
      trail.style.setProperty('--meteor-duration', `${1.8 + Math.random() * 0.6}s`);
      trail.style.setProperty('--meteor-delay', `${index * 1.05}s`);
      meteors.append(trail);
    }
    meteors.dataset.meteorCount = String(count);
    meteors.dataset.meteorBursts = String(++meteorBursts);
    // One short-lived batch, no extra RAF and no accumulated offscreen trails.
    meteorCleanupTimer = window.setTimeout(clearMeteorTrails, 6000);
  }

  function checkMeteorMinute() {
    meteorClockTimer = 0;
    if (!meteorsAllowed()) { stopMeteors(); return; }
    const now = new Date();
    // Device-local HH:mm only: no geolocation, seconds, network or astronomy claim.
    const hour = now.getHours();
    const minute = now.getMinutes();
    const localTime = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    const minuteKey = [now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, now.getTimezoneOffset()].join(':');
    // A page restored from BFCache may have older memory than the next page's
    // session marker. Re-read only this decorative-effect key before emitting.
    let storedMeteorMinute = '';
    try { storedMeteorMinute = sessionStorage.getItem(meteorStorageKey) || ''; } catch { /* Use memory when storage is unavailable. */ }
    if (localTime.includes('7') && lastMeteorMinute !== minuteKey && storedMeteorMinute !== minuteKey) {
      lastMeteorMinute = minuteKey;
      try { sessionStorage.setItem(meteorStorageKey, minuteKey); } catch { /* No persistence is required. */ }
      releaseMeteors();
    }
    // Check once at the next local minute boundary; never replay missed minutes.
    meteorClockTimer = window.setTimeout(checkMeteorMinute, 60000 - now.getSeconds() * 1000 - now.getMilliseconds() + 30);
  }

  function syncMeteors() {
    if (!meteorsAllowed()) stopMeteors();
    else if (!meteorClockTimer) checkMeteorMinute();
  }

  function synchronize() {
    updateControl();
    syncMeteors();
    if (canRun()) {
      if (!frame) frame = requestAnimationFrame(tick);
    } else stop();
  }

  function render() {
    waveData.fill(0);
    waves.forEach((wave, index) => waveData.set([wave.x, wave.y, wave.started, 1], index * 4));
    gl.uniform1f(uniforms.time, elapsed);
    gl.uniform2f(uniforms.size, ...size);
    gl.uniform4fv(uniforms.waves, waveData);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  function expireWaves() {
    const previous = waves.length;
    while (waves.length && elapsed - waves[0].started >= settings.waveLife) waves.shift();
    if (waves.length !== previous) root.dataset.rippleCount = String(waves.length);
  }

  function resizeCosmos() {
    if (!cosmos) return;
    const width = Math.max(1, window.innerWidth);
    const height = Math.max(1, window.innerHeight);
    const angle = parseFloat(cosmosTurn) * Math.PI / 180;
    const cosine = Math.abs(Math.cos(angle));
    const sine = Math.abs(Math.sin(angle));
    const scale = (1.025 * Math.max(cosine + height / width * sine, cosine + width / height * sine)).toFixed(4);
    if (scale !== cosmosScale) { cosmosScale = scale; cosmos.style.setProperty('--cosmos-scale', scale); }
  }

  function tick(now) {
    frame = 0;
    if (!canRun()) { stop(); return; }
    // Restart at the exact saved phase after pause, backgrounding, or leaving view.
    const delta = lastTime === null ? 0 : Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;
    if (cosmosReady && !cosmosFailed) {
      cosmosTime += delta;
      const breath = (0.97 + 0.03 * Math.cos(cosmosTime * 2 * Math.PI / settings.cosmosPeriod)).toFixed(4);
      const turn = `${((cosmosTime * settings.cosmosTurnSpeed) % 360).toFixed(3)}deg`;
      if (breath !== cosmosValue) { cosmosValue = breath; cosmos.style.setProperty('--cosmos-breath', breath); }
      if (turn !== cosmosTurn) {
        cosmosTurn = turn;
        cosmos.style.setProperty('--cosmos-turn', turn);
        resizeCosmos();
      }
    }
    if (ready && !failed && visible) {
      const heroDelta = stillHeroFrame ? 0 : delta;
      stillHeroFrame = false;
      elapsed += heroDelta;
      expireWaves();
      try { render(); } catch { fail(); }
    }
    if (!frame && canRun()) frame = requestAnimationFrame(tick);
  }

  function resize() {
    resizeCosmos();
    if (!ready || failed) return;
    const rect = root.getBoundingClientRect();
    size = [Math.max(1, rect.width), Math.max(1, rect.height)];
    const scale = Math.min(window.devicePixelRatio || 1, settings.dprLimit);
    const width = Math.max(1, Math.round(rect.width * scale));
    const height = Math.max(1, Math.round(rect.height * scale));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      gl.viewport(0, 0, width, height);
    }
    // Paint even when dimensions equal the canvas default, including a saved pause.
    try { render(); } catch { fail(); }
  }

  function checkVisibility() {
    if (!image) { synchronize(); return; }
    const rect = root.getBoundingClientRect();
    setVisible(rect.bottom > 0 && rect.top < window.innerHeight && rect.right > 0 && rect.left < window.innerWidth);
  }

  function setVisible(value) {
    if (value && !visible) stillHeroFrame = true;
    visible = value;
    synchronize();
  }

  function shader(type, source) {
    const result = gl.createShader(type);
    if (!result) throw new Error('Shader unavailable');
    gl.shaderSource(result, source);
    gl.compileShader(result);
    if (!gl.getShaderParameter(result, gl.COMPILE_STATUS)) {
      gl.deleteShader(result);
      throw new Error('Shader compilation failed');
    }
    return result;
  }

  function uploadArtwork() {
    const maximum = Math.min(2048, gl.getParameter(gl.MAX_TEXTURE_SIZE));
    if (!Number.isFinite(maximum) || maximum < 1 || !image.naturalHeight) throw new Error('Texture size unavailable');
    const limit = 2 ** Math.floor(Math.log2(maximum));
    const powerOfTwo = size => Math.min(limit, 2 ** Math.ceil(Math.log2(size)));
    const staging = document.createElement('canvas');
    try {
      staging.width = powerOfTwo(image.naturalWidth);
      staging.height = powerOfTwo(image.naturalHeight);
      const context = staging.getContext('2d');
      if (!context) throw new Error('Artwork resampling unavailable');
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      // Resample the existing artwork; normalized UVs preserve its full composition.
      // POT dimensions enable WebGL 1 mipmaps, capped at ~22 MB including all levels.
      context.drawImage(image, 0, 0, staging.width, staging.height);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, staging);
      gl.generateMipmap(gl.TEXTURE_2D);
    } finally {
      staging.width = 1;
      staging.height = 1;
    }
  }

  function initialize() {
    if (!heroDynamic || preference.matches || !heroLoaded || ready || failed) return;
    try {
      canvas = document.createElement('canvas');
      canvas.dataset.lineCanvas = '';
      canvas.setAttribute('aria-hidden', 'true');
      gl = canvas.getContext('webgl', { alpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: true });
      if (!gl) throw new Error('WebGL unavailable');
      const vertex = shader(gl.VERTEX_SHADER, `
        attribute vec2 position;
        varying vec2 uv;
        void main() { uv = position * 0.5 + 0.5; gl_Position = vec4(position, 0.0, 1.0); }
      `);
      const fragment = shader(gl.FRAGMENT_SHADER, `
        #ifdef GL_FRAGMENT_PRECISION_HIGH
          precision highp float;
        #else
          precision mediump float;
        #endif
        varying vec2 uv;
        uniform sampler2D artwork;
        uniform float time;
        uniform vec2 size;
        uniform vec4 waves[${settings.waveLimit}];
        uniform vec4 ripple;
        uniform float flowSpeed;
        void main() {
          float edge = smoothstep(0.0, 0.09, uv.x) * smoothstep(0.0, 0.09, 1.0 - uv.x)
                     * smoothstep(0.0, 0.09, uv.y) * smoothstep(0.0, 0.09, 1.0 - uv.y);
          vec2 displacement = vec2(0.0);
          for (int i = 0; i < ${settings.waveLimit}; i++) {
            float age = time - waves[i].z;
            if (waves[i].w > 0.0 && age >= 0.0 && age < ripple.w) {
              // CSS-pixel distance makes rings circular at any container aspect ratio.
              vec2 delta = (uv - waves[i].xy) * size;
              float distance = length(delta);
              float band = (distance - age * ripple.y) / ripple.z;
              float envelope = exp(-0.5 * band * band);
              float decay = pow(max(0.0, 1.0 - age / ripple.w), 1.4) * smoothstep(0.0, 0.14, age);
              displacement += delta / max(distance, 0.001) * sin(band * 2.4) * envelope * decay * ripple.x;
            }
          }
          // Smooth saturation caps the combined waves without a hard-edged clamp.
          displacement *= ripple.x / sqrt(ripple.x * ripple.x + dot(displacement, displacement));
          vec4 color = texture2D(artwork, clamp(uv + displacement * edge / size, 0.0, 1.0));
          // A broad silver crest travels up the existing curves once every 16 s.
          // Lower the trailing ink as well as lifting the crest: white source
          // pixels then have headroom to move, without adding shapes or a halo.
          float phase = uv.y * 6.283185 + uv.x * 1.35 - time * flowSpeed;
          float crest = pow(0.5 + 0.5 * cos(phase), 6.0);
          float ink = smoothstep(0.04, 0.18, color.r);
          float gain = 0.56 + 0.95 * crest;
          color.rgb = mix(color.rgb, min(vec3(1.0), color.rgb * gain),
                          ink * smoothstep(0.0, 1.6, time));
          gl_FragColor = color;
        }
      `);
      program = gl.createProgram();
      gl.attachShader(program, vertex);
      gl.attachShader(program, fragment);
      gl.linkProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Shader link failed');
      gl.useProgram(program);
      buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const position = gl.getAttribLocation(program, 'position');
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      uploadArtwork();
      gl.uniform1i(gl.getUniformLocation(program, 'artwork'), 0);
      uniforms = { time: gl.getUniformLocation(program, 'time'), size: gl.getUniformLocation(program, 'size'), waves: gl.getUniformLocation(program, 'waves[0]') };
      gl.uniform4f(gl.getUniformLocation(program, 'ripple'), settings.waveAmplitude, settings.waveSpeed, settings.waveWidth, settings.waveLife);
      gl.uniform1f(gl.getUniformLocation(program, 'flowSpeed'), settings.flowSpeed);
      root.append(canvas);
      ready = true;
      resize();
      if (failed || gl.getError() !== gl.NO_ERROR) throw new Error('Artwork rendering failed');
      canvas.addEventListener('webglcontextlost', fail);
      if ('ResizeObserver' in window) {
        resizeObserver = new ResizeObserver(resize);
        resizeObserver.observe(root);
      }
      if ('IntersectionObserver' in window) {
        intersectionObserver = new IntersectionObserver(entries => {
          setVisible(entries[0].isIntersecting);
        });
        intersectionObserver.observe(root);
      } else {
        window.addEventListener('scroll', checkVisibility, { passive: true });
      }
      checkVisibility();
    } catch { fail(); }
  }

  function addWave(event, entering = false) {
    if (event.pointerType === 'touch' || !allowed() || !ready || failed || !visible) return;
    const rect = root.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, 1 - (event.clientY - rect.top) / rect.height));
    if (elapsed - lastWaveTime < settings.waveInterval) return;
    if (!entering && lastWavePosition && Math.hypot((x - lastWavePosition.x) * rect.width, (y - lastWavePosition.y) * rect.height) < settings.waveDistance) return;
    expireWaves();
    if (waves.length === settings.waveLimit) waves.shift();
    waves.push({ x, y, started: elapsed });
    lastWaveTime = elapsed;
    lastWavePosition = { x, y };
    root.dataset.rippleCount = String(waves.length);
    root.dataset.rippleEmissions = String(++waveEmissions);
  }
  root?.addEventListener('pointerenter', event => addWave(event, true), { passive: true });
  root?.addEventListener('pointermove', event => addWave(event), { passive: true });
  button?.addEventListener('click', () => {
    if (preference.matches || !hasMotion()) return;
    paused = !paused;
    try { localStorage.setItem(storageKey, String(paused)); } catch { /* No persistence is required to pause. */ }
    synchronize();
  });
  function preferenceChanged() {
    initialize();
    synchronize();
  }
  if (preference.addEventListener) preference.addEventListener('change', preferenceChanged);
  else preference.addListener(preferenceChanged);
  document.addEventListener('visibilitychange', synchronize);
  window.addEventListener('resize', () => { resize(); checkVisibility(); }, { passive: true });
  window.addEventListener('pagehide', () => { pageHidden = true; stop(); });
  window.addEventListener('pageshow', () => { pageHidden = false; checkVisibility(); });
  window.addEventListener('beforeprint', () => { printing = true; stop(); });
  window.addEventListener('afterprint', () => { printing = false; resize(); checkVisibility(); });
  window.addEventListener('storage', event => {
    if (event.key !== storageKey) return;
    paused = event.newValue === 'true';
    synchronize();
  });
  function observeImage(asset, loaded, broken) {
    if (!asset) return;
    const accept = () => asset.naturalWidth ? loaded() : broken();
    asset.addEventListener('error', broken, { once: true });
    if (asset.complete) accept();
    else asset.addEventListener('load', accept, { once: true });
  }
  observeImage(cosmosImage, () => {
    cosmosReady = true;
    synchronize();
  }, () => {
    cosmosFailed = true;
    synchronize();
  });
  observeImage(image, () => {
    heroLoaded = true;
    initialize();
    synchronize();
  }, fail);
  updateControl();
})();

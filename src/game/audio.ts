// Procedural Web Audio API sound generator for Feather Quest 3D
class SoundManager {
  private ctx: AudioContext | null = null;
  private isMuted: boolean = false;

  constructor() {
    // Load persisted mute preference if available
    try {
      const saved = localStorage.getItem('feather3d_muted');
      if (saved !== null) {
        this.isMuted = saved === 'true';
      }
    } catch {
      // Ignore storage errors
    }
  }

  private initCtx() {
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioContextClass) {
        this.ctx = new AudioContextClass();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  public toggleMute(): boolean {
    this.isMuted = !this.isMuted;
    try {
      localStorage.setItem('feather3d_muted', String(this.isMuted));
    } catch {
      // Ignore storage errors
    }
    return this.isMuted;
  }

  public getIsMuted(): boolean {
    return this.isMuted;
  }

  public playFlap() {
    if (this.isMuted) return;
    this.initCtx();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    
    // Whoosh filter noise
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(320, now);
    osc.frequency.exponentialRampToValueAtTime(540, now + 0.12);

    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + 0.15);

    // Subtle wind flutter
    const flutterOsc = this.ctx.createOscillator();
    const flutterGain = this.ctx.createGain();
    flutterOsc.type = 'sine';
    flutterOsc.frequency.setValueAtTime(140, now);
    flutterOsc.frequency.linearRampToValueAtTime(80, now + 0.1);
    flutterGain.gain.setValueAtTime(0.08, now);
    flutterGain.gain.linearRampToValueAtTime(0.001, now + 0.1);

    flutterOsc.connect(flutterGain);
    flutterGain.connect(this.ctx.destination);
    flutterOsc.start(now);
    flutterOsc.stop(now + 0.1);
  }

  public playScore() {
    if (this.isMuted) return;
    this.initCtx();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    
    // Beautiful two-tone crystal chime (C6 -> E6 or G6)
    const playChime = (freq: number, start: number, duration: number) => {
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, start);

      gain.gain.setValueAtTime(0.16, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + duration);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(start);
      osc.stop(start + duration);
    };

    playChime(1046.5, now, 0.28);        // C6
    playChime(1318.5, now + 0.08, 0.35); // E6
    playChime(1567.98, now + 0.16, 0.4); // G6
  }

  /**
   * High-voltage, juicy arcade ring collection sound effect.
   * Features:
   * 1. Ascending crystal bell arpeggio with pitch-scaling streak
   * 2. Aerodynamic sonic ring slicing whoosh
   * 3. Warm golden chime resonance with rich shimmer
   * 4. Punchy tactile pop transient
   */
  public playRingCollect(isUncharted: boolean = false, streak: number = 0) {
    if (this.isMuted) return;
    this.initCtx();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    // Semitone pitch step based on streak (up to 7 steps)
    const semitones = Math.min(streak, 7);
    const pitchMul = Math.pow(2, semitones / 12);

    // 1. Tactile Pop Transient (gives the touch physical weight and snap)
    const popOsc = this.ctx.createOscillator();
    const popGain = this.ctx.createGain();
    popOsc.type = 'sine';
    popOsc.frequency.setValueAtTime(280 * pitchMul, now);
    popOsc.frequency.exponentialRampToValueAtTime(75, now + 0.06);
    popGain.gain.setValueAtTime(0.28, now);
    popGain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
    popOsc.connect(popGain);
    popGain.connect(this.ctx.destination);
    popOsc.start(now);
    popOsc.stop(now + 0.08);

    // 2. Aerodynamic Ring Slicing Whoosh (bandpass swept noise)
    const noiseDuration = 0.16;
    const noiseBufferSize = Math.floor(this.ctx.sampleRate * noiseDuration);
    const noiseBuffer = this.ctx.createBuffer(1, noiseBufferSize, this.ctx.sampleRate);
    const noiseData = noiseBuffer.getChannelData(0);
    for (let i = 0; i < noiseBufferSize; i++) {
      noiseData[i] = (Math.random() * 2 - 1) * (1 - i / noiseBufferSize);
    }
    const noiseSource = this.ctx.createBufferSource();
    noiseSource.buffer = noiseBuffer;
    const bandpass = this.ctx.createBiquadFilter();
    bandpass.type = 'bandpass';
    bandpass.frequency.setValueAtTime(700, now);
    bandpass.frequency.exponentialRampToValueAtTime(2600 * pitchMul, now + 0.14);
    bandpass.Q.setValueAtTime(3.5, now);
    const noiseGain = this.ctx.createGain();
    noiseGain.gain.setValueAtTime(0.18, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
    noiseSource.connect(bandpass);
    bandpass.connect(noiseGain);
    noiseGain.connect(this.ctx.destination);
    noiseSource.start(now);
    noiseSource.stop(now + 0.17);

    // 3. Ascending Crystal Chimes (C6 -> E6 -> G6 -> C7)
    const baseFreqs = isUncharted
      ? [1046.5, 1318.51, 1567.98, 2093.0, 2637.0] // Pentatonic high sparkle
      : [1046.5, 1318.51, 1567.98, 2093.0];
    baseFreqs.forEach((freq, i) => {
      if (!this.ctx) return;
      const startTime = now + i * 0.038;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq * pitchMul, startTime);
      gain.gain.setValueAtTime(0.18, startTime);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.35);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(startTime);
      osc.stop(startTime + 0.38);
    });

    // 4. Shimmering Golden Bell Resonance (High overtone chime)
    const bellOsc = this.ctx.createOscillator();
    const bellGain = this.ctx.createGain();
    bellOsc.type = 'triangle';
    bellOsc.frequency.setValueAtTime(2637.0 * pitchMul, now + 0.05);
    bellGain.gain.setValueAtTime(0.12, now + 0.05);
    bellGain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
    bellOsc.connect(bellGain);
    bellGain.connect(this.ctx.destination);
    bellOsc.start(now + 0.05);
    bellOsc.stop(now + 0.48);
  }

  public playHit() {
    if (this.isMuted) return;
    this.initCtx();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;

    // Heavy low thump
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(180, now);
    osc.frequency.exponentialRampToValueAtTime(35, now + 0.22);

    gain.gain.setValueAtTime(0.35, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + 0.26);

    // Crunch noise
    const bufferSize = this.ctx.sampleRate * 0.12;
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }

    const whiteNoise = this.ctx.createBufferSource();
    whiteNoise.buffer = noiseBuffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(900, now);
    filter.frequency.exponentialRampToValueAtTime(120, now + 0.12);

    const noiseGain = this.ctx.createGain();
    noiseGain.gain.setValueAtTime(0.2, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

    whiteNoise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(this.ctx.destination);

    whiteNoise.start(now);
    whiteNoise.stop(now + 0.13);
  }

  public playHighScore() {
    if (this.isMuted) return;
    this.initCtx();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
    notes.forEach((freq, idx) => {
      const osc = this.ctx!.createOscillator();
      const gain = this.ctx!.createGain();
      const startTime = now + idx * 0.09;
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, startTime);
      gain.gain.setValueAtTime(0.2, startTime);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.3);
      osc.connect(gain);
      gain.connect(this.ctx!.destination);
      osc.start(startTime);
      osc.stop(startTime + 0.32);
    });
  }

  public playWindGust(direction: 'LEFT' | 'RIGHT') {
    if (this.isMuted) return;
    this.initCtx();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const duration = 0.55;

    // Stereo panner if supported, else destination
    let destNode: AudioNode = this.ctx.destination;
    if (this.ctx.createStereoPanner) {
      const panner = this.ctx.createStereoPanner();
      const panTarget = direction === 'RIGHT' ? 0.65 : -0.65;
      panner.pan.setValueAtTime(0, now);
      panner.pan.linearRampToValueAtTime(panTarget, now + duration * 0.7);
      panner.connect(this.ctx.destination);
      destNode = panner;
    }

    // 1. Gust Noise Whoosh
    const bufferSize = Math.floor(this.ctx.sampleRate * duration);
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }

    const noiseSource = this.ctx.createBufferSource();
    noiseSource.buffer = noiseBuffer;

    const bpf = this.ctx.createBiquadFilter();
    bpf.type = 'bandpass';
    bpf.Q.setValueAtTime(2.5, now);
    bpf.frequency.setValueAtTime(direction === 'RIGHT' ? 450 : 380, now);
    bpf.frequency.exponentialRampToValueAtTime(direction === 'RIGHT' ? 1400 : 950, now + duration * 0.6);
    bpf.frequency.exponentialRampToValueAtTime(220, now + duration);

    const noiseGain = this.ctx.createGain();
    noiseGain.gain.setValueAtTime(0.001, now);
    noiseGain.gain.linearRampToValueAtTime(0.35, now + duration * 0.35);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    noiseSource.connect(bpf);
    bpf.connect(noiseGain);
    noiseGain.connect(destNode);

    noiseSource.start(now);
    noiseSource.stop(now + duration);

    // 2. Resonant Ethereal Breeze Chord
    const freqs = direction === 'RIGHT' ? [659.25, 987.77] : [587.33, 880.0];
    freqs.forEach((f) => {
      const osc = this.ctx!.createOscillator();
      const gain = this.ctx!.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, now);
      osc.frequency.exponentialRampToValueAtTime(f * 1.2, now + duration);

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.08, now + duration * 0.3);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

      osc.connect(gain);
      gain.connect(destNode);
      osc.start(now);
      osc.stop(now + duration);
    });
  }

  /**
   * Tension ping as player approaches the record horizon (within 60m)
   * Higher tension (0 to 1) increases pitch and resonance
   */
  public playRecordApproach(tensionRatio: number) {
    if (this.isMuted) return;
    this.initCtx();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    // Rises from 480Hz up to 920Hz as tension peaks
    const freq = 480 + tensionRatio * 440;
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now);
    osc.frequency.exponentialRampToValueAtTime(freq * 1.08, now + 0.18);

    const volume = 0.08 + tensionRatio * 0.12;
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(volume, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);

    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.24);
  }

  /**
   * Massive sonic boom & triumphant celestial fanfare when piercing the record horizon
   */
  public playRecordBreakthrough() {
    if (this.isMuted) return;
    this.initCtx();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;

    // 1. Heavy Sub-bass boom drop (130Hz -> 28Hz)
    const subOsc = this.ctx.createOscillator();
    const subGain = this.ctx.createGain();
    subOsc.type = 'sine';
    subOsc.frequency.setValueAtTime(130, now);
    subOsc.frequency.exponentialRampToValueAtTime(28, now + 0.85);

    subGain.gain.setValueAtTime(0.55, now);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.9);

    subOsc.connect(subGain);
    subGain.connect(this.ctx.destination);
    subOsc.start(now);
    subOsc.stop(now + 0.95);

    // 2. Sonic boom whoosh (White noise bandpass sweep 2400Hz -> 180Hz)
    const duration = 0.7;
    const bufferSize = Math.floor(this.ctx.sampleRate * duration);
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }
    const noiseSource = this.ctx.createBufferSource();
    noiseSource.buffer = noiseBuffer;

    const bpf = this.ctx.createBiquadFilter();
    bpf.type = 'bandpass';
    bpf.Q.setValueAtTime(3.2, now);
    bpf.frequency.setValueAtTime(2400, now);
    bpf.frequency.exponentialRampToValueAtTime(180, now + duration);

    const noiseGain = this.ctx.createGain();
    noiseGain.gain.setValueAtTime(0.4, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    noiseSource.connect(bpf);
    bpf.connect(noiseGain);
    noiseGain.connect(this.ctx.destination);
    noiseSource.start(now);
    noiseSource.stop(now + duration);

    // 3. Triumphant 5-note crystalline major fanfare arpeggio (C5 -> E5 -> G5 -> C6 -> E6)
    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5];
    notes.forEach((f, idx) => {
      const osc = this.ctx!.createOscillator();
      const gain = this.ctx!.createGain();
      const startTime = now + 0.06 + idx * 0.08;
      const noteLen = 0.45;

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(f, startTime);

      gain.gain.setValueAtTime(0.24, startTime);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + noteLen);

      osc.connect(gain);
      gain.connect(this.ctx!.destination);
      osc.start(startTime);
      osc.stop(startTime + noteLen + 0.02);
    });
  }

  /**
   * Milestone reward chime every 50m flown in uncharted territory
   */
  public playUnchartedMilestone() {
    if (this.isMuted) return;
    this.initCtx();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const notes = [1318.5, 1567.98, 2093.0]; // E6, G6, C7
    notes.forEach((f, idx) => {
      const osc = this.ctx!.createOscillator();
      const gain = this.ctx!.createGain();
      const startTime = now + idx * 0.07;
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, startTime);
      gain.gain.setValueAtTime(0.2, startTime);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.4);
      osc.connect(gain);
      gain.connect(this.ctx!.destination);
      osc.start(startTime);
      osc.stop(startTime + 0.42);
    });
  }

  /**
   * Crystalline glass barrier shattering sound when breaking through the record barrier
   */
  public playGlassBreak() {
    if (this.isMuted) return;
    this.initCtx();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;

    // 1. Sharp initial resonant glass snap / crack
    const snapOsc = this.ctx.createOscillator();
    const snapGain = this.ctx.createGain();
    snapOsc.type = 'sawtooth';
    snapOsc.frequency.setValueAtTime(3200, now);
    snapOsc.frequency.exponentialRampToValueAtTime(380, now + 0.08);

    snapGain.gain.setValueAtTime(0.35, now);
    snapGain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);

    snapOsc.connect(snapGain);
    snapGain.connect(this.ctx.destination);
    snapOsc.start(now);
    snapOsc.stop(now + 0.12);

    // 2. High frequency crystalline glass tinkle shards (burst of staggered high bell sines)
    const glassFreqs = [2400, 3100, 3850, 4600, 5200, 2750];
    glassFreqs.forEach((freq, i) => {
      const osc = this.ctx!.createOscillator();
      const gain = this.ctx!.createGain();
      const st = now + 0.02 + i * 0.035;
      const dur = 0.35 + Math.random() * 0.2;

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq + (Math.random() - 0.5) * 200, st);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.7, st + dur);

      gain.gain.setValueAtTime(0.12, st);
      gain.gain.exponentialRampToValueAtTime(0.001, st + dur);

      osc.connect(gain);
      gain.connect(this.ctx!.destination);
      osc.start(st);
      osc.stop(st + dur);
    });

    // 3. Shimmering noise whoosh of shattering fragments
    const noiseLen = 0.45;
    const bufSize = Math.floor(this.ctx.sampleRate * noiseLen);
    const noiseBuf = this.ctx.createBuffer(1, bufSize, this.ctx.sampleRate);
    const output = noiseBuf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }
    const noise = this.ctx.createBufferSource();
    noise.buffer = noiseBuf;

    const hpf = this.ctx.createBiquadFilter();
    hpf.type = 'highpass';
    hpf.frequency.setValueAtTime(3000, now);
    hpf.frequency.linearRampToValueAtTime(1200, now + noiseLen);

    const noiseGain = this.ctx.createGain();
    noiseGain.gain.setValueAtTime(0.22, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + noiseLen);

    noise.connect(hpf);
    hpf.connect(noiseGain);
    noiseGain.connect(this.ctx.destination);
    noise.start(now);
    noise.stop(now + noiseLen);
  }

  /**
   * Sound effect when collecting a Speed Totem
   */
  public playTotemSpeed() {
    if (this.isMuted) return;
    this.initCtx();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;

    // Ascending supersonic aerodynamic sweep
    const sweep = this.ctx.createOscillator();
    const sweepGain = this.ctx.createGain();
    sweep.type = 'sine';
    sweep.frequency.setValueAtTime(380, now);
    sweep.frequency.exponentialRampToValueAtTime(1450, now + 0.3);

    sweepGain.gain.setValueAtTime(0.2, now);
    sweepGain.gain.exponentialRampToValueAtTime(0.001, now + 0.32);

    sweep.connect(sweepGain);
    sweepGain.connect(this.ctx.destination);
    sweep.start(now);
    sweep.stop(now + 0.35);

    // High velocity wind chime
    [880, 1174, 1480, 1760].forEach((freq, idx) => {
      const osc = this.ctx!.createOscillator();
      const gain = this.ctx!.createGain();
      const st = now + 0.05 + idx * 0.05;

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, st);

      gain.gain.setValueAtTime(0.18, st);
      gain.gain.exponentialRampToValueAtTime(0.001, st + 0.28);

      osc.connect(gain);
      gain.connect(this.ctx!.destination);
      osc.start(st);
      osc.stop(st + 0.3);
    });
  }

  /**
   * Sound effect when collecting an Immunity Totem
   */
  public playTotemImmunity() {
    if (this.isMuted) return;
    this.initCtx();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;

    // Deep resonant protective gong harmonic (180Hz warm fundamental)
    const gong = this.ctx.createOscillator();
    const gongGain = this.ctx.createGain();
    gong.type = 'triangle';
    gong.frequency.setValueAtTime(220, now);
    gong.frequency.exponentialRampToValueAtTime(110, now + 0.6);

    gongGain.gain.setValueAtTime(0.3, now);
    gongGain.gain.exponentialRampToValueAtTime(0.001, now + 0.65);

    gong.connect(gongGain);
    gongGain.connect(this.ctx.destination);
    gong.start(now);
    gong.stop(now + 0.7);

    // Sacred aegis bell chime (Golden triad: E5 -> G#5 -> B5 -> E6)
    [659.25, 830.61, 987.77, 1318.5].forEach((freq, idx) => {
      const osc = this.ctx!.createOscillator();
      const gain = this.ctx!.createGain();
      const st = now + 0.04 + idx * 0.06;

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, st);

      gain.gain.setValueAtTime(0.2, st);
      gain.gain.exponentialRampToValueAtTime(0.001, st + 0.45);

      osc.connect(gain);
      gain.connect(this.ctx!.destination);
      osc.start(st);
      osc.stop(st + 0.5);
    });
  }

  /**
   * Sound effect when the immunity aegis deflects an obstacle impact
   */
  public playShieldDeflect() {
    if (this.isMuted) return;
    this.initCtx();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;

    // Energetic metallic clang
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(840, now);
    osc.frequency.exponentialRampToValueAtTime(220, now + 0.22);

    gain.gain.setValueAtTime(0.28, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.26);

    // High frequency electric shimmer
    const shimmer = this.ctx.createOscillator();
    const shimmerGain = this.ctx.createGain();
    shimmer.type = 'sine';
    shimmer.frequency.setValueAtTime(1800, now);
    shimmer.frequency.exponentialRampToValueAtTime(2600, now + 0.15);

    shimmerGain.gain.setValueAtTime(0.15, now);
    shimmerGain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

    shimmer.connect(shimmerGain);
    shimmerGain.connect(this.ctx.destination);
    shimmer.start(now);
    shimmer.stop(now + 0.22);
  }

  /**
   * Gilded score chime for rings passed in uncharted airspace
   */
  public playUnchartedScore() {
    if (this.isMuted) return;
    this.initCtx();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    // Radiant crystalline chord
    const freqs = [1046.5, 1318.5, 1567.98, 2093.0]; // C6, E6, G6, C7
    freqs.forEach((f, idx) => {
      const osc = this.ctx!.createOscillator();
      const gain = this.ctx!.createGain();
      const startTime = now + idx * 0.04;
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, startTime);
      gain.gain.setValueAtTime(0.14, startTime);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.38);
      osc.connect(gain);
      gain.connect(this.ctx!.destination);
      osc.start(startTime);
      osc.stop(startTime + 0.4);
    });
  }
}

export const soundManager = new SoundManager();

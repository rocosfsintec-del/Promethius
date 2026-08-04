// Lightweight WAV capture utilities (no external deps).

function encodeWav(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, samples.length * 2, true);
  let off = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    off += 2;
  }
  return new Blob([view], { type: "audio/wav" });
}

// A rolling recorder that always holds the last `seconds` of audio.
export function createRollingRecorder(stream, ctx, seconds = 5) {
  const source = ctx.createMediaStreamSource(stream);
  const processor = ctx.createScriptProcessor(4096, 1, 1);
  const mute = ctx.createGain();
  mute.gain.value = 0;
  const sr = ctx.sampleRate;
  const maxLen = Math.floor(sr * seconds);
  let chunks = [];
  let total = 0;
  processor.onaudioprocess = (e) => {
    const input = e.inputBuffer.getChannelData(0);
    chunks.push(new Float32Array(input));
    total += input.length;
    while (total - chunks[0].length > maxLen) {
      total -= chunks[0].length;
      chunks.shift();
    }
  };
  source.connect(processor);
  processor.connect(mute);
  mute.connect(ctx.destination);
  return {
    snapshot() {
      const merged = new Float32Array(total);
      let off = 0;
      for (const c of chunks) { merged.set(c, off); off += c.length; }
      return encodeWav(merged, sr);
    },
    stop() {
      try { processor.disconnect(); source.disconnect(); mute.disconnect(); } catch (e) {}
    },
  };
}

// Record a fixed-length WAV clip (used for enrollment).
export function recordWavOnce(stream, ctx, seconds = 6) {
  return new Promise((resolve) => {
    const source = ctx.createMediaStreamSource(stream);
    const processor = ctx.createScriptProcessor(4096, 1, 1);
    const mute = ctx.createGain();
    mute.gain.value = 0;
    const sr = ctx.sampleRate;
    const chunks = [];
    let total = 0;
    const limit = sr * seconds;
    processor.onaudioprocess = (e) => {
      const input = e.inputBuffer.getChannelData(0);
      chunks.push(new Float32Array(input));
      total += input.length;
      if (total >= limit) finish();
    };
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      try { processor.disconnect(); source.disconnect(); mute.disconnect(); } catch (e) {}
      const merged = new Float32Array(total);
      let off = 0;
      for (const c of chunks) { merged.set(c, off); off += c.length; }
      resolve(encodeWav(merged, sr));
    };
    source.connect(processor);
    processor.connect(mute);
    mute.connect(ctx.destination);
    setTimeout(finish, seconds * 1000 + 400);
  });
}

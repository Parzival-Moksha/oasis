// The microphone, cut into 100 ms pieces of 16 kHz 16-bit mono for the live dictation (ears.js sends them on).
// Runs on the audio thread. If the browser didn't give a 16 kHz context, it averages the samples down to 16 kHz
// (averaging is also the filter that keeps high tones from folding into the speech band).
class EarsCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.step = sampleRate / 16000; // input samples per output sample
    this.acc = 0;
    this.accN = 0;
    this.pos = 0;
    this.out = new Int16Array(1600);
    this.n = 0;
    this.peak = 0;
    this.port.onmessage = (e) => e.data === "flush" && this.send(true);
  }

  push(x) {
    const v = x > 1 ? 1 : x < -1 ? -1 : x;
    this.out[this.n++] = v < 0 ? v * 0x8000 : v * 0x7fff;
    const a = v < 0 ? -v : v;
    if (a > this.peak) this.peak = a;
    if (this.n === this.out.length) this.send(false);
  }

  send(last) {
    const pcm = this.out.slice(0, this.n).buffer;
    this.port.postMessage({ pcm, level: this.peak, last }, [pcm]);
    this.n = 0;
    this.peak = 0;
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    if (this.step === 1) {
      for (let i = 0; i < ch.length; i++) this.push(ch[i]);
      return true;
    }
    for (let i = 0; i < ch.length; i++) {
      this.acc += ch[i];
      this.accN++;
      this.pos += 1;
      if (this.pos >= this.step) {
        this.pos -= this.step;
        this.push(this.acc / this.accN);
        this.acc = 0;
        this.accN = 0;
      }
    }
    return true;
  }
}

registerProcessor("ears-capture", EarsCapture);

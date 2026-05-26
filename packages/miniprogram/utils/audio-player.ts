// utils/audio-player.ts
// Audio player using WebAudioContext

class AudioPlayer {
  private audioContext: AudioContext | null = null;
  private audioQueue: ArrayBuffer[] = [];
  private isPlaying = false;
  private currentSource: AudioBufferSourceNode | null = null;

  constructor() {
    // Initialize AudioContext on user interaction
    wx.onAudioInterruptionEnd(() => {
      if (this.audioContext) {
        this.audioContext.resume();
      }
    });
  }

  private initAudioContext() {
    if (!this.audioContext) {
      this.audioContext = wx.createInnerAudioContext();
      this.audioContext.autoplay = false;
      this.audioContext.onEnded(() => {
        this.playNext();
      });
      this.audioContext.onError((err) => {
        console.error('Audio player error:', err);
        this.isPlaying = false;
        this.playNext();
      });
    }
  }

  play(chunk: ArrayBuffer) {
    this.initAudioContext();
    this.audioQueue.push(chunk);
    if (!this.isPlaying) {
      this.playNext();
    }
  }

  private playNext() {
    if (!this.audioContext || this.audioQueue.length === 0) {
      this.isPlaying = false;
      return;
    }

    this.isPlaying = true;
    const chunk = this.audioQueue.shift()!;
    const base64 = wx.arrayBufferToBase64(chunk);
    const audioUrl = `data:audio/mp3;base64,${base64}`;

    this.audioContext.src = audioUrl;
    this.audioContext.play();
  }

  stop() {
    if (this.audioContext) {
      this.audioContext.stop();
    }
    this.audioQueue = [];
    this.isPlaying = false;
  }

  isPlaying() {
    return this.isPlaying;
  }
}

export const audioPlayer = new AudioPlayer();
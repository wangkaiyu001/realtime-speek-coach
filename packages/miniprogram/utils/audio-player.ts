// utils/audio-player.ts
// Audio player using WeChat InnerAudioContext

class AudioPlayer {
  private audioContext: WechatMiniprogram.InnerAudioContext | null = null;
  private audioQueue: ArrayBuffer[] = [];
  private playing = false;

  constructor() {
    wx.onAudioInterruptionEnd(() => {
      if (this.playing && this.audioContext) {
        this.audioContext.play();
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
        this.playing = false;
        this.playNext();
      });
    }
  }

  play(chunk: ArrayBuffer) {
    this.initAudioContext();
    this.audioQueue.push(chunk);
    if (!this.playing) {
      this.playNext();
    }
  }

  private playNext() {
    if (!this.audioContext || this.audioQueue.length === 0) {
      this.playing = false;
      return;
    }

    this.playing = true;
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
    this.playing = false;
  }

  getIsPlaying(): boolean {
    return this.playing;
  }
}

export const audioPlayer = new AudioPlayer();

// utils/recorder.ts
// Recorder wrapper using RecorderManager

class Recorder {
  private recorderManager: WechatMiniprogram.RecorderManager | null = null;
  private onFrameCallback: ((data: ArrayBuffer) => void) | null = null;
  private recording = false;

  constructor() {
    this.recorderManager = wx.getRecorderManager();
    this.recorderManager.onFrameRecorded((res) => {
      if (this.onFrameCallback && res.frameBuffer) {
        this.onFrameCallback(res.frameBuffer);
      }
    });

    this.recorderManager.onStop(() => {
      this.recording = false;
    });

    this.recorderManager.onError((err) => {
      console.error('Recorder error:', err);
      this.recording = false;
    });
  }

  start(onFrame: (data: ArrayBuffer) => void) {
    if (this.recording) return;

    this.onFrameCallback = onFrame;
    this.recording = true;
    this.recorderManager?.start({
      duration: 60000,
      sampleRate: 16000,
      numberOfChannels: 1,
      encodeBitRate: 96000,
      format: 'PCM',
      frameSize: 1600,
    });
  }

  stop() {
    if (!this.recording) return;

    this.recorderManager?.stop();
    this.recording = false;
    this.onFrameCallback = null;
  }

  getIsRecording(): boolean {
    return this.recording;
  }
}

export const recorder = new Recorder();

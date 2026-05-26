// utils/recorder.ts
// Recorder wrapper using RecorderManager

class Recorder {
  private recorderManager: WechatMiniprogram.RecorderManager | null = null;
  private onFrameCallback: ((data: ArrayBuffer) => void) | null = null;
  private isRecording = false;

  constructor() {
    this.recorderManager = wx.getRecorderManager();
    this.recorderManager.onFrameRecorded((res) => {
      if (this.onFrameCallback && res.frameBuffer) {
        this.onFrameCallback(res.frameBuffer);
      }
    });

    this.recorderManager.onStop(() => {
      this.isRecording = false;
    });

    this.recorderManager.onError((err) => {
      console.error('Recorder error:', err);
      this.isRecording = false;
    });
  }

  start(onFrame: (data: ArrayBuffer) => void) {
    if (this.isRecording) return;

    this.onFrameCallback = onFrame;
    this.isRecording = true;
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
    if (!this.isRecording) return;

    this.recorderManager?.stop();
    this.isRecording = false;
    this.onFrameCallback = null;
  }

  isRecording() {
    return this.isRecording;
  }
}

export const recorder = new Recorder();
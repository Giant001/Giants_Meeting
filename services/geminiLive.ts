import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { createPcmBlob, decodeAudioData, base64ToUint8Array, blobToBase64 } from '../utils/audioUtils';
import { TranscriptionItem } from '../types';

export interface LiveConnectionCallbacks {
  onOpen: () => void;
  onClose: () => void;
  onError: (error: Error) => void;
  onAudioData: (buffer: AudioBuffer) => void;
  onTranscription: (item: TranscriptionItem) => void;
}

export class GeminiLiveClient {
  private ai: GoogleGenAI;
  private sessionPromise: Promise<any> | null = null;
  private inputAudioContext: AudioContext | null = null;
  private outputAudioContext: AudioContext | null = null;
  private outputGainNode: GainNode | null = null;
  private inputSource: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private audioStreamDestination: MediaStreamAudioDestinationNode | null = null;
  private nextStartTime: number = 0;
  private isActive: boolean = false;
  private videoInterval: number | null = null;
  private connectionTimeoutId: number | null = null;

  // Transcription state
  private currentInputTranscription = '';
  private currentOutputTranscription = '';

  constructor(apiKey: string) {
    this.ai = new GoogleGenAI({ apiKey });
  }

  public async connect(callbacks: LiveConnectionCallbacks) {
    if (this.isActive) return;

    try {
      this.inputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      this.outputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      
      // Critical: Resume contexts immediately as this is triggered by a user action
      if (this.inputAudioContext.state === 'suspended') await this.inputAudioContext.resume();
      if (this.outputAudioContext.state === 'suspended') await this.outputAudioContext.resume();

      // Create GainNode for output volume control (Mute All feature)
      this.outputGainNode = this.outputAudioContext.createGain();
      this.outputGainNode.gain.value = 1; // Default to full volume
      this.outputGainNode.connect(this.outputAudioContext.destination);

      // Create a destination to capture audio output for recording
      this.audioStreamDestination = this.outputAudioContext.createMediaStreamDestination();
      // Connect gain node to recording destination too, so recording respects mute? 
      // Actually usually recording should capture raw, but "Mute All" usually implies user perception.
      // Let's keep recording connected to the source in handleMessage, or connect GainNode to it.
      // For now, let's keep recording raw output (unmuted) or muted depending on preference.
      // Connecting gain to destination controls what user hears.

      // Use existing permissions or request new ones
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      this.isActive = true;

      // Set a timeout to prevent hanging forever if the websocket doesn't connect
      const timeoutPromise = new Promise((_, reject) => {
        this.connectionTimeoutId = window.setTimeout(() => {
          reject(new Error("Connection timed out. Check your network or API Key."));
        }, 15000); // 15s timeout
      });

      const connectionPromise = this.ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } },
          },
          systemInstruction: "You are a helpful, professional, and friendly AI participant in a video meeting. Your name is Gemini. You can see the user via their camera and hear them. Respond concisely and naturally.",
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        },
        callbacks: {
          onopen: () => {
            console.log('Gemini Live Connection Opened');
            if (this.connectionTimeoutId) clearTimeout(this.connectionTimeoutId);
            this.setupAudioInput(stream);
            callbacks.onOpen();
          },
          onmessage: async (message: LiveServerMessage) => {
            this.handleMessage(message, callbacks);
          },
          onclose: () => {
            console.log('Gemini Live Connection Closed');
            this.cleanup();
            callbacks.onClose();
          },
          onerror: (err) => {
            console.error('Gemini Live Error', err);
            this.cleanup();
            callbacks.onError(new Error(err.message || 'Connection failed'));
          }
        }
      });

      this.sessionPromise = Promise.race([connectionPromise, timeoutPromise]) as Promise<any>;
      
      this.sessionPromise.catch((err) => {
          console.error("Session connection failed:", err);
          this.cleanup();
          callbacks.onError(err);
      });

    } catch (error) {
      console.error('Connection failed', error);
      this.cleanup();
      callbacks.onError(error as Error);
    }
  }

  public getRemoteAudioStream(): MediaStream | null {
    return this.audioStreamDestination?.stream || null;
  }

  public setVolume(volume: number) {
    if (this.outputGainNode && this.outputAudioContext) {
        // Smooth transition
        this.outputGainNode.gain.setTargetAtTime(volume, this.outputAudioContext.currentTime, 0.05);
    }
  }

  public sendTextMessage(text: string) {
      if (this.isActive && this.sessionPromise) {
          this.sessionPromise.then(session => {
              // Construct a client content message for text input
              // Note: The specific method might vary based on SDK version, 
              // but typically client_content can be sent via send() or similar.
              if (session.send) {
                  session.send({ 
                      clientContent: { 
                          turns: [{ role: 'user', parts: [{ text }] }],
                          turnComplete: true 
                      } 
                  });
              } else {
                  console.warn("Session does not support text sending");
              }
          }).catch(e => console.error("Failed to send text", e));
      }
  }

  private setupAudioInput(stream: MediaStream) {
    if (!this.inputAudioContext) return;
    
    this.inputSource = this.inputAudioContext.createMediaStreamSource(stream);
    this.processor = this.inputAudioContext.createScriptProcessor(4096, 1, 1);
    
    this.processor.onaudioprocess = (e) => {
      if (!this.isActive || !this.sessionPromise) return;
      
      const inputData = e.inputBuffer.getChannelData(0);
      const pcmBlob = createPcmBlob(inputData);
      
      this.sessionPromise.then(session => {
        if (session && session.sendRealtimeInput) {
             session.sendRealtimeInput({ media: pcmBlob });
        }
      }).catch(err => {
          if (this.isActive) console.error("Error sending audio", err);
      });
    };

    this.inputSource.connect(this.processor);
    this.processor.connect(this.inputAudioContext.destination);
  }

  private async handleMessage(message: LiveServerMessage, callbacks: LiveConnectionCallbacks) {
    // Handle Audio
    const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
    if (base64Audio && this.outputAudioContext && this.outputGainNode) {
      try {
        const uint8Array = base64ToUint8Array(base64Audio);
        const audioBuffer = await decodeAudioData(uint8Array, this.outputAudioContext);
        
        this.nextStartTime = Math.max(this.nextStartTime, this.outputAudioContext.currentTime);
        
        callbacks.onAudioData(audioBuffer); 
        
        const source = this.outputAudioContext.createBufferSource();
        source.buffer = audioBuffer;
        
        // Connect to GainNode (for Volume/Mute) instead of direct destination
        source.connect(this.outputGainNode);
        
        // Also connect to recording destination (raw audio)
        // If we want recording to be muted when user mutes, we connect gain node to recorder.
        // Usually, recording should capture sound even if muted locally.
        if (this.audioStreamDestination) {
            source.connect(this.audioStreamDestination);
        }

        source.start(this.nextStartTime);
        this.nextStartTime += audioBuffer.duration;
      } catch (err) {
        console.error("Error decoding audio", err);
      }
    }

    // Handle Transcription
    if (message.serverContent?.outputTranscription) {
      const text = message.serverContent.outputTranscription.text;
      this.currentOutputTranscription += text;
    } else if (message.serverContent?.inputTranscription) {
      const text = message.serverContent.inputTranscription.text;
      this.currentInputTranscription += text;
    }

    if (message.serverContent?.turnComplete) {
      if (this.currentInputTranscription.trim()) {
        callbacks.onTranscription({
          id: Date.now().toString() + '-user',
          text: this.currentInputTranscription,
          sender: 'user',
          isFinal: true
        });
        this.currentInputTranscription = '';
      }
      
      if (this.currentOutputTranscription.trim()) {
         callbacks.onTranscription({
          id: Date.now().toString() + '-model',
          text: this.currentOutputTranscription,
          sender: 'model',
          isFinal: true
        });
        this.currentOutputTranscription = '';
      }
    }
  }

  public startVideoStreaming(videoElement: HTMLVideoElement) {
    if (this.videoInterval) clearInterval(this.videoInterval);
    if (!videoElement) return;

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const JPEG_QUALITY = 0.5;
    const FPS = 2;

    this.videoInterval = window.setInterval(async () => {
      // Safety check: ensure element still exists and has width
      if (!this.isActive || !this.sessionPromise || !ctx || !videoElement.videoWidth) return;

      canvas.width = videoElement.videoWidth * 0.5;
      canvas.height = videoElement.videoHeight * 0.5;
      
      ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
      
      canvas.toBlob(async (blob) => {
        if (blob) {
          const base64Data = await blobToBase64(blob);
          this.sessionPromise?.then(session => {
            if (session && session.sendRealtimeInput) {
                session.sendRealtimeInput({
                    media: { data: base64Data, mimeType: 'image/jpeg' }
                });
            }
          }).catch(e => {
               if(this.isActive) console.error("Error sending video frame", e);
          });
        }
      }, 'image/jpeg', JPEG_QUALITY);

    }, 1000 / FPS);
  }

  public stopVideoStreaming() {
    if (this.videoInterval) {
      clearInterval(this.videoInterval);
      this.videoInterval = null;
    }
  }

  public disconnect() {
    this.isActive = false;
    this.cleanup();
  }

  private cleanup() {
    if (this.connectionTimeoutId) {
        clearTimeout(this.connectionTimeoutId);
        this.connectionTimeoutId = null;
    }

    this.stopVideoStreaming();
    if (this.inputSource) {
        try { this.inputSource.disconnect(); } catch(e) {}
    }
    if (this.processor) {
        try { this.processor.disconnect(); } catch(e) {}
    }
    if (this.outputGainNode) {
        try { this.outputGainNode.disconnect(); } catch(e) {}
    }
    if (this.inputAudioContext) {
        try { this.inputAudioContext.close(); } catch(e) {}
    }
    if (this.outputAudioContext) {
        try { this.outputAudioContext.close(); } catch(e) {}
    }
    
    this.sessionPromise?.then(session => {
        if(session && session.close) session.close();
    }).catch(() => {});

    this.inputSource = null;
    this.processor = null;
    this.inputAudioContext = null;
    this.outputAudioContext = null;
    this.outputGainNode = null;
    this.sessionPromise = null;
    this.audioStreamDestination = null;
  }
}
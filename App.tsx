import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GeminiLiveClient } from './services/geminiLive';
import { MeetingState, TranscriptionItem } from './types';
import { 
  MicIcon, MicOffIcon, VideoIcon, VideoOffIcon, PhoneOffIcon, 
  LayoutGridIcon, SettingsIcon, ScreenShareIcon, RecordIcon, 
  StopRecordIcon, CopyIcon, SparklesIcon, RefreshIcon, DownloadIcon,
  BoardIcon, LockIcon
} from './components/Icons';
import AudioVisualizer from './components/AudioVisualizer';
import Whiteboard from './components/Whiteboard';

const API_KEY = process.env.API_KEY || '';

// Type for global MediaPipe variable
declare global {
  interface Window {
    SelfieSegmentation: any;
  }
}

const generateRandomString = (len: number) => {
    const chars = 'abcdefghijklmnopqrstuvwxyz';
    return Array.from({length: len}, () => chars[Math.floor(Math.random() * chars.length)]).join('');
};

const generateMeetingInfo = () => {
  const code = `${generateRandomString(3)}-${generateRandomString(4)}-${generateRandomString(3)}`;
  const passcode = Math.floor(1000 + Math.random() * 9000).toString(); // 4 digit passcode
  return { code, passcode };
};

const App = () => {
  const [meetingState, setMeetingState] = useState<MeetingState>(MeetingState.LOBBY);
  const [meetingCode, setMeetingCode] = useState("");
  const [passcode, setPasscode] = useState("");
  const [isMicOn, setIsMicOn] = useState(true);
  const [isVideoOn, setIsVideoOn] = useState(true);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isWhiteboardOpen, setIsWhiteboardOpen] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Background State
  const [backgroundMode, setBackgroundMode] = useState<'none' | 'blur' | 'image'>('none');
  const [showBgMenu, setShowBgMenu] = useState(false);
  
  // Media refs
  const videoRef = useRef<HTMLVideoElement>(null); // Meeting video
  const previewVideoRef = useRef<HTMLVideoElement>(null); // Lobby video
  const mediaStreamRef = useRef<MediaStream | null>(null); // The stream actively used (Raw or Processed)
  const originalCameraStreamRef = useRef<MediaStream | null>(null); // The raw camera stream
  
  // Processing Refs
  const canvasRef = useRef<HTMLCanvasElement>(document.createElement('canvas'));
  const segmentationRef = useRef<any>(null);
  const requestRef = useRef<number>(0);
  const backgroundImgRef = useRef<HTMLImageElement>(new Image());
  const rawVideoRef = useRef<HTMLVideoElement>(document.createElement('video'));
  
  // Whiteboard Ref
  const whiteboardCanvasRef = useRef<HTMLCanvasElement>(null);
  const whiteboardStreamRef = useRef<MediaStream | null>(null);

  // Recording Refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordingMixerContextRef = useRef<AudioContext | null>(null);
  
  // Gemini Client
  const clientRef = useRef<GeminiLiveClient | null>(null);
  
  // Meeting State
  const [transcriptions, setTranscriptions] = useState<TranscriptionItem[]>([]);
  const [aiAudioLevel, setAiAudioLevel] = useState(0); 

  // Initialize MediaPipe and Raw Video Element
  useEffect(() => {
    // Check URL for code and passcode
    const params = new URLSearchParams(window.location.search);
    const codeFromUrl = params.get('code');
    const passFromUrl = params.get('pwd');
    
    if (codeFromUrl) {
      setMeetingCode(codeFromUrl);
      if (passFromUrl) setPasscode(passFromUrl);
      else setPasscode(generateMeetingInfo().passcode); // Generate random if not provided
    } else {
      const info = generateMeetingInfo();
      setMeetingCode(info.code);
      setPasscode(info.passcode);
    }

    // Preload background image
    backgroundImgRef.current.src = "https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=1920&q=80";

    // Init invisible video element for processing
    rawVideoRef.current.autoplay = true;
    rawVideoRef.current.muted = true;
    rawVideoRef.current.playsInline = true;

    const loadMediaPipe = async () => {
      if (window.SelfieSegmentation) {
        const selfieSegmentation = new window.SelfieSegmentation({
          locateFile: (file: string) => `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}`,
        });
        selfieSegmentation.setOptions({ modelSelection: 1 });
        selfieSegmentation.onResults(onSegmentationResults);
        segmentationRef.current = selfieSegmentation;
      }
    };
    loadMediaPipe();
    
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
      segmentationRef.current?.close();
    };
  }, []);

  const onSegmentationResults = (results: any) => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.save();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // 1. Draw Segmentation Mask
    ctx.drawImage(results.segmentationMask, 0, 0, canvas.width, canvas.height);

    // 2. Composition
    ctx.globalCompositeOperation = 'source-in';
    ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);

    // 3. Draw Background
    ctx.globalCompositeOperation = 'destination-over';
    
    if (backgroundMode === 'blur') {
       ctx.filter = 'blur(10px)';
       ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);
       ctx.filter = 'none';
    } else if (backgroundMode === 'image') {
       ctx.drawImage(backgroundImgRef.current, 0, 0, canvas.width, canvas.height);
    } else {
       ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);
    }
    
    ctx.restore();
  };

  // Update loop for MediaPipe
  const startProcessingLoop = useCallback(() => {
    if (requestRef.current) cancelAnimationFrame(requestRef.current);

    const loop = async () => {
      if (
          backgroundMode !== 'none' && 
          isVideoOn && 
          !isScreenSharing &&
          !isWhiteboardOpen &&
          rawVideoRef.current && 
          rawVideoRef.current.readyState >= 2 &&
          segmentationRef.current
      ) {
        await segmentationRef.current.send({ image: rawVideoRef.current });
      }
      requestRef.current = requestAnimationFrame(loop);
    };
    loop();
  }, [backgroundMode, isVideoOn, isScreenSharing, isWhiteboardOpen]);

  // Handle Stream Updates (Background Mode or Camera Toggle)
  const updateStreamSource = useCallback((mode: 'none' | 'blur' | 'image', forceRawStream?: MediaStream) => {
    // Use provided stream or fall back to current ref
    const rawStream = forceRawStream || originalCameraStreamRef.current;
    
    if (!rawStream) return;

    if (mode === 'none') {
        // Stop processing loop if running
        if (requestRef.current) cancelAnimationFrame(requestRef.current);
        
        mediaStreamRef.current = rawStream;
        
        // Update Video Elements
        if (previewVideoRef.current) previewVideoRef.current.srcObject = rawStream;
        if (videoRef.current) videoRef.current.srcObject = rawStream;

    } else {
        // Enable processing
        canvasRef.current.width = 1280;
        canvasRef.current.height = 720;
        
        // Feed raw stream to hidden video for processing
        rawVideoRef.current.srcObject = rawStream;
        rawVideoRef.current.play().catch(console.error);
        
        startProcessingLoop();

        // Create stream from canvas if not exists or needs refresh
        const canvasStream = canvasRef.current.captureStream(30);
        const processedVideoTrack = canvasStream.getVideoTracks()[0];
        
        // Combine with original Audio
        const audioTracks = rawStream.getAudioTracks();
        const newStream = new MediaStream([processedVideoTrack, ...audioTracks]);
        
        mediaStreamRef.current = newStream;

        // Update UI Video Elements to show processed stream
        if (previewVideoRef.current) previewVideoRef.current.srcObject = newStream;
        if (videoRef.current) videoRef.current.srcObject = newStream;
    }
    
    // Refresh Gemini Stream if connected
    if (meetingState === MeetingState.CONNECTED && videoRef.current && clientRef.current) {
        // Small delay to ensure refs are updated
        setTimeout(() => {
             if (videoRef.current) clientRef.current?.startVideoStreaming(videoRef.current);
        }, 100);
    }

  }, [meetingState, startProcessingLoop, isVideoOn]);

  // Start Camera Helper
  const startCamera = async () => {
      try {
          const stream = await navigator.mediaDevices.getUserMedia({ 
            video: { width: 1280, height: 720 }, 
            audio: true 
          });
          
          originalCameraStreamRef.current = stream;
          
          // Apply Mic State
          stream.getAudioTracks().forEach(t => t.enabled = isMicOn);

          setIsVideoOn(true);
          updateStreamSource(backgroundMode, stream);
          setError(null);
      } catch (err) {
          console.error("Error accessing media devices", err);
          setError("Camera or Microphone access denied. Please allow permissions.");
      }
  };

  // Stop Camera Helper (Hardware)
  const stopCamera = () => {
      if (originalCameraStreamRef.current) {
          originalCameraStreamRef.current.getTracks().forEach(t => t.stop());
          originalCameraStreamRef.current = null;
      }
      // If we are using a canvas stream, stop that too
      if (mediaStreamRef.current && mediaStreamRef.current.id !== originalCameraStreamRef.current?.id) {
          mediaStreamRef.current.getTracks().forEach(t => t.stop());
      }
      setIsVideoOn(false);
  };

  // Initial Mount
  useEffect(() => {
    if (meetingState === MeetingState.LOBBY) {
      startCamera();
    }
    return () => {
      stopCamera();
    };
  }, [meetingState]); // Re-run when returning to lobby

  // Handle Background Mode Changes
  useEffect(() => {
     if (isVideoOn) {
         updateStreamSource(backgroundMode);
     }
  }, [backgroundMode]);


  // Handle Joining
  const handleJoin = async () => {
    if (!API_KEY) {
      alert("API Key is missing. Please check your .env file.");
      return;
    }

    if (!mediaStreamRef.current) {
        setError("Microphone/Camera access is required to join.");
        // Try starting camera again
        await startCamera();
        if (!originalCameraStreamRef.current) return; 
    }

    setMeetingState(MeetingState.CONNECTING);
    setError(null);
    
    const client = new GeminiLiveClient(API_KEY);
    clientRef.current = client;

    // We don't start video here anymore. We wait for CONNECTED state and videoRef.
    await client.connect({
      onOpen: () => {
        setMeetingState(MeetingState.CONNECTED);
      },
      onClose: () => {
        setMeetingState(MeetingState.ENDED);
      },
      onError: (err) => {
        setError(err.message);
        setMeetingState(MeetingState.ERROR);
      },
      onAudioData: (buffer) => {
        const data = buffer.getChannelData(0);
        let sum = 0;
        // Simple RMS calc
        for(let i=0; i<data.length; i+=10) sum += data[i] * data[i];
        const rms = Math.sqrt(sum / (data.length / 10));
        setAiAudioLevel(Math.min(1, rms * 5)); 
      },
      onTranscription: (item) => {
        setTranscriptions(prev => [...prev, item]);
      }
    });
  };

  // Effect to start sending video to Gemini once connected and view is ready
  useEffect(() => {
    if (meetingState === MeetingState.CONNECTED && clientRef.current && videoRef.current) {
        // Ensure the video element has the stream
        if (!videoRef.current.srcObject && mediaStreamRef.current) {
            videoRef.current.srcObject = mediaStreamRef.current;
        }
        
        // Determine what to stream
        if (isWhiteboardOpen && whiteboardCanvasRef.current) {
             // To stream the whiteboard, we need to feed it into a hidden video element
             // because the Client expects a video element.
             const wbStream = whiteboardCanvasRef.current.captureStream(10);
             whiteboardStreamRef.current = wbStream;
             
             // Reuse rawVideoRef or a new temporary video element to feed the stream
             if (rawVideoRef.current) {
                 rawVideoRef.current.srcObject = wbStream;
                 rawVideoRef.current.play();
                 clientRef.current.startVideoStreaming(rawVideoRef.current);
             }
        } else if (isVideoOn || isScreenSharing) {
             clientRef.current.startVideoStreaming(videoRef.current);
        }
    }
  }, [meetingState, isVideoOn, isScreenSharing, isWhiteboardOpen]);


  const handleLeave = () => {
    stopRecording();
    stopScreenShare();
    clientRef.current?.disconnect();
    stopCamera();
    setMeetingState(MeetingState.ENDED);
  };

  const handleNewMeeting = () => {
    const info = generateMeetingInfo();
    setMeetingCode(info.code);
    setPasscode(info.passcode);
    
    const url = new URL(window.location.href);
    url.searchParams.set('code', info.code);
    url.searchParams.set('pwd', info.passcode);
    window.history.pushState({}, '', url);
  };

  const copyInviteLink = () => {
    const url = new URL(window.location.href);
    url.searchParams.set('code', meetingCode);
    url.searchParams.set('pwd', passcode);
    navigator.clipboard.writeText(url.toString());
    alert("Meeting link & passcode copied to clipboard!");
  };

  // Controls
  const toggleMic = () => {
    const newStatus = !isMicOn;
    setIsMicOn(newStatus);
    
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getAudioTracks().forEach(track => track.enabled = newStatus);
    }
    if (originalCameraStreamRef.current) {
       originalCameraStreamRef.current.getAudioTracks().forEach(track => track.enabled = newStatus);
    }
  };

  const toggleVideo = async () => {
    if (isScreenSharing) {
        stopScreenShare();
        await startCamera(); 
        return;
    }
    // ... rest of toggle logic
  };
  
  // Revised Toggle Video to handle "Hardware Off" correctly while keeping Audio
  const toggleVideoHardware = async () => {
      if (isScreenSharing) {
          stopScreenShare();
          await startCamera();
          return;
      }
      
      if (isWhiteboardOpen) {
          // If in whiteboard, close it first
          setIsWhiteboardOpen(false);
          // Wait a tick then toggle
          setTimeout(() => toggleVideoHardware(), 100);
          return;
      }

      if (isVideoOn) {
          // 1. Stop Video Tracks Only
          if (originalCameraStreamRef.current) {
              originalCameraStreamRef.current.getVideoTracks().forEach(t => t.stop());
          }
          if (mediaStreamRef.current) {
              mediaStreamRef.current.getVideoTracks().forEach(t => t.stop());
          }
          
          setIsVideoOn(false);
          clientRef.current?.stopVideoStreaming();
      } else {
          // 1. Re-request AV (easiest way to get video back)
          try {
              const videoStream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 } });
              const newVideoTrack = videoStream.getVideoTracks()[0];
              
              if (originalCameraStreamRef.current) {
                  // Remove dead tracks
                  const oldTracks = originalCameraStreamRef.current.getVideoTracks();
                  oldTracks.forEach(t => { originalCameraStreamRef.current?.removeTrack(t); });
                  originalCameraStreamRef.current.addTrack(newVideoTrack);
              } else {
                  originalCameraStreamRef.current = videoStream; // Temporarily just video
              }

              setIsVideoOn(true);
              updateStreamSource(backgroundMode);

          } catch (e) {
              console.error("Failed to restart video", e);
              setError("Could not restart camera.");
          }
      }
  };


  const startScreenShare = async () => {
    if (isWhiteboardOpen) setIsWhiteboardOpen(false);
    try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        const videoTrack = screenStream.getVideoTracks()[0];
        
        videoTrack.onended = () => stopScreenShare();

        if (mediaStreamRef.current) {
             const oldTracks = mediaStreamRef.current.getVideoTracks();
             oldTracks.forEach(t => {
                 t.enabled = false; 
                 t.stop(); // Stop camera to save resources/light
                 mediaStreamRef.current?.removeTrack(t);
             });
             mediaStreamRef.current.addTrack(videoTrack);
             
             setIsScreenSharing(true);
             setIsVideoOn(true); // Technically video is sending

             if (videoRef.current) {
                 videoRef.current.srcObject = mediaStreamRef.current;
                 clientRef.current?.startVideoStreaming(videoRef.current);
             }
        }
    } catch (e) {
        console.error("Screen share failed", e);
    }
  };

  const stopScreenShare = async () => {
      if (!isScreenSharing) return;

      const screenTrack = mediaStreamRef.current?.getVideoTracks()[0];
      screenTrack?.stop();
      mediaStreamRef.current?.removeTrack(screenTrack!);

      setIsScreenSharing(false);
      // Revert to camera
      await startCamera();
  };

  const handleScreenShareToggle = () => {
      if (isScreenSharing) stopScreenShare();
      else startScreenShare();
  };
  
  const toggleWhiteboard = () => {
      if (isScreenSharing) stopScreenShare();
      setIsWhiteboardOpen(!isWhiteboardOpen);
  };

  const startRecording = () => {
    if (!mediaStreamRef.current || !clientRef.current) return;
    
    try {
        const mixerCtx = new AudioContext();
        recordingMixerContextRef.current = mixerCtx;
        const dest = mixerCtx.createMediaStreamDestination();
        
        // Add User Mic
        const userMicTrack = mediaStreamRef.current.getAudioTracks()[0];
        if (userMicTrack) {
            const micSource = mixerCtx.createMediaStreamSource(new MediaStream([userMicTrack]));
            micSource.connect(dest);
        }

        // Add Gemini Audio
        const remoteStream = clientRef.current.getRemoteAudioStream();
        if (remoteStream && remoteStream.getAudioTracks().length > 0) {
            const remoteSource = mixerCtx.createMediaStreamSource(remoteStream);
            remoteSource.connect(dest);
        }

        const mixedAudioTrack = dest.stream.getAudioTracks()[0];
        
        // Determine video track to record (Camera, Screen, or Whiteboard)
        let videoTrack;
        if (isWhiteboardOpen && whiteboardStreamRef.current) {
            videoTrack = whiteboardStreamRef.current.getVideoTracks()[0];
        } else {
            videoTrack = mediaStreamRef.current.getVideoTracks()[0];
        }
        
        const recordingStream = new MediaStream([mixedAudioTrack]);
        if (videoTrack) recordingStream.addTrack(videoTrack);

        const recorder = new MediaRecorder(recordingStream, { mimeType: 'video/webm' });
        
        recorder.ondataavailable = (e) => {
            if (e.data.size > 0) recordedChunksRef.current.push(e.data);
        };
        
        recorder.onstop = () => {
            const blob = new Blob(recordedChunksRef.current, { type: 'video/webm' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `meeting-${meetingCode}-${Date.now()}.webm`;
            a.click();
            recordedChunksRef.current = [];
        };

        recorder.start();
        mediaRecorderRef.current = recorder;
        setIsRecording(true);
    } catch (e) {
        console.error("Failed to start recording", e);
        setError("Recording failed to start.");
    }
  };

  const stopRecording = () => {
      if (mediaRecorderRef.current && isRecording) {
          mediaRecorderRef.current.stop();
          setIsRecording(false);
          recordingMixerContextRef.current?.close();
      }
  };

  const handleRecordToggle = () => {
      if (isRecording) stopRecording();
      else startRecording();
  };
  
  const downloadTranscript = () => {
    if (transcriptions.length === 0) return;

    const textContent = transcriptions.map(t => {
      // Try to parse timestamp from ID or just use text
      let timeStr = "";
      try {
          const timestamp = parseInt(t.id.split('-')[0]);
          if (!isNaN(timestamp)) {
              timeStr = `[${new Date(timestamp).toLocaleTimeString()}] `;
          }
      } catch (e) {}

      const role = t.sender === 'user' ? 'You' : 'Gemini';
      return `${timeStr}${role}: ${t.text}`;
    }).join('\n\n');

    const blob = new Blob([textContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transcript-${meetingCode}-${Date.now()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // ---- RENDER: LOBBY ----
  if (meetingState === MeetingState.LOBBY || meetingState === MeetingState.CONNECTING) {
    return (
      <div className="min-h-screen bg-gray-900 flex flex-col items-center justify-center p-4">
        <div className="max-w-4xl w-full bg-gray-800 rounded-2xl overflow-hidden shadow-2xl flex flex-col md:flex-row">
          
          {/* Preview Area */}
          <div className="flex-1 p-6 flex flex-col items-center justify-center bg-black relative min-h-[400px]">
             {/* Video Preview */}
             <video 
                ref={previewVideoRef}
                autoPlay 
                muted 
                playsInline
                className={`w-full h-full object-cover rounded-lg transform scale-x-[-1] ${!isVideoOn ? 'hidden' : ''}`} 
             />
             {!isVideoOn && (
                <div className="w-full h-full flex items-center justify-center bg-gray-700 rounded-lg text-gray-400">
                    <div className="text-center">
                        <div className="bg-gray-600 p-6 rounded-full inline-block mb-4">
                            <span className="text-4xl">👤</span>
                        </div>
                        <p>Camera is off</p>
                    </div>
                </div>
             )}

             {/* Background Effects Menu */}
             {showBgMenu && (
                 <div className="absolute top-4 right-4 bg-gray-900/90 backdrop-blur p-3 rounded-xl border border-gray-700 z-10 flex flex-col gap-2 w-48 shadow-xl">
                    <h3 className="text-xs font-bold text-gray-400 uppercase mb-1">Backgrounds</h3>
                    <button 
                        onClick={() => setBackgroundMode('none')}
                        className={`text-left px-3 py-2 rounded text-sm ${backgroundMode === 'none' ? 'bg-blue-600 text-white' : 'hover:bg-gray-800 text-gray-300'}`}
                    >
                        🚫 None
                    </button>
                    <button 
                        onClick={() => setBackgroundMode('blur')}
                        className={`text-left px-3 py-2 rounded text-sm ${backgroundMode === 'blur' ? 'bg-blue-600 text-white' : 'hover:bg-gray-800 text-gray-300'}`}
                    >
                        💧 Blur
                    </button>
                    <button 
                        onClick={() => setBackgroundMode('image')}
                        className={`text-left px-3 py-2 rounded text-sm ${backgroundMode === 'image' ? 'bg-blue-600 text-white' : 'hover:bg-gray-800 text-gray-300'}`}
                    >
                        🌆 Office
                    </button>
                 </div>
             )}

             <div className="absolute bottom-6 flex gap-4">
                <button 
                  onClick={toggleMic}
                  className={`p-4 rounded-full ${isMicOn ? 'bg-gray-700 hover:bg-gray-600' : 'bg-red-500 hover:bg-red-600'} text-white transition`}
                >
                  {isMicOn ? <MicIcon /> : <MicOffIcon />}
                </button>
                <button 
                  onClick={toggleVideoHardware}
                  className={`p-4 rounded-full ${isVideoOn ? 'bg-gray-700 hover:bg-gray-600' : 'bg-red-500 hover:bg-red-600'} text-white transition`}
                >
                  {isVideoOn ? <VideoIcon /> : <VideoOffIcon />}
                </button>
                <button 
                  onClick={() => setShowBgMenu(!showBgMenu)}
                  className={`p-4 rounded-full ${backgroundMode !== 'none' ? 'bg-blue-600 hover:bg-blue-500' : 'bg-gray-700 hover:bg-gray-600'} text-white transition`}
                  title="Background Effects"
                >
                   <SparklesIcon />
                </button>
             </div>
          </div>

          {/* Join Controls */}
          <div className="w-full md:w-96 p-8 flex flex-col justify-center border-l border-gray-700">
            <h1 className="text-3xl font-bold mb-2">Gemini Meet</h1>
            <p className="text-gray-400 mb-6">High-fidelity AI video conferencing</p>
            
            <div className="mb-6 space-y-4">
                <div>
                  <label className="block text-gray-500 text-xs uppercase font-bold mb-2">Meeting Code</label>
                  <div className="flex gap-2">
                      <input 
                          type="text" 
                          value={meetingCode}
                          onChange={(e) => setMeetingCode(e.target.value)}
                          className="flex-1 bg-gray-900 border border-gray-600 rounded p-2 text-white focus:outline-none focus:border-blue-500 font-mono"
                          placeholder="abc-def-ghi"
                      />
                      <button 
                          onClick={handleNewMeeting}
                          className="p-2 bg-gray-700 rounded hover:bg-gray-600 text-gray-300"
                          title="Generate New Code"
                      >
                          <RefreshIcon className="w-5 h-5" />
                      </button>
                  </div>
                </div>

                <div>
                   <label className="block text-gray-500 text-xs uppercase font-bold mb-2">Passcode</label>
                   <div className="flex gap-2 items-center bg-gray-900 border border-gray-600 rounded p-2">
                      <LockIcon className="w-4 h-4 text-gray-400" />
                      <span className="font-mono text-white flex-1">{passcode}</span>
                   </div>
                </div>

                <button 
                    onClick={copyInviteLink}
                    className="w-full py-2 bg-gray-700 hover:bg-gray-600 rounded text-gray-300 flex items-center justify-center gap-2 text-sm"
                >
                    <CopyIcon className="w-4 h-4" /> Copy Invite Link & Passcode
                </button>
            </div>

            {error && (
              <div className="bg-red-900/50 border border-red-500 text-red-200 p-3 rounded mb-4 text-sm">
                {error}
              </div>
            )}

            <button
              onClick={handleJoin}
              disabled={meetingState === MeetingState.CONNECTING}
              className="w-full py-3 px-6 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 disabled:cursor-wait text-white font-semibold rounded-lg transition shadow-lg flex items-center justify-center gap-2"
            >
              {meetingState === MeetingState.CONNECTING ? 'Connecting...' : 'Join now'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---- RENDER: MEETING ----
  if (meetingState === MeetingState.CONNECTED) {
    return (
      <div className="h-screen bg-gray-950 flex flex-col relative overflow-hidden">
        
        {/* Header */}
        <div className="absolute top-0 left-0 right-0 z-10 p-4 flex justify-between items-center bg-gradient-to-b from-black/70 to-transparent pointer-events-none">
           <div className="flex items-center gap-2 pointer-events-auto">
             <div className="bg-blue-600 p-1.5 rounded text-xs font-bold">GM</div>
             <div className="flex flex-col">
               <span className="font-semibold text-lg tracking-tight leading-none">Meeting</span>
               <div className="flex gap-2 text-xs text-gray-400 font-mono mt-0.5">
                  <span>{meetingCode}</span>
                  <span className="border-l border-gray-600 pl-2 flex items-center gap-1"><LockIcon className="w-2.5 h-2.5" />{passcode}</span>
               </div>
             </div>
             {isRecording && <span className="flex items-center gap-1 text-red-500 text-xs font-bold bg-red-900/30 px-2 py-1 rounded ml-2 animate-pulse"><div className="w-2 h-2 bg-red-500 rounded-full"></div>REC</span>}
           </div>
           <div className="flex gap-2 pointer-events-auto">
              <button 
                onClick={copyInviteLink} 
                className="p-2 hover:bg-gray-800 rounded-full text-white" 
                title="Copy Invite Link"
              >
                  <CopyIcon className="w-5 h-5" />
              </button>
              <button className="p-2 hover:bg-gray-800 rounded-full"><LayoutGridIcon className="w-5 h-5" /></button>
              <button className="p-2 hover:bg-gray-800 rounded-full"><SettingsIcon className="w-5 h-5" /></button>
           </div>
        </div>

        {/* Main Stage (Grid) */}
        <div className="flex-1 p-4 flex gap-4 overflow-hidden relative">
          
          {/* Main View Area (AI or Whiteboard) */}
          <div className="flex-1 bg-gray-900 rounded-2xl flex flex-col items-center justify-center relative overflow-hidden border border-gray-800">
             
             {isWhiteboardOpen ? (
                 <Whiteboard canvasRef={whiteboardCanvasRef} />
             ) : (
                <>
                    <div className="absolute inset-0 flex items-center justify-center">
                        {/* Visualizer for AI Voice */}
                        <div className="w-64 h-64 relative">
                        <div className="absolute inset-0 bg-blue-500/20 blur-3xl rounded-full scale-150 animate-pulse"></div>
                        <AudioVisualizer isActive={true} audioLevel={aiAudioLevel} />
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                            <span className="text-6xl">✨</span>
                        </div>
                        </div>
                    </div>
                    
                    {/* Name Tag */}
                    <div className="absolute bottom-4 left-4 bg-black/50 backdrop-blur-md px-3 py-1 rounded text-sm font-medium flex items-center gap-2">
                        <span>Gemini (Host)</span>
                        {aiAudioLevel > 0.05 && <div className="w-2 h-2 bg-green-500 rounded-full"></div>}
                    </div>
                </>
             )}
          </div>

          {/* Caption/Transcription Overlay (Only if not whiteboard for clarity) */}
          {!isWhiteboardOpen && (
            <div className="absolute bottom-24 left-1/2 -translate-x-1/2 w-full max-w-2xl text-center pointer-events-none z-20">
                {transcriptions.length > 0 && (
                    <div className="bg-black/60 backdrop-blur px-6 py-2 rounded-xl text-lg text-white shadow-lg transition-all inline-block">
                    {transcriptions[transcriptions.length - 1].sender === 'model' && (
                        <span className="text-blue-300 mr-2">Gemini:</span>
                    )}
                    {transcriptions[transcriptions.length - 1].text}
                    </div>
                )}
            </div>
          )}

          {/* User Self View (Floating) */}
          <div className="absolute bottom-6 right-6 w-64 aspect-video bg-black rounded-xl overflow-hidden shadow-2xl border border-gray-700 group z-30">
             <video 
                ref={videoRef}
                autoPlay 
                muted 
                playsInline
                // Mirror if camera (and not sharing screen or whiteboard), don't mirror if sharing
                className={`w-full h-full object-cover ${isScreenSharing || isWhiteboardOpen ? '' : 'transform scale-x-[-1]'} ${(!isVideoOn && !isScreenSharing) ? 'opacity-0' : 'opacity-100'}`} 
             />
             {(!isVideoOn && !isScreenSharing) && (
               <div className="absolute inset-0 flex items-center justify-center bg-gray-800">
                 <span className="text-2xl">👤</span>
               </div>
             )}
             <div className="absolute bottom-2 left-2 bg-black/50 px-2 py-0.5 rounded text-xs flex items-center gap-1">
                You {isScreenSharing ? '(Presentation)' : isWhiteboardOpen ? '(Whiteboard)' : ''}
             </div>
             <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                {!isMicOn && <div className="bg-red-500 p-1 rounded-full"><MicOffIcon className="w-3 h-3" /></div>}
             </div>
          </div>

        </div>

        {/* Bottom Control Bar */}
        <div className="h-20 bg-gray-900 border-t border-gray-800 flex items-center justify-center gap-4 px-4 relative">
           
           {/* In-meeting background menu */}
           {showBgMenu && (
             <div className="absolute bottom-24 bg-gray-800 border border-gray-700 rounded-xl p-3 shadow-xl flex flex-col gap-2 w-40">
                <button onClick={() => setBackgroundMode('none')} className={`p-2 rounded text-left ${backgroundMode==='none'?'bg-blue-600':'hover:bg-gray-700'}`}>None</button>
                <button onClick={() => setBackgroundMode('blur')} className={`p-2 rounded text-left ${backgroundMode==='blur'?'bg-blue-600':'hover:bg-gray-700'}`}>Blur</button>
                <button onClick={() => setBackgroundMode('image')} className={`p-2 rounded text-left ${backgroundMode==='image'?'bg-blue-600':'hover:bg-gray-700'}`}>Office</button>
             </div>
           )}

           <ControlBtn 
             onClick={toggleMic} 
             isActive={!isMicOn} 
             activeColor="bg-red-600 hover:bg-red-700"
             inactiveColor="bg-gray-700 hover:bg-gray-600"
             icon={isMicOn ? <MicIcon /> : <MicOffIcon />} 
             tooltip={isMicOn ? "Mute" : "Unmute"}
           />
           <ControlBtn 
             onClick={toggleVideoHardware} 
             isActive={!isVideoOn && !isScreenSharing && !isWhiteboardOpen}
             activeColor="bg-red-600 hover:bg-red-700"
             inactiveColor="bg-gray-700 hover:bg-gray-600"
             icon={isVideoOn || isScreenSharing || isWhiteboardOpen ? <VideoIcon /> : <VideoOffIcon />} 
             tooltip={isVideoOn ? "Stop Video" : "Start Video"}
           />
           
           <ControlBtn 
             onClick={() => setShowBgMenu(!showBgMenu)} 
             isActive={showBgMenu || backgroundMode !== 'none'}
             activeColor="bg-blue-600 hover:bg-blue-700"
             inactiveColor="bg-gray-700 hover:bg-gray-600"
             icon={<SparklesIcon />} 
             tooltip="Background Effects"
           />

           <div className="w-px h-8 bg-gray-700 mx-2"></div>

           <ControlBtn 
             onClick={toggleWhiteboard} 
             isActive={isWhiteboardOpen}
             activeColor="bg-green-600 hover:bg-green-700"
             inactiveColor="bg-gray-700 hover:bg-gray-600"
             icon={<BoardIcon />} 
             tooltip="Whiteboard"
           />

           <ControlBtn 
             onClick={handleScreenShareToggle} 
             isActive={isScreenSharing}
             activeColor="bg-green-600 hover:bg-green-700"
             inactiveColor="bg-gray-700 hover:bg-gray-600"
             icon={<ScreenShareIcon />} 
             tooltip="Share Screen"
           />

           <ControlBtn 
             onClick={handleRecordToggle} 
             isActive={isRecording}
             activeColor="bg-gray-700 border-2 border-red-500"
             inactiveColor="bg-gray-700 hover:bg-gray-600"
             icon={isRecording ? <StopRecordIcon className="text-red-500" /> : <RecordIcon />} 
             tooltip="Record Meeting"
           />

           <div className="w-px h-8 bg-gray-700 mx-2"></div>

           <button 
             onClick={handleLeave}
             className="w-16 h-10 rounded-full bg-red-600 hover:bg-red-700 flex items-center justify-center text-white transition-all px-8"
             title="Leave Meeting"
           >
              <PhoneOffIcon />
           </button>
        </div>
      </div>
    );
  }

  // ---- RENDER: ENDED/ERROR ----
  return (
    <div className="min-h-screen bg-gray-900 flex flex-col items-center justify-center text-white">
      <h1 className="text-3xl font-bold mb-4">Meeting Ended</h1>
      <p className="text-gray-400 mb-8">{error ? `Error: ${error}` : "You left the meeting."}</p>
      
      <div className="flex gap-4">
        {transcriptions.length > 0 && (
          <button
            onClick={downloadTranscript}
            className="px-6 py-2 bg-gray-700 rounded hover:bg-gray-600 transition flex items-center gap-2"
          >
            <DownloadIcon className="w-4 h-4" /> Download Transcript
          </button>
        )}
        
        <button 
          onClick={() => window.location.reload()}
          className="px-6 py-2 bg-blue-600 rounded hover:bg-blue-700 transition"
        >
          Rejoin
        </button>
      </div>
    </div>
  );
};

const ControlBtn = ({ onClick, isActive, icon, activeColor, inactiveColor, tooltip }: any) => (
  <button 
    onClick={onClick}
    title={tooltip}
    className={`p-3 rounded-full text-white transition-all duration-200 ${isActive ? activeColor : inactiveColor}`}
  >
    {icon}
  </button>
);

export default App;
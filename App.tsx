import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GeminiLiveClient } from './services/geminiLive';
import { MeetingState, TranscriptionItem } from './types';
import { 
  MicIcon, MicOffIcon, VideoIcon, VideoOffIcon, PhoneOffIcon, 
  SettingsIcon, ScreenShareIcon, RecordIcon, 
  StopRecordIcon, CopyIcon, SparklesIcon, RefreshIcon, DownloadIcon,
  BoardIcon, MessageSquareIcon, SendIcon, Volume2Icon, VolumeXIcon,
  PlusIcon, CalendarIcon, ArrowLeftIcon
} from './components/Icons';
import AudioVisualizer from './components/AudioVisualizer';
import Whiteboard from './components/Whiteboard';

// Type for global variables
declare global {
  interface Window {
    SelfieSegmentation: any;
  }
}

// Global helpers
const generateRandomString = (len: number) => {
    const chars = 'abcdefghijklmnopqrstuvwxyz';
    return Array.from({length: len}, () => chars[Math.floor(Math.random() * chars.length)]).join('');
};

const generateMeetingInfo = () => {
  const code = `${generateRandomString(3)}-${generateRandomString(4)}-${generateRandomString(3)}`;
  const passcode = Math.floor(1000 + Math.random() * 9000).toString(); // 4 digit passcode
  return { code, passcode };
};

type AppView = 'home' | 'setup' | 'meeting' | 'ended';
type SetupMode = 'host' | 'guest';

// --- IMAGE CONFIGURATION ---
// Office meeting background
const HERO_IMAGE_URL = "https://images.unsplash.com/photo-1542744173-8e7e53415bb0?auto=format&fit=crop&w=1920&q=80";
// ---------------------------

// Custom Logo Component for Giant Mitra
const GiantMitraLogo = ({ className, scale = 1 }: { className?: string; scale?: number }) => (
    <div className={`flex flex-col items-center select-none ${className}`} style={{ transform: `scale(${scale})` }}>
        <svg width="60" height="45" viewBox="0 0 120 80" fill="none" stroke="#0ea5e9" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round">
            {/* J */}
            <path d="M20 10 H 45" />
            <path d="M32 10 V 55 Q 32 75 12 65" />
            {/* M */}
            <path d="M55 70 V 15 L 75 60 L 95 15 V 70" />
        </svg>
        <span className="text-[#0ea5e9] text-[10px] font-bold -mt-2 tracking-wider font-sans">giantmitra.com</span>
    </div>
);

// Helper Components
const ControlBtn = ({ onClick, isActive, icon, activeColor, inactiveColor, tooltip }: any) => (
  <button 
    onClick={onClick}
    title={tooltip}
    className={`p-3.5 rounded-full text-white transition-all duration-200 ${isActive ? activeColor : inactiveColor}`}
  >
    {icon}
  </button>
);

const RemoteVideo = ({ stream }: { stream: MediaStream }) => {
  const vidRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
      if (vidRef.current) vidRef.current.srcObject = stream;
  }, [stream]);
  return (
      <div className="w-full h-full relative group">
          <video ref={vidRef} autoPlay playsInline className="w-full h-full object-cover rounded-xl" />
          <div className="absolute bottom-2 left-2 bg-black/50 px-2 py-0.5 rounded text-xs text-white">Participant</div>
      </div>
  );
};

export const App = () => {
  // Navigation State
  const [view, setView] = useState<AppView>('home');
  const [setupMode, setSetupMode] = useState<SetupMode>('host');

  // Meeting Logic State
  const [meetingState, setMeetingState] = useState<MeetingState>(MeetingState.LOBBY);
  const [meetingCode, setMeetingCode] = useState("");
  const [passcode, setPasscode] = useState("");
  const [isMicOn, setIsMicOn] = useState(true);
  const [isVideoOn, setIsVideoOn] = useState(true);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isWhiteboardOpen, setIsWhiteboardOpen] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isMutedAll, setIsMutedAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // P2P Identity State
  const [isP2PHost, setIsP2PHost] = useState(false);

  // Chat state
  const [chatMessage, setChatMessage] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);
  
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

  // PeerJS State
  const [remoteStreams, setRemoteStreams] = useState<MediaStream[]>([]);
  const peerRef = useRef<any>(null);

  // --- 1. Initialize & Routing ---
  useEffect(() => {
    // Check URL for code and passcode
    const params = new URLSearchParams(window.location.search);
    const codeFromUrl = params.get('code');
    const passFromUrl = params.get('pwd');
    
    if (codeFromUrl) {
      setMeetingCode(codeFromUrl);
      if (passFromUrl) setPasscode(passFromUrl);
      else setPasscode(generateMeetingInfo().passcode);
      
      // If code exists in URL, jump straight to Join Mode
      setSetupMode('guest');
      setView('setup');
    } else {
      // Default to Home
      setView('home');
    }

    // Preload background image
    backgroundImgRef.current.src = HERO_IMAGE_URL;

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
    const rawStream = forceRawStream || originalCameraStreamRef.current;
    
    if (!rawStream) return;

    if (mode === 'none') {
        if (requestRef.current) cancelAnimationFrame(requestRef.current);
        
        mediaStreamRef.current = rawStream;
        
        if (previewVideoRef.current) previewVideoRef.current.srcObject = rawStream;
        if (videoRef.current) videoRef.current.srcObject = rawStream;

    } else {
        canvasRef.current.width = 1280;
        canvasRef.current.height = 720;
        
        rawVideoRef.current.srcObject = rawStream;
        rawVideoRef.current.play().catch(console.error);
        
        startProcessingLoop();

        const canvasStream = canvasRef.current.captureStream(30);
        const processedVideoTrack = canvasStream.getVideoTracks()[0];
        
        const audioTracks = rawStream.getAudioTracks();
        const newStream = new MediaStream([processedVideoTrack, ...audioTracks]);
        
        mediaStreamRef.current = newStream;

        if (previewVideoRef.current) previewVideoRef.current.srcObject = newStream;
        if (videoRef.current) videoRef.current.srcObject = newStream;
    }
    
    if (meetingState === MeetingState.CONNECTED && videoRef.current && clientRef.current) {
        setTimeout(() => {
             if (videoRef.current) clientRef.current?.startVideoStreaming(videoRef.current);
        }, 100);
    }

  }, [meetingState, startProcessingLoop, isVideoOn]);

  const startCamera = async () => {
      if (originalCameraStreamRef.current) return;

      try {
          const stream = await navigator.mediaDevices.getUserMedia({ 
            video: { width: 1280, height: 720 }, 
            audio: true 
          });
          
          originalCameraStreamRef.current = stream;
          stream.getAudioTracks().forEach(t => t.enabled = isMicOn);

          setIsVideoOn(true);
          updateStreamSource(backgroundMode, stream);
          setError(null);
      } catch (err: any) {
          console.error("Error accessing media devices", err);
          setError("Camera or Microphone access denied. Please allow permissions.");
      }
  };

  const stopCamera = () => {
      if (originalCameraStreamRef.current) {
          originalCameraStreamRef.current.getTracks().forEach(t => t.stop());
          originalCameraStreamRef.current = null;
      }
      if (mediaStreamRef.current && mediaStreamRef.current.id !== originalCameraStreamRef.current?.id) {
          mediaStreamRef.current.getTracks().forEach(t => t.stop());
      }
      mediaStreamRef.current = null;
      setIsVideoOn(false);
  };

  // Camera Lifecycle: Only active in Setup or Meeting views
  useEffect(() => {
    if (view === 'setup') {
      startCamera();
    } else if (view === 'home' || view === 'ended') {
        // Stop camera when in home to save resources/privacy
        stopCamera();
    }
    return () => {
       // Cleanup handled by dependency change logic mostly
    };
  }, [view]); 

  // Handle Background Mode Changes
  useEffect(() => {
     if (isVideoOn && (view === 'setup' || view === 'meeting')) {
         updateStreamSource(backgroundMode);
     }
  }, [backgroundMode]);

  // Scroll Chat
  useEffect(() => {
      if (isChatOpen && chatEndRef.current) {
          chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
      }
  }, [transcriptions, isChatOpen]);


  // --- Actions ---

  const handleStartNewMeeting = () => {
      const info = generateMeetingInfo();
      setMeetingCode(info.code);
      setPasscode(info.passcode);
      setSetupMode('host');
      setView('setup');
      
      // Update URL silently so refresh works
      const url = new URL(window.location.href);
      url.searchParams.set('code', info.code);
      url.searchParams.set('pwd', info.passcode);
      window.history.pushState({}, '', url);
  };

  const handleJoinExisting = () => {
      setMeetingCode(""); // Let them type
      setPasscode("");
      setSetupMode('guest');
      setView('setup');
      
      // Clear URL
      const url = new URL(window.location.href);
      url.searchParams.delete('code');
      url.searchParams.delete('pwd');
      window.history.pushState({}, '', url);
  };

  const goBackHome = () => {
      setView('home');
      setMeetingState(MeetingState.LOBBY);
      setError(null);
  };

  const handleJoinMeeting = async () => {
    if (!mediaStreamRef.current) {
        setError("Microphone/Camera access is required to join.");
        await startCamera();
        if (!originalCameraStreamRef.current) return; 
    }

    setMeetingState(MeetingState.CONNECTING);
    setError(null);
    
    // --- 1. Connect to Gemini AI ---
    try {
        const client = new GeminiLiveClient();
        clientRef.current = client;

        await client.connect({
        onOpen: () => {
            setMeetingState(MeetingState.CONNECTED);
            setView('meeting');
            initPeerConnection();
        },
        onClose: () => {
            setMeetingState(MeetingState.ENDED);
            setView('ended');
        },
        onError: (err) => {
            setError(err.message || "Connection failed");
            setMeetingState(MeetingState.ERROR);
            setView('setup'); // Go back to setup on error
        },
        onAudioData: (buffer) => {
            const data = buffer.getChannelData(0);
            let sum = 0;
            for(let i=0; i<data.length; i+=10) sum += data[i] * data[i];
            const rms = Math.sqrt(sum / (data.length / 10));
            setAiAudioLevel(Math.min(1, rms * 5)); 
        },
        onTranscription: (item) => {
            setTranscriptions(prev => [...prev, item]);
        }
        });
    } catch (e) {
        setMeetingState(MeetingState.LOBBY);
        setError("Failed to initialize client.");
        console.error(e);
        return;
    }
  };

  // --- 2. PeerJS Connection Logic ---
  const initPeerConnection = () => {
    if (!mediaStreamRef.current || !window.Peer) return;

    const peerId = `gm-${meetingCode.replace(/[^a-zA-Z0-9]/g, '')}`;

    try {
        const peer = new window.Peer(peerId);
        
        peer.on('open', (id: string) => {
            console.log("Joined as Host with ID:", id);
            peerRef.current = peer;
            setIsP2PHost(true);
        });

        peer.on('call', (call: any) => {
            console.log("Received call");
            call.answer(mediaStreamRef.current);
            call.on('stream', (remoteStream: MediaStream) => {
                setRemoteStreams(prev => {
                    if (prev.find(s => s.id === remoteStream.id)) return prev;
                    return [...prev, remoteStream];
                });
            });
        });

        peer.on('error', (err: any) => {
            if (err.type === 'unavailable-id') {
                console.log("ID taken, joining as Guest...");
                setIsP2PHost(false);
                
                const guestPeer = new window.Peer(); 
                
                guestPeer.on('open', () => {
                    peerRef.current = guestPeer;
                    const call = guestPeer.call(peerId, mediaStreamRef.current);
                    
                    call.on('stream', (remoteStream: MediaStream) => {
                         setRemoteStreams(prev => {
                            if (prev.find(s => s.id === remoteStream.id)) return prev;
                            return [...prev, remoteStream];
                         });
                    });
                });
            } else {
                console.error("Peer Error:", err);
            }
        });

    } catch (e) {
        console.error("PeerJS initialization failed", e);
    }
  };

  // Effect to stream video to Gemini
  useEffect(() => {
    if (meetingState === MeetingState.CONNECTED && clientRef.current && videoRef.current) {
        if (!videoRef.current.srcObject && mediaStreamRef.current) {
            videoRef.current.srcObject = mediaStreamRef.current;
        }
        
        if (isWhiteboardOpen && whiteboardCanvasRef.current) {
             const wbStream = whiteboardCanvasRef.current.captureStream(10);
             whiteboardStreamRef.current = wbStream;
             
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
    if (peerRef.current) {
        peerRef.current.destroy();
        peerRef.current = null;
    }
    setRemoteStreams([]);
    stopCamera();
    
    setMeetingState(MeetingState.ENDED);
    setView('ended');
  };
  
  const handleRejoin = () => {
      // Go back to home
      setView('home');
      setMeetingState(MeetingState.LOBBY);
      setError(null);
      setTranscriptions([]);
      setRemoteStreams([]);
  };

  const copyInviteLink = () => {
    const url = new URL(window.location.href);
    // Ensure params are set in case they were cleared
    url.searchParams.set('code', meetingCode);
    if (passcode) url.searchParams.set('pwd', passcode);
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

  const toggleVideoHardware = async () => {
      if (isScreenSharing) {
          stopScreenShare();
          await startCamera();
          return;
      }
      
      if (isWhiteboardOpen) {
          setIsWhiteboardOpen(false);
          setTimeout(() => toggleVideoHardware(), 100);
          return;
      }

      if (isVideoOn) {
          if (originalCameraStreamRef.current) {
              originalCameraStreamRef.current.getVideoTracks().forEach(t => t.stop());
          }
          if (mediaStreamRef.current) {
              mediaStreamRef.current.getVideoTracks().forEach(t => t.stop());
          }
          
          setIsVideoOn(false);
          clientRef.current?.stopVideoStreaming();
      } else {
          try {
              const videoStream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 } });
              const newVideoTrack = videoStream.getVideoTracks()[0];
              
              if (originalCameraStreamRef.current) {
                  const oldTracks = originalCameraStreamRef.current.getVideoTracks();
                  oldTracks.forEach(t => { originalCameraStreamRef.current?.removeTrack(t); });
                  originalCameraStreamRef.current.addTrack(newVideoTrack);
              } else {
                  originalCameraStreamRef.current = videoStream; 
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
                 t.stop(); 
                 mediaStreamRef.current?.removeTrack(t);
             });
             mediaStreamRef.current.addTrack(videoTrack);
             
             setIsScreenSharing(true);
             setIsVideoOn(true); 

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
  
  const toggleChat = () => {
      setIsChatOpen(!isChatOpen);
  };
  
  const toggleMuteAll = () => {
      const newState = !isMutedAll;
      setIsMutedAll(newState);
      clientRef.current?.setVolume(newState ? 0 : 1);
  };

  const handleSendMessage = (e?: React.FormEvent) => {
      e?.preventDefault();
      if (!chatMessage.trim() || !clientRef.current) return;
      
      clientRef.current.sendTextMessage(chatMessage);
      
      setTranscriptions(prev => [...prev, {
          id: Date.now().toString() + '-local',
          text: chatMessage,
          sender: 'user',
          isFinal: true
      }]);
      
      setChatMessage("");
  };

  const startRecording = () => {
    if (!mediaStreamRef.current || !clientRef.current) return;
    try {
        const mixerCtx = new AudioContext();
        recordingMixerContextRef.current = mixerCtx;
        const dest = mixerCtx.createMediaStreamDestination();
        
        const userMicTrack = mediaStreamRef.current.getAudioTracks()[0];
        if (userMicTrack) {
            const micSource = mixerCtx.createMediaStreamSource(new MediaStream([userMicTrack]));
            micSource.connect(dest);
        }

        const remoteStream = clientRef.current.getRemoteAudioStream();
        if (remoteStream && remoteStream.getAudioTracks().length > 0) {
            const remoteSource = mixerCtx.createMediaStreamSource(remoteStream);
            remoteSource.connect(dest);
        }

        const mixedAudioTrack = dest.stream.getAudioTracks()[0];
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
      let timeStr = "";
      try {
          const timestamp = parseInt(t.id.split('-')[0]);
          if (!isNaN(timestamp)) timeStr = `[${new Date(timestamp).toLocaleTimeString()}] `;
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

  // ---------------- VIEW: HOME (Landing) ----------------
  if (view === 'home') {
      const now = new Date();
      return (
        <div className="min-h-screen bg-gray-900 text-white flex flex-col">
            <div className="p-6 flex justify-between items-center">
                 <div className="flex items-center gap-3">
                     <GiantMitraLogo />
                     <span className="text-xl font-bold tracking-tight text-white hidden md:block">Giants Meeting Room</span>
                 </div>
                 <button className="p-2 hover:bg-gray-800 rounded-full"><SettingsIcon /></button>
            </div>

            <div className="flex-1 flex flex-col md:flex-row items-center justify-center gap-8 p-6 max-w-6xl mx-auto w-full">
                
                {/* Left: Hero/Time - UPDATED with new Image */}
                <div className="flex-1 w-full h-[400px] rounded-3xl overflow-hidden relative shadow-2xl group border border-gray-700 bg-gray-800">
                    <img 
                        src={HERO_IMAGE_URL}
                        alt="Meeting Room" 
                        className="w-full h-full object-cover transform group-hover:scale-105 transition-transform duration-700 opacity-60"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-gray-900 via-transparent to-transparent"></div>
                    
                    {/* Centered Large Branding Overlay */}
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 z-10">
                        <div className="p-6 bg-black/40 backdrop-blur-sm rounded-3xl border border-white/10 flex flex-col items-center">
                            <GiantMitraLogo scale={2.5} />
                            <h1 className="text-3xl font-bold mt-6 text-white text-center">Giants Meeting Room</h1>
                            <p className="text-gray-300 font-mono text-sm mt-2">{now.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</p>
                        </div>
                    </div>

                    <div className="absolute bottom-0 right-0 p-8 flex flex-col justify-end pointer-events-none">
                         <p className="text-xl font-medium text-gray-300 text-right drop-shadow-md">
                            {now.toLocaleDateString([], {weekday: 'long', month: 'long', day: 'numeric'})}
                         </p>
                    </div>
                </div>

                {/* Right: Actions */}
                <div className="flex-1 grid grid-cols-2 gap-4 w-full max-w-lg">
                    <button 
                        onClick={handleStartNewMeeting}
                        className="aspect-square bg-orange-600 hover:bg-orange-700 rounded-3xl flex flex-col items-center justify-center gap-4 transition-all shadow-lg hover:shadow-orange-900/20 group"
                    >
                        <div className="bg-white/20 p-4 rounded-2xl group-hover:scale-110 transition-transform">
                            <VideoIcon className="w-8 h-8" />
                        </div>
                        <span className="font-semibold text-lg">New Meeting</span>
                    </button>

                    <button 
                        onClick={handleJoinExisting}
                        className="aspect-square bg-blue-600 hover:bg-blue-700 rounded-3xl flex flex-col items-center justify-center gap-4 transition-all shadow-lg hover:shadow-blue-900/20 group"
                    >
                        <div className="bg-white/20 p-4 rounded-2xl group-hover:scale-110 transition-transform">
                            <PlusIcon className="w-8 h-8" />
                        </div>
                        <span className="font-semibold text-lg">Join</span>
                    </button>

                    <button className="aspect-square bg-blue-600/50 hover:bg-blue-600/70 rounded-3xl flex flex-col items-center justify-center gap-4 transition-all opacity-80 cursor-not-allowed">
                        <div className="bg-white/20 p-4 rounded-2xl">
                            <CalendarIcon className="w-8 h-8" />
                        </div>
                        <span className="font-semibold text-lg">Schedule</span>
                    </button>

                    <button className="aspect-square bg-blue-600/50 hover:bg-blue-600/70 rounded-3xl flex flex-col items-center justify-center gap-4 transition-all opacity-80 cursor-not-allowed">
                        <div className="bg-white/20 p-4 rounded-2xl">
                            <ScreenShareIcon className="w-8 h-8" />
                        </div>
                        <span className="font-semibold text-lg">Share Screen</span>
                    </button>
                </div>
            </div>
        </div>
      );
  }

  // ---------------- VIEW: SETUP (LOBBY) ----------------
  if (view === 'setup') {
    return (
      <div className="min-h-screen bg-gray-900 flex flex-col p-4 relative">
        <button 
            onClick={goBackHome}
            className="absolute top-6 left-6 z-10 p-2 bg-gray-800 rounded-full hover:bg-gray-700 text-white flex items-center gap-2 pr-4 transition"
        >
            <ArrowLeftIcon /> Back
        </button>

        <div className="flex-1 flex flex-col md:flex-row gap-6 max-w-6xl mx-auto w-full items-center justify-center">
          
          {/* Preview Area */}
          <div className="w-full md:w-2/3 aspect-video bg-black rounded-3xl overflow-hidden relative shadow-2xl border border-gray-800">
             <video 
                ref={previewVideoRef}
                autoPlay 
                muted 
                playsInline
                className={`w-full h-full object-cover transform scale-x-[-1] ${!isVideoOn ? 'hidden' : ''}`} 
             />
             {!isVideoOn && (
                <div className="w-full h-full flex items-center justify-center bg-gray-800">
                    <span className="text-6xl opacity-50">👤</span>
                </div>
             )}

             <div className="absolute bottom-6 left-0 right-0 flex justify-center gap-4">
                <button 
                  onClick={toggleMic}
                  className={`p-4 rounded-full ${isMicOn ? 'bg-gray-700/80 hover:bg-gray-600' : 'bg-red-500 hover:bg-red-600'} text-white backdrop-blur transition`}
                >
                  {isMicOn ? <MicIcon /> : <MicOffIcon />}
                </button>
                <button 
                  onClick={toggleVideoHardware}
                  className={`p-4 rounded-full ${isVideoOn ? 'bg-gray-700/80 hover:bg-gray-600' : 'bg-red-500 hover:bg-red-600'} text-white backdrop-blur transition`}
                >
                  {isVideoOn ? <VideoIcon /> : <VideoOffIcon />}
                </button>
                <button 
                  onClick={() => setShowBgMenu(!showBgMenu)}
                  className={`p-4 rounded-full ${backgroundMode !== 'none' ? 'bg-blue-600 hover:bg-blue-500' : 'bg-gray-700/80 hover:bg-gray-600'} text-white backdrop-blur transition`}
                >
                   <SparklesIcon />
                </button>
             </div>
             
             {/* Background Menu */}
             {showBgMenu && (
                 <div className="absolute bottom-24 right-1/2 translate-x-1/2 bg-gray-900/95 backdrop-blur border border-gray-700 p-2 rounded-xl flex gap-2">
                    <button onClick={() => setBackgroundMode('none')} className={`px-4 py-2 rounded-lg ${backgroundMode==='none'?'bg-blue-600':'hover:bg-gray-800'}`}>None</button>
                    <button onClick={() => setBackgroundMode('blur')} className={`px-4 py-2 rounded-lg ${backgroundMode==='blur'?'bg-blue-600':'hover:bg-gray-800'}`}>Blur</button>
                    <button onClick={() => setBackgroundMode('image')} className={`px-4 py-2 rounded-lg ${backgroundMode==='image'?'bg-blue-600':'hover:bg-gray-800'}`}>Office</button>
                 </div>
             )}
          </div>

          {/* Join Controls */}
          <div className="w-full md:w-1/3 bg-gray-800/50 p-8 rounded-3xl border border-gray-700/50 flex flex-col gap-6">
            <h2 className="text-2xl font-bold">{setupMode === 'host' ? 'Start a Meeting' : 'Join Meeting'}</h2>
            
            {setupMode === 'host' ? (
                <>
                    <div className="bg-gray-900 p-4 rounded-xl border border-gray-700">
                        <label className="text-xs text-gray-500 uppercase font-bold tracking-wider">Personal Meeting ID</label>
                        <div className="flex items-center gap-2 mt-2">
                            <span className="text-xl font-mono tracking-wide">{meetingCode}</span>
                            <button onClick={handleStartNewMeeting} className="p-1 hover:bg-gray-800 rounded ml-auto text-gray-400"><RefreshIcon className="w-4 h-4" /></button>
                        </div>
                    </div>
                    
                    <button 
                        onClick={copyInviteLink}
                        className="w-full py-3 bg-gray-700 hover:bg-gray-600 rounded-xl text-gray-300 flex items-center justify-center gap-2"
                    >
                        <CopyIcon className="w-5 h-5" /> Copy Invitation
                    </button>
                </>
            ) : (
                <>
                    <div>
                        <label className="block text-sm text-gray-400 mb-2">Meeting ID</label>
                        <input 
                            type="text" 
                            value={meetingCode} 
                            onChange={(e) => setMeetingCode(e.target.value)}
                            className="w-full bg-gray-900 border border-gray-600 rounded-xl px-4 py-3 focus:outline-none focus:border-blue-500 transition text-lg font-mono"
                            placeholder="abc-def-ghi"
                        />
                    </div>
                </>
            )}

            {error && <div className="text-red-400 bg-red-900/20 p-3 rounded-lg text-sm">{error}</div>}

            <div className="mt-auto">
                <button
                    onClick={handleJoinMeeting}
                    disabled={meetingState === MeetingState.CONNECTING || !meetingCode}
                    className="w-full py-4 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 rounded-xl font-bold text-lg shadow-lg shadow-blue-900/20 transition flex items-center justify-center gap-2"
                >
                    {meetingState === MeetingState.CONNECTING ? 'Connecting...' : (setupMode === 'host' ? 'Start Meeting' : 'Join')}
                </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ---------------- VIEW: MEETING (CONNECTED) ----------------
  if (view === 'meeting') {
    return (
      <div className="h-screen bg-gray-950 flex flex-col relative overflow-hidden">
        
        {/* Header */}
        <div className="absolute top-0 left-0 right-0 z-10 p-4 flex justify-between items-center bg-gradient-to-b from-black/70 to-transparent pointer-events-none">
           <div className="flex items-center gap-3 pointer-events-auto">
             <div className="bg-white/10 p-1 rounded-lg backdrop-blur-sm"><GiantMitraLogo /></div>
             <div className="flex flex-col">
               <span className="font-bold text-sm text-white">Giants Meeting Room</span>
               <div className="flex gap-2 text-xs text-gray-400 font-mono items-center">
                  <span>{meetingCode}</span>
                  <div className="w-1 h-1 bg-gray-500 rounded-full"></div>
                  <span>{transcriptions.length > 0 ? 'Active' : 'Ready'}</span>
               </div>
             </div>
             {isRecording && <span className="flex items-center gap-1 text-red-500 text-xs font-bold bg-red-900/30 px-2 py-1 rounded ml-2 animate-pulse"><div className="w-2 h-2 bg-red-500 rounded-full"></div>REC</span>}
           </div>
           
           <div className="flex gap-2 pointer-events-auto">
              <button 
                onClick={toggleMuteAll}
                className={`p-2 hover:bg-gray-800 rounded-full ${isMutedAll ? 'text-red-400' : 'text-white'}`}
                title={isMutedAll ? "Unmute All" : "Mute All"}
              >
                 {isMutedAll ? <VolumeXIcon className="w-5 h-5" /> : <Volume2Icon className="w-5 h-5" />}
              </button>
              <button 
                onClick={copyInviteLink} 
                className="p-2 hover:bg-gray-800 rounded-full text-white" 
                title="Copy Invite Link"
              >
                  <CopyIcon className="w-5 h-5" />
              </button>
           </div>
        </div>

        {/* Main Stage (Grid) */}
        <div className="flex-1 p-4 flex gap-4 overflow-hidden relative">
          
          <div className={`flex-1 flex flex-col gap-4 ${isChatOpen ? 'mr-80' : ''} transition-all`}>
              
              {/* Remote Participants */}
              {remoteStreams.length > 0 && (
                  <div className="h-40 flex gap-4 overflow-x-auto pb-2 flex-shrink-0">
                      {remoteStreams.map((stream) => (
                          <div key={stream.id} className="w-64 h-full bg-gray-800 rounded-xl overflow-hidden flex-shrink-0 border border-gray-700 shadow-lg relative">
                              <RemoteVideo stream={stream} />
                              <div className="absolute top-2 right-2 bg-black/60 px-2 py-1 rounded text-[10px] text-white">Guest</div>
                          </div>
                      ))}
                  </div>
              )}

              {/* Central Stage (Gemini) */}
              <div className="flex-1 bg-gray-900 rounded-2xl flex flex-col items-center justify-center relative overflow-hidden border border-gray-800 shadow-2xl">
                {isWhiteboardOpen ? (
                    <Whiteboard canvasRef={whiteboardCanvasRef} />
                ) : (
                    <>
                        <div className="absolute inset-0 flex items-center justify-center">
                            <div className="w-64 h-64 relative">
                            <div className="absolute inset-0 bg-blue-500/20 blur-3xl rounded-full scale-150 animate-pulse"></div>
                            <AudioVisualizer isActive={!isMutedAll} audioLevel={aiAudioLevel} />
                            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                <span className="text-6xl">✨</span>
                            </div>
                            </div>
                        </div>
                        
                        <div className="absolute bottom-4 left-4 bg-black/50 backdrop-blur-md px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-2">
                            <span>Gemini AI</span>
                            {aiAudioLevel > 0.05 && !isMutedAll && <div className="w-2 h-2 bg-green-500 rounded-full"></div>}
                        </div>
                    </>
                )}
             </div>
          </div>

          {/* Captions */}
          {!isWhiteboardOpen && !isChatOpen && (
            <div className="absolute bottom-24 left-1/2 -translate-x-1/2 w-full max-w-2xl text-center pointer-events-none z-20">
                {transcriptions.length > 0 && (
                    <div className="bg-black/60 backdrop-blur px-6 py-3 rounded-2xl text-lg text-white shadow-xl transition-all inline-block">
                    {transcriptions[transcriptions.length - 1].sender === 'model' && (
                        <span className="text-blue-300 mr-2 font-bold">Gemini:</span>
                    )}
                    {transcriptions[transcriptions.length - 1].text}
                    </div>
                )}
            </div>
          )}
          
          {/* Chat Sidebar */}
          <div className={`absolute top-0 right-0 bottom-0 w-80 bg-gray-900 border-l border-gray-800 shadow-2xl transition-transform duration-300 z-40 flex flex-col ${isChatOpen ? 'translate-x-0' : 'translate-x-full'}`}>
             <div className="p-4 border-b border-gray-800 font-bold flex justify-between items-center">
                <span>In-Call Messages</span>
                <button onClick={toggleChat} className="text-gray-400 hover:text-white">
                   <ArrowLeftIcon />
                </button>
             </div>
             
             <div className="flex-1 overflow-y-auto p-4 space-y-4">
                 {transcriptions.map((msg, idx) => (
                     <div key={idx} className={`flex flex-col ${msg.sender === 'user' ? 'items-end' : 'items-start'}`}>
                         <div className={`max-w-[85%] rounded-2xl px-4 py-2 text-sm ${
                             msg.sender === 'user' 
                             ? 'bg-blue-600 text-white rounded-br-none' 
                             : 'bg-gray-800 text-gray-200 rounded-bl-none'
                         }`}>
                             {msg.text}
                         </div>
                         <span className="text-[10px] text-gray-500 mt-1 px-1">
                             {msg.sender === 'user' ? 'You' : 'Gemini'}
                         </span>
                     </div>
                 ))}
                 <div ref={chatEndRef}></div>
             </div>
             
             <div className="p-4 border-t border-gray-800 bg-gray-900">
                 <form onSubmit={handleSendMessage} className="relative">
                     <input 
                         type="text" 
                         value={chatMessage}
                         onChange={(e) => setChatMessage(e.target.value)}
                         placeholder="Send a message..." 
                         className="w-full bg-gray-800 border-none rounded-full pl-4 pr-12 py-3 text-sm focus:ring-1 focus:ring-blue-500 focus:outline-none text-white"
                     />
                     <button 
                         type="submit"
                         disabled={!chatMessage.trim()}
                         className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 bg-blue-600 rounded-full text-white hover:bg-blue-500 disabled:opacity-50 disabled:bg-gray-700"
                     >
                         <SendIcon className="w-4 h-4" />
                     </button>
                 </form>
             </div>
          </div>

          {/* User Self View */}
          <div className="absolute bottom-6 right-6 w-56 aspect-video bg-black rounded-xl overflow-hidden shadow-2xl border border-gray-700 group z-30 transition-all duration-300 hover:w-72">
             <video 
                ref={videoRef}
                autoPlay 
                muted 
                playsInline
                className={`w-full h-full object-cover ${isScreenSharing || isWhiteboardOpen ? '' : 'transform scale-x-[-1]'} ${(!isVideoOn && !isScreenSharing) ? 'opacity-0' : 'opacity-100'}`} 
             />
             {(!isVideoOn && !isScreenSharing) && (
               <div className="absolute inset-0 flex items-center justify-center bg-gray-800">
                 <span className="text-2xl">👤</span>
               </div>
             )}
             <div className="absolute bottom-2 left-2 bg-black/60 px-2 py-1 rounded text-[10px] text-white flex items-center gap-1 font-medium">
                You {isP2PHost ? '(Host)' : '(Guest)'}
             </div>
             <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                {!isMicOn && <div className="bg-red-500 p-1 rounded-full"><MicOffIcon className="w-3 h-3" /></div>}
             </div>
          </div>

        </div>

        {/* Bottom Control Bar */}
        <div className="h-20 bg-gray-900 border-t border-gray-800 flex items-center justify-center gap-3 px-4 relative z-50">
           
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
             inactiveColor="bg-gray-800 hover:bg-gray-700"
             icon={isMicOn ? <MicIcon /> : <MicOffIcon />} 
             tooltip={isMicOn ? "Mute" : "Unmute"}
           />
           <ControlBtn 
             onClick={toggleVideoHardware} 
             isActive={!isVideoOn && !isScreenSharing && !isWhiteboardOpen}
             activeColor="bg-red-600 hover:bg-red-700"
             inactiveColor="bg-gray-800 hover:bg-gray-700"
             icon={isVideoOn || isScreenSharing || isWhiteboardOpen ? <VideoIcon /> : <VideoOffIcon />} 
             tooltip={isVideoOn ? "Stop Video" : "Start Video"}
           />
           
           <ControlBtn 
             onClick={() => setShowBgMenu(!showBgMenu)} 
             isActive={showBgMenu || backgroundMode !== 'none'}
             activeColor="bg-blue-600 hover:bg-blue-700"
             inactiveColor="bg-gray-800 hover:bg-gray-700"
             icon={<SparklesIcon />} 
             tooltip="Background Effects"
           />

           <div className="w-px h-8 bg-gray-700 mx-2"></div>

           <ControlBtn 
             onClick={toggleWhiteboard} 
             isActive={isWhiteboardOpen}
             activeColor="bg-green-600 hover:bg-green-700"
             inactiveColor="bg-gray-800 hover:bg-gray-700"
             icon={<BoardIcon />} 
             tooltip="Whiteboard"
           />

           <ControlBtn 
             onClick={handleScreenShareToggle} 
             isActive={isScreenSharing}
             activeColor="bg-green-600 hover:bg-green-700"
             inactiveColor="bg-gray-800 hover:bg-gray-700"
             icon={<ScreenShareIcon />} 
             tooltip="Share Screen"
           />

           <ControlBtn 
             onClick={handleRecordToggle} 
             isActive={isRecording}
             activeColor="bg-gray-800 border-2 border-red-500"
             inactiveColor="bg-gray-800 hover:bg-gray-700"
             icon={isRecording ? <StopRecordIcon className="text-red-500" /> : <RecordIcon />} 
             tooltip="Record Meeting"
           />

            <ControlBtn 
             onClick={toggleChat} 
             isActive={isChatOpen}
             activeColor="bg-blue-600 hover:bg-blue-700"
             inactiveColor="bg-gray-800 hover:bg-gray-700"
             icon={<MessageSquareIcon />} 
             tooltip="Chat"
           />

           <div className="w-px h-8 bg-gray-700 mx-2"></div>

           <button 
             onClick={handleLeave}
             className="w-16 h-12 rounded-full bg-red-600 hover:bg-red-700 flex items-center justify-center text-white transition-all px-6"
             title="Leave Meeting"
           >
              <PhoneOffIcon />
           </button>
        </div>
      </div>
    );
  };

export default App;